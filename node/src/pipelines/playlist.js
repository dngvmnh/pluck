/** Bulk playlist download + smart filter (min-minutes / title keyword) -> .zip.
 * Mirrors pluck/pipelines/playlist.py — match_filter becomes --match-filters. */
import path from "node:path";
import { renameSync } from "node:fs";

import { PLAYLIST_CAP } from "../config.js";
import { mediaFiles, runYtdlp, zipFiles } from "./base.js";
import { ydlBaseArgs } from "../ytdlp.js";

function matchFilter(req) {
  const mf = [];
  if (req.min_minutes) mf.push(`duration > ${Number(req.min_minutes) * 60}`);
  if (req.keyword) {
    // escape regex metacharacters like Python's re.escape
    const kw = req.keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    mf.push(`title ~= '(?i)${kw}'`);
  }
  return mf.length ? mf.join(" & ") : null;
}

export async function run(ctx) {
  const req = ctx.req;
  let done = 0;

  // Playlist-specific progress: per-item title label + items_done counter
  // (the CLI analogue of the custom hook in the Python pipeline).
  ctx.onProgress = (p) => {
    if (p.status === "destination") {
      ctx.update({ status: "downloading", label: (p.filename || "").slice(0, 70), items_done: done });
    } else if (p.status === "downloading") {
      ctx.update({ status: "downloading", speed: p.speed || "", items_done: done });
    } else if (p.status === "finished") {
      done += 1;
      ctx.update({ items_done: done, status: "processing" });
    }
  };

  const base = ydlBaseArgs().filter((a) => a !== "--no-playlist");
  const args = [...base, "--yes-playlist", "--ignore-errors", "--playlist-end", String(PLAYLIST_CAP),
    "--output", path.join(ctx.jobDir, "%(playlist_index)03d-%(title).60B.%(ext)s"),
    "--format", "bv*[height<=720]+ba/b[height<=720]/b"];
  const mf = matchFilter(req);
  if (mf) args.push("--match-filters", mf);

  try {
    await runYtdlp(ctx, args, [req.url.trim()]);
  } catch (e) {
    // --ignore-errors still exits non-zero if some entries failed; deliver what we got
    if (e.constructor.name === "CancelledError") throw e;
    if (!mediaFiles(ctx.jobDir).length) throw e;
  }
  ctx.checkCancelled();

  const media = mediaFiles(ctx.jobDir);
  if (!media.length) throw new Error("no videos matched / downloaded");
  ctx.update({ items_done: media.length });
  const zipPath = zipFiles(media, path.join(ctx.jobDir, "playlist.zip"));
  // rename for a nicer download filename
  const nice = path.join(ctx.jobDir, `${req.keyword || "playlist"}-${media.length}-videos.zip`);
  try {
    renameSync(zipPath, nice);
    return nice;
  } catch {
    return zipPath;
  }
}
