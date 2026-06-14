/** Shared pipeline plumbing: job context, yt-dlp/ffmpeg subprocess helpers, trim,
 * subtitle sidecars. Mirrors pluck/pipelines/base.py — with the difference that the
 * Python app calls yt_dlp as a library, while here yt-dlp runs as a child process
 * (progress parsed from stdout; cancellation kills the child).
 */
import { spawn } from "node:child_process";
import { globSync, mkdirSync, readdirSync, statSync, rmSync } from "node:fs";
import path from "node:path";

import AdmZip from "adm-zip";

import * as db from "../db.js";
import { DL_DIR, FFMPEG, YT_DLP } from "../config.js";
import { parseHms, ydlBaseArgs } from "../ytdlp.js";

/** Raised inside a pipeline when the job was cancelled by the user. */
export class CancelledError extends Error {}

/** Per-job context handed to every pipeline. Wraps DB updates + cancellation. */
export class JobCtx {
  constructor(jobId, req) {
    this.jobId = jobId;
    this.req = req;
    this.jobDir = path.join(DL_DIR, jobId);
    mkdirSync(this.jobDir, { recursive: true });
    this._lastWrite = 0;
  }

  // ---- state -----------------------------------------------------------
  update(fields) {
    db.updateJob(this.jobId, fields);
  }

  cancelled() {
    const j = db.getJob(this.jobId);
    return Boolean(j) && j.status === "cancelled";
  }

  checkCancelled() {
    if (this.cancelled()) throw new CancelledError();
  }

  /** Progress sink fed by runYtdlp; throttles DB writes to ~4/s (like the Python hook). */
  onProgress(p) {
    if (p.status === "downloading") {
      const now = Date.now() / 1000;
      if (now - this._lastWrite < 0.25) return;
      this._lastWrite = now;
      this.update({
        status: "downloading",
        progress: p.percent ?? null,
        speed: p.speed || "",
        eta: p.eta || "",
        total_bytes: p.totalBytes || 0,
      });
    } else if (p.status === "finished") {
      this.update({ status: "processing" });
    }
  }
}

// ---- yt-dlp subprocess ------------------------------------------------------

// "[download]  45.3% of  10.51MiB at    2.31MiB/s ETA 00:05"
const PROGRESS_RE = /\[download\]\s+([\d.]+)%\s+of\s+~?\s*([\d.]+)(\w+)(?:\s+at\s+(\S+))?(?:\s+ETA\s+(\S+))?/;
// Unknown total size (live/HLS): "[download]  10.51MiB at 2.31MiB/s ETA 00:05" — no "% of".
// Python's hook still fires status=downloading (progress=None) for these, so we mirror that.
const NO_PCT_RE = /\[download\]\s+~?\s*[\d.]+\w+\s+at\s+(\S+)(?:\s+ETA\s+(\S+))?/;
const DEST_RE = /\[download\] Destination: (.+)$/;

const UNIT = { B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, TiB: 1024 ** 4 };

/** Run yt-dlp downloading into ctx.jobDir. Parses progress lines into ctx.onProgress
 * and kills the process if the job is cancelled (the CLI analogue of raising
 * CancelledError from a yt_dlp progress hook). Resolves on exit 0, rejects otherwise. */
export function runYtdlp(ctx, args, urls) {
  return new Promise((resolve, reject) => {
    const child = spawn(YT_DLP, ["--newline", "--progress", ...args, "--", ...urls],
      { windowsHide: true });
    let stderrTail = "";
    let cancelled = false;
    let buf = "";

    const onLine = (line) => {
      if (ctx.cancelled()) {
        cancelled = true;
        child.kill("SIGKILL");
        return;
      }
      const m = PROGRESS_RE.exec(line);
      if (m) {
        const [, pct, num, unit, speed, eta] = m;
        const percent = Number(pct);
        ctx.onProgress({
          status: percent >= 100 ? "finished" : "downloading",
          percent: Math.round(percent * 10) / 10,
          totalBytes: Math.round(Number(num) * (UNIT[unit] || 1)),
          speed: (speed || "").trim(),
          eta: (eta || "").trim(),
        });
        return;
      }
      const np = NO_PCT_RE.exec(line);
      if (np) {
        ctx.onProgress({
          status: "downloading",
          percent: null,          // unknown total -> no percentage (Python writes progress=None)
          totalBytes: 0,
          speed: (np[1] || "").trim(),
          eta: (np[2] || "").trim(),
        });
        return;
      }
      const d = DEST_RE.exec(line);
      if (d) ctx.onProgress({ status: "destination", filename: path.basename(d[1].trim()) });
    };

    child.stdout.on("data", (chunk) => {
      buf += chunk;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const l of lines) onLine(l);
    });
    child.stderr.on("data", (d) => {
      stderrTail = (stderrTail + d).slice(-2000);
    });
    child.on("error", (e) => reject(new Error(`yt-dlp not runnable: ${e.message}`)));
    child.on("close", (code) => {
      if (cancelled || ctx.cancelled()) return reject(new CancelledError());
      if (code === 0) return resolve();
      const lines = stderrTail.trim().split(/\r?\n/);
      reject(new Error((lines[lines.length - 1] || `yt-dlp exited ${code}`).slice(0, 200)));
    });
  });
}

