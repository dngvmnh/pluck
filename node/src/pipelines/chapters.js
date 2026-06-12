/** Split a video by its chapters into separate files, delivered as a .zip.
 * Mirrors pluck/pipelines/chapters.py. */
import path from "node:path";
import { statSync } from "node:fs";

import { dumpJson } from "../ytdlp.js";
import { downloadSource, runFfmpeg, unlinkQuiet, zipFiles } from "./base.js";

function safe(name) {
  return (name || "").replace(/[^\w\- ]+/g, "_").trim().slice(0, 60) || "chapter";
}

async function getChapters(url) {
  const info = await dumpJson(url, ["--no-playlist"]);
  return info.chapters || [];
}

function ok(p) {
  try { return statSync(p).size > 0; } catch { return false; }
}

export async function splitChapters(src, chapters, outDir) {
  const parts = [];
  const ext = path.extname(src);
  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i];
    const start = ch.start_time, end = ch.end_time;
    const title = safe(ch.title || `chapter-${i + 1}`);
    const part = path.join(outDir, `${String(i + 1).padStart(2, "0")}-${title}${ext}`);
    const seek = [];
    if (start != null) seek.push("-ss", String(start));
    if (end != null) seek.push("-to", String(end));
    const r = await runFfmpeg([...seek, "-i", src, "-c", "copy", part], 300_000);
    if (r.returncode === 0 && ok(part)) parts.push(part);
  }
  if (!parts.length) throw new Error("chapter split produced no files");
  return parts;
}

export async function run(ctx) {
  const url = ctx.req.url.trim();
  const chapters = await getChapters(url);
  if (!chapters.length) throw new Error("no chapters");
  const src = await downloadSource(ctx, { heightCap: 1080 });
  ctx.update({ status: "processing" });
  const parts = await splitChapters(src, chapters, ctx.jobDir);
  const stem = path.basename(src, path.extname(src));
  unlinkQuiet(src);
  const zipPath = path.join(ctx.jobDir, `${stem}-chapters.zip`);
  return zipFiles(parts, zipPath);
}
