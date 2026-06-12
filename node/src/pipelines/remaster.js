/** Audio remaster / denoise: ffmpeg afftdn + dynaudnorm (+ gentle band-pass).
 *
 * Used both as the REMASTER output mode and as a `remaster` modifier on audio downloads.
 * Mirrors pluck/pipelines/remaster.py. */
import path from "node:path";
import { statSync } from "node:fs";

import { downloadSource, runFfmpeg, trimIfRequested, unlinkQuiet } from "./base.js";

// Spectral denoise -> loudness normalize -> trim rumble/hiss.
export const FILTER = "afftdn=nf=-25,dynaudnorm=f=150:g=15,highpass=f=80,lowpass=f=15000";

export async function remasterAudio(src) {
  const dir = path.dirname(src);
  const stem = path.basename(src, path.extname(src));
  const out = path.join(dir, stem + "-remastered.mp3");
  const r = await runFfmpeg(["-i", src, "-vn", "-af", FILTER,
    "-c:a", "libmp3lame", "-b:a", "192k", out], 600_000);
  let size = 0;
  try { size = statSync(out).size; } catch { /* missing */ }
  if (r.returncode === 0 && size > 0) {
    if (src !== out) unlinkQuiet(src);
    return out;
  }
  throw new Error("remaster failed: " + (r.stderr.trim().slice(-200) || "ffmpeg error"));
}

export async function run(ctx) {
  let src = await downloadSource(ctx, { audioOnly: true });
  ctx.update({ status: "processing" });
  src = await trimIfRequested(src, ctx.req);
  return remasterAudio(src);
}
