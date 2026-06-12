/** Format convert: remux (stream-copy) when possible, else transcode to convert_to.
 * Mirrors pluck/pipelines/convert.py. */
import path from "node:path";
import { statSync } from "node:fs";

import { CONVERT_TARGETS } from "../models.js";
import { downloadSource, runFfmpeg, trimIfRequested, unlinkQuiet } from "./base.js";

export const AUDIO_TARGETS = new Set(["mp3", "m4a", "opus", "wav", "flac"]);

// Transcode recipes per target (audio targets re-encode audio; video targets try copy first).
const AUDIO_CODEC = {
  mp3: ["-c:a", "libmp3lame", "-b:a", "192k"],
  m4a: ["-c:a", "aac", "-b:a", "192k"],
  opus: ["-c:a", "libopus", "-b:a", "160k"],
  wav: ["-c:a", "pcm_s16le"],
  flac: ["-c:a", "flac"],
};

function ok(p) {
  try { return statSync(p).size > 0; } catch { return false; }
}

export async function convertFile(src, target) {
  target = (target || "").toLowerCase().replace(/^\.+/, "");
  if (!CONVERT_TARGETS.has(target)) {
    throw new Error(`unsupported convert target: '${target}'`);
  }
  const dir = path.dirname(src);
  const stem = path.basename(src, path.extname(src));
  const out = path.join(dir, `${stem}-conv.${target}`);

  let r;
  if (AUDIO_TARGETS.has(target)) {
    r = await runFfmpeg(["-i", src, "-vn", ...AUDIO_CODEC[target], out], 600_000);
  } else {
    // video container: try stream copy first (fast, lossless), fall back to transcode
    r = await runFfmpeg(["-i", src, "-c", "copy", out], 600_000);
    if (r.returncode !== 0 || !ok(out)) {
      const vcodec = target === "webm"
        ? ["-c:v", "libvpx-vp9", "-c:a", "libopus"]
        : ["-c:v", "libx264", "-c:a", "aac"];
      r = await runFfmpeg(["-i", src, ...vcodec, out], 1_200_000);
    }
  }

  if (r.returncode === 0 && ok(out)) {
    unlinkQuiet(src);
    return out;
  }
  throw new Error("convert failed: " + r.stderr.slice(-200));
}

export async function run(ctx) {
  const req = ctx.req;
  const target = (req.convert_to || "").toLowerCase().replace(/^\.+/, "");
  if (!CONVERT_TARGETS.has(target)) {
    throw new Error(`unsupported convert target: '${req.convert_to}'`);
  }
  let src = await downloadSource(ctx, { audioOnly: AUDIO_TARGETS.has(target) });
  ctx.update({ status: "processing" });
  src = await trimIfRequested(src, req);
  return convertFile(src, target);
}
