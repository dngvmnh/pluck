/** Standard single download: video (quality ladder) or audio/music mode.
 *
 * Modifiers: trim, subtitles, sponsorblock, optional audio remaster.
 * Mirrors pluck/pipelines/download.py — yt_dlp option dicts become CLI flags.
 */
import path from "node:path";

import { OutputMode } from "../models.js";
import { formatSelector, ydlBaseArgs } from "../ytdlp.js";
import { fetchSubs, largestFile, runYtdlp, trimIfRequested, zipFiles } from "./base.js";
import { remasterAudio } from "./remaster.js";

function isAudio(req) {
  return req.output === OutputMode.AUDIO || req.music || ["audio-m4a", "audio-mp3"].includes(req.choice);
}

/** CLI args mirroring build_opts() in the Python pipeline. */
export function buildArgs(req, jobDir) {
  const args = [...ydlBaseArgs(), "--output", path.join(jobDir, "%(title).80B.%(ext)s")];
  if (req.music) {
    // Paid "Music" feature: MP3 + ID3 tags + JPEG album art + loudness normalize.
    // Gated strictly on req.music so the surcharge maps to delivered output.
    args.push("--format", "ba/b",
      "--write-thumbnail",
      "--extract-audio", "--audio-format", "mp3", "--audio-quality", "192K",
      "--postprocessor-args", "ExtractAudio:-af loudnorm=I=-16:TP=-1.5:LRA=11",
      "--embed-metadata",
      "--convert-thumbnails", "jpg",
      "--embed-thumbnail");
  } else {
    if (req.output === OutputMode.AUDIO && req.choice !== "audio-mp3") {
      // Plain audio (no tagging) — Audio mode without the Music surcharge.
      args.push("--format", "ba[ext=m4a]/ba/b");
    } else {
      const [fmt, extra] = formatSelector(req.choice);
      args.push("--format", fmt, ...extra);
    }
    if (req.subs) {
      args.push("--write-subs", "--write-auto-subs", "--sub-langs", "en,en-US,en-GB",
        "--convert-subs", "srt", "--embed-subs");
    }
  }
  if (req.sponsorblock) {
    args.push("--sponsorblock-remove", "sponsor,intro,outro,selfpromo,interaction,preview");
  }
  return args;
}

export async function run(ctx) {
  const req = ctx.req;
  const url = req.url.trim();
  await runYtdlp(ctx, buildArgs(req, ctx.jobDir), [url]);
  ctx.checkCancelled();

  let out = largestFile(ctx.jobDir);
  out = await trimIfRequested(out, req);

  if (req.remaster && isAudio(req)) {
    out = await remasterAudio(out);
  }

  // mp3 can't carry subtitles — ship the .srt sidecar(s) in a zip alongside the audio
  if (req.music && req.subs) {
    const srts = await fetchSubs(ctx, url);
    if (srts.length) {
      const stem = path.basename(out, path.extname(out));
      out = zipFiles([out, ...srts], path.join(ctx.jobDir, stem + ".zip"));
    }
  }
  return out;
}
