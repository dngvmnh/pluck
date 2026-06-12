/** Clip window -> high-quality animated GIF (two-pass palettegen/paletteuse).
 * Mirrors pluck/pipelines/gif.py. */
import path from "node:path";
import { statSync } from "node:fs";

import { parseHms } from "../ytdlp.js";
import { downloadSource, runFfmpeg, unlinkQuiet } from "./base.js";

export const MAX_GIF_SECONDS = 30;

export async function makeGif(src, out, start, end, fps = 12, width = 480) {
  fps = Math.max(1, Math.min(Math.trunc(fps || 12), 30));
  width = Math.max(120, Math.min(Math.trunc(width || 480), 1280));
  const seek = [];
  if (start !== null) seek.push("-ss", String(start));
  if (end !== null) {
    const dur = Math.max(0.1, end - (start || 0));
    seek.push("-t", String(Math.min(dur, MAX_GIF_SECONDS)));
  } else {
    seek.push("-t", String(MAX_GIF_SECONDS)); // cap length so GIFs stay sane
  }
  const vf = `fps=${fps},scale=${width}:-1:flags=lanczos`;
  const dir = path.dirname(out);
  const stem = path.basename(out, path.extname(out));
  const palette = path.join(dir, stem + "-palette.png");
  const r1 = await runFfmpeg([...seek, "-i", src, "-vf", `${vf},palettegen=stats_mode=diff`, palette], 300_000);
  if (r1.returncode !== 0 || !existsNonEmpty(palette)) {
    throw new Error("gif palettegen failed: " + r1.stderr.slice(-200));
  }
  const r2 = await runFfmpeg([...seek, "-i", src, "-i", palette,
    "-lavfi", `${vf}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3`, out], 300_000);
  unlinkQuiet(palette);
  if (r2.returncode !== 0 || !existsNonEmpty(out)) {
    throw new Error("gif paletteuse failed: " + r2.stderr.slice(-200));
  }
  return out;
}

function existsNonEmpty(p) {
  try { return statSync(p).size > 0; } catch { return false; }
}

export async function run(ctx) {
  const req = ctx.req;
  const src = await downloadSource(ctx, { heightCap: 720 }); // 720p source is plenty for a GIF
  ctx.update({ status: "processing" });
  const stem = path.basename(src, path.extname(src));
  const out = path.join(ctx.jobDir, stem + ".gif");
  return makeGif(src, out, parseHms(req.start), parseHms(req.end), req.gif_fps, req.gif_width);
}
