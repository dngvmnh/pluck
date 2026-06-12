/** JobQueue: runs pipelines with bounded concurrency, persists state to SQLite.
 *
 * Mirrors pluck/jobs.py. Python uses a ThreadPoolExecutor; here pipelines are async
 * functions whose heavy work happens in child processes (yt-dlp/ffmpeg), so a simple
 * semaphore gives the same MAX_WORKERS parallelism. Job state is durable (survives
 * restarts); an in-process FILE_CACHE gives identical requests an instant result
 * while the process is alive.
 */
import { existsSync, rmSync, statSync } from "node:fs";
import path from "node:path";

import * as db from "./db.js";
import { DL_DIR, JOB_TTL, MAX_WORKERS } from "./config.js";
import { CancelledError, JobCtx } from "./pipelines/base.js";
import { PIPELINES } from "./pipelines/index.js";

export { PIPELINES }; // re-exported so tests can stub a pipeline (like monkeypatch.setitem)
import { run as playlistRun } from "./pipelines/playlist.js";
import { parseHms } from "./ytdlp.js";

// in-process result cache: dl_key -> {filepath, filename, size}
export const FILE_CACHE = new Map();

// ---- bounded-concurrency pool ----------------------------------------------
let running = 0;
const waiting = [];

function acquire() {
  if (running < MAX_WORKERS) {
    running += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(resolve));
}

function release() {
  const next = waiting.shift();
  if (next) next();
  else running -= 1;
}

/** Stable cache/dedup key — same url+options means the same file. */
export function dlKey(req) {
  return [
    req.url.trim(), req.output, req.choice, req.convert_to,
    req.gif_fps, req.gif_width, req.music, req.subs, req.sponsorblock,
    req.remaster, parseHms(req.start), parseHms(req.end),
  ].map((x) => pyStr(x)).join("|");
}

/** Render values the way Python's str() does, so dl_key matches the Python app's keys. */
function pyStr(x) {
  if (x === null || x === undefined) return "None";
  if (x === true) return "True";
  if (x === false) return "False";
  return String(x);
}

export function finish(jobId, outPath, key) {
  const info = {
    filepath: outPath,
    filename: path.basename(outPath),
    size: statSync(outPath).size,
  };
  // finishJob won't overwrite a job the user cancelled mid-flight; only cache if it landed.
  if (db.finishJob(jobId, { status: "done", progress: 100, ...info }) && key) {
    FILE_CACHE.set(key, info);
  }
}

export async function execute(jobId, req, isPlaylist, key) {
  try {
    const job = db.getJob(jobId);
    if (job && job.status === "cancelled") return;
    const ctx = new JobCtx(jobId, req); // creates the job dir — inside try so failures become status=error
    db.updateJob(jobId, { status: "downloading" });
    const pipeline = isPlaylist ? playlistRun : PIPELINES[req.output];
    const out = await pipeline(ctx);
    ctx.checkCancelled();
    finish(jobId, out, key);
  } catch (e) {
    if (e instanceof CancelledError) {
      db.updateJob(jobId, { status: "cancelled", error: "Cancelled by user" });
    } else {
      const text = String(e?.message ?? e).trim();
      const lines = text.split(/\r?\n/);
      const msg = (lines[lines.length - 1] || e?.constructor?.name || "Error").slice(0, 200);
      db.updateJob(jobId, { status: "error", error: msg });
    }
  }
}

export function submit(jobId, req, isPlaylist = false, key = null) {
  acquire()
    .then(() => execute(jobId, req, isPlaylist, key))
    .finally(release);
}

export const TERMINAL = ["done", "error", "interrupted", "cancelled"];

export function cancel(jobId) {
  const job = db.getJob(jobId);
  if (!job) return false;
  if (TERMINAL.includes(job.status)) return true;
  db.updateJob(jobId, { status: "cancelled", error: "Cancelled by user" });
  return true;
}

/** Delete a job row and its files (Library 'Remove'). */
export function purge(jobId) {
  db.deleteJob(jobId);
  rmSync(path.join(DL_DIR, jobId), { recursive: true, force: true });
}

export function cachedResult(key) {
  const hit = FILE_CACHE.get(key);
  if (hit && existsSync(hit.filepath)) return hit;
  // fall back to any completed DB row whose file still exists (survives FILE_CACHE loss);
  // check every candidate, not just the newest — an older copy may still be on disk.
  for (const row of db.findCachedCandidates(key)) {
    if (row.filepath && existsSync(row.filepath)) {
      return { filepath: row.filepath, filename: row.filename, size: row.size };
    }
  }
  return null;
}

// ---- background reaper -----------------------------------------------------
let _reaper = null;

function reapOnce() {
  try {
    const ids = db.reapOld(Date.now() / 1000 - JOB_TTL);
    for (const jid of ids) {
      rmSync(path.join(DL_DIR, jid), { recursive: true, force: true });
    }
  } catch {
    // best-effort, same as the Python reaper
  }
}

/** Called once on app startup. */
export function startBackground(recover = true) {
  db.initDb();
  if (recover) db.recoverInterrupted();
  if (!_reaper) {
    _reaper = setInterval(reapOnce, 3600 * 1000);
    _reaper.unref(); // don't keep the process alive just for the reaper
  }
}