// ---- file helpers --------------------------------------------------------
export function mediaFiles(jobDir, exclude = [".part", ".zip"]) {
  return readdirSync(jobDir)
    .map((name) => path.join(jobDir, name))
    .filter((p) => statSync(p).isFile() && !exclude.some((ext) => p.endsWith(ext)));
}

export function largestFile(jobDir) {
  const files = mediaFiles(jobDir);
  if (!files.length) throw new Error("no output file produced");
  return files.reduce((a, b) => (statSync(b).size > statSync(a).size ? b : a));
}

export function zipFiles(paths, zipPath) {
  const zip = new AdmZip();
  for (const p of [...paths].sort()) {
    zip.addLocalFile(p);
  }
  // Match Python's zipfile.ZIP_STORED: no compression (method 0), fast for large media.
  for (const entry of zip.getEntries()) {
    entry.header.method = 0;
  }
  zip.writeZip(zipPath);
  return zipPath;
}

export function runFfmpeg(args, timeoutMs = 600_000) {
  return new Promise((resolve) => {
    const child = spawn(FFMPEG, ["-y", "-loglevel", "error", ...args],
      { windowsHide: true, timeout: timeoutMs });
    let stderr = "";
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", (e) => resolve({ returncode: -1, stderr: String(e.message) }));
    child.on("close", (code) => resolve({ returncode: code ?? -1, stderr }));
  });
}

function exists(p) {
  try { return statSync(p).size >= 0; } catch { return false; }
}

function sizeOf(p) {
  try { return statSync(p).size; } catch { return 0; }
}

export function unlinkQuiet(p) {
  rmSync(p, { force: true });
}

function withName(p, name) {
  return path.join(path.dirname(p), name);
}

function stemOf(p) {
  return path.basename(p, path.extname(p));
}

// ---- trim (download-then-cut; network range-download segfaults with static ffmpeg) ----
export async function trimIfRequested(out, req) {
  const s = parseHms(req.start), e = parseHms(req.end);
  if (s === null && e === null) return out;
  const ext = path.extname(out).toLowerCase();
  const clip = withName(out, stemOf(out) + "-clip" + ext);
  const seek = [];
  if (s !== null) seek.push("-ss", String(s));
  if (e !== null) seek.push("-to", String(e));
  let args;
  if (ext === ".mp3") {
    args = [...seek, "-i", out, "-i", out,
      "-map", "0:a:0", "-c:a", "libmp3lame", "-b:a", "192k",
      "-map", "1:v:0?", "-c:v", "mjpeg", "-disposition:v", "attached_pic",
      "-id3v2_version", "3", clip];
  } else if ([".m4a", ".aac", ".opus", ".flac", ".ogg", ".wav"].includes(ext)) {
    args = [...seek, "-i", out, "-map", "0:a:0", "-c:a", "aac", "-b:a", "192k", clip];
  } else { // video: stream copy is fine
    args = [...seek, "-i", out, "-c", "copy", clip];
  }
  try {
    const r = await runFfmpeg(args, 180_000);
    if (r.returncode === 0 && exists(clip) && sizeOf(clip) > 0) {
      unlinkQuiet(out);
      return clip;
    }
  } catch {
    // fall through: deliver the untrimmed file rather than failing the job
  }
  return out;
}

/** Download a single source file (no post-processing) for pipelines that
 * transform a downloaded media file (gif/convert/chapters/remaster/transcribe/stems).
 * Returns the largest produced file. */
export async function downloadSource(ctx, { audioOnly = false, heightCap = null } = {}) {
  const req = ctx.req;
  let fmt;
  if (audioOnly) {
    fmt = "ba/b";
  } else if (heightCap) {
    fmt = `bv*[height<=${heightCap}]+ba/b[height<=${heightCap}]/b`;
  } else {
    const { formatSelector } = await import("../ytdlp.js");
    const choice = ["audio-m4a", "audio-mp3"].includes(req.choice) ? "best" : req.choice;
    [fmt] = formatSelector(choice);
  }
  const args = [...ydlBaseArgs(), "--format", fmt,
    "--output", path.join(ctx.jobDir, "src.%(ext)s")];
  await runYtdlp(ctx, args, [req.url.trim()]);
  ctx.checkCancelled();
  return largestFile(ctx.jobDir);
}

/** Best-effort English .srt sidecars (separate pass so a subtitle 429 never aborts audio). */
export async function fetchSubs(ctx, url) {
  const args = [...ydlBaseArgs(), "--skip-download", "--write-subs", "--write-auto-subs",
    "--sub-langs", "en,en-US,en-GB", "--ignore-errors",
    "--output", path.join(ctx.jobDir, "%(title).60B.%(ext)s")];
  try {
    await runYtdlp(ctx, args, [url]);
  } catch (e) {
    if (e instanceof CancelledError) throw e;
    // best-effort: missing subs never fail the job
  }
  const srts = [];
  for (const vtt of globSync(path.join(ctx.jobDir, "*.vtt")).sort()) {
    const srt = vtt.slice(0, -4) + ".srt";
    try {
      const r = await runFfmpeg(["-i", vtt, srt], 60_000);
      if (r.returncode === 0 && exists(srt)) {
        unlinkQuiet(vtt);
        srts.push(srt);
      }
    } catch {
      // skip this sidecar
    }
  }
  return srts;
}
