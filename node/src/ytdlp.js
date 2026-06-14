/** yt-dlp helpers: CLI arg builders, quality ladder, metadata extraction, caches.
 *
 * Mirrors pluck/ytdlp.py. The Python app uses yt_dlp as a library; here we shell
 * out to the yt-dlp binary, so option dicts become CLI flags with the same effect.
 */
import { spawn } from "node:child_process";

import { FFMPEG, FRAG_CONCURRENCY, INFO_TTL, PLAYLIST_CAP, STD_HEIGHTS, YT_DLP } from "./config.js";
import { which } from "./capabilities.js";

// 16-connection downloader, used automatically if present on PATH.
export const ARIA2C = which("aria2c");

// in-process caches (durable record lives in the DB; these are just fast paths)
export const INFO_CACHE = new Map();           // url -> [ts, data]
export const CHANNEL_AVATAR_CACHE = new Map(); // channel_id -> url|null

/** Parse one colon-segment the way Python's float() does, so parseHms accepts/rejects
 * exactly what parse_hms does (this gates the +1 'trim' surcharge in pricing). float()
 * accepts inf/infinity/nan and scientific notation but rejects hex like '0x10' — whereas
 * JS Number() would silently accept '0x10'=16, charging trim where Python charges none. */
function pyFloat(tok) {
  const t = tok.trim();
  if (t === "") return null;
  const low = t.toLowerCase();
  if (/^[+-]?(inf|infinity)$/.test(low)) return low[0] === "-" ? -Infinity : Infinity;
  if (/^[+-]?nan$/.test(low)) return NaN;
  // decimal / scientific only — reject 0x/0o/0b and other JS-only numeric forms
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return null;
  return Number(t);
}

/** '90' / '1:30' / '01:02:03' -> seconds (float), or null. */
export function parseHms(s) {
  if (!s) return null;
  const parts = String(s).split(":");
  let sec = 0;
  for (const p of parts) {
    const n = pyFloat(p);
    if (n === null) return null;
    sec = sec * 60 + n;
  }
  return sec;
}

export function fmtDuration(secs) {
  if (!secs) return "";
  secs = Math.trunc(secs);
  const h = Math.trunc(secs / 3600);
  const m = Math.trunc((secs % 3600) / 60);
  const s = secs % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Base CLI flags shared by every yt-dlp invocation (mirrors ydl_base()). */
export function ydlBaseArgs() {
  const args = [
    "--quiet", "--no-warnings", "--no-playlist",
    "--ffmpeg-location", FFMPEG,
    "--concurrent-fragments", String(FRAG_CONCURRENCY), // parallel DASH/HLS fragments
    "--http-chunk-size", "10M",                          // sidesteps per-connection throttling
  ];
  if (ARIA2C) { // multi-connection downloader if installed
    args.push("--downloader", "aria2c",
      "--downloader-args", "aria2c:-x16 -s16 -k1M --max-tries=5");
  }
  return args;
}

export function buildQualities(info) {
  const heights = [...new Set((info.formats || []).map((f) => f.height).filter(Boolean))];
  const maxh = heights.length ? Math.max(...heights) : 0;
  const qs = [{ id: "best", label: "Best available", sub: "video + audio", kind: "video" }];
  for (const h of STD_HEIGHTS.filter((h) => h <= maxh).sort((a, b) => b - a)) {
    const tag = h === 4320 ? "8K" : h === 2160 ? "4K" : h === 1440 ? "1440p" : `${h}p`;
    qs.push({ id: String(h), label: tag, sub: "mp4", kind: "video" });
  }
  qs.push({ id: "audio-m4a", label: "Audio only", sub: "m4a", kind: "audio" });
  qs.push({ id: "audio-mp3", label: "Audio only", sub: "mp3", kind: "audio" });
  return qs;
}

/** -> [formatString, extraArgs[]] — extraArgs are the CLI equivalent of postprocessors. */
export function formatSelector(choice) {
  if (choice === "best") return ["bv*+ba/b", []];
  if (choice === "audio-m4a") return ["ba[ext=m4a]/ba/b", []];
  if (choice === "audio-mp3") {
    return ["ba/b", ["--extract-audio", "--audio-format", "mp3", "--audio-quality", "192K"]];
  }
  // Strict like Python int(choice): "720p"/"1e3"/"5x" must error, not silently
  // truncate to a height (which would download wrong + still charge).
  if (!/^\d+$/.test(choice)) throw new Error(`unknown quality choice: ${choice}`);
  const h = parseInt(choice, 10);
  return [`bv*[height<=${h}]+ba/b[height<=${h}]/b`, []];
}

/** Run yt-dlp with -J and parse the JSON info dict. Throws Error with a short message. */
export async function dumpJson(url, extraArgs = []) {
  return new Promise((resolve, reject) => {
    // "--" ends option parsing so a URL beginning with "-" can never be reinterpreted
    // as a yt-dlp flag (the library-based Python app is immune; the CLI here is not).
    const child = spawn(YT_DLP, ["-J", "--no-warnings", "--ffmpeg-location", FFMPEG, ...extraArgs, "--", url],
      { windowsHide: true });
    let out = "", err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", (e) => reject(new Error(`yt-dlp not runnable: ${e.message}`)));
    child.on("close", (code) => {
      if (code !== 0) {
        const lines = err.trim().split(/\r?\n/);
        return reject(new Error((lines[lines.length - 1] || `yt-dlp exited ${code}`).slice(0, 200)));
      }
      try {
        resolve(JSON.parse(out));
      } catch {
        reject(new Error("yt-dlp returned unparseable JSON"));
      }
    });
  });
}

/** Return channel/uploader avatar URL. Tries yt-dlp fields first; for YouTube,
 * fetches the channel page once per channel_id (result cached forever). */
export async function getChannelAvatar(info) {
  for (const key of ["uploader_thumbnail", "channel_thumbnail", "avatar_url", "uploader_avatar"]) {
    const v = info[key];
    if (v && typeof v === "string" && v.startsWith("http")) return v;
  }

  const channelId = info.channel_id || info.uploader_id;
  if (!channelId) return null;
  if (CHANNEL_AVATAR_CACHE.has(channelId)) return CHANNEL_AVATAR_CACHE.get(channelId);

  const channelUrl = info.channel_url || info.uploader_url;
  if (!channelUrl) {
    CHANNEL_AVATAR_CACHE.set(channelId, null);
    return null;
  }

  try {
    const ch = await dumpJson(channelUrl, ["--flat-playlist"]);
    const thumbs = (ch && ch.thumbnails) || [];
    // YouTube returns avatar (small) + banner (large) in thumbnails list.
    // Pick the largest square-ish thumbnail under 800 px wide (= avatar, not banner).
    const avatarThumbs = thumbs.filter((t) =>
      (t.width ?? 9999) <= 800 && Math.abs((t.width ?? 1) - (t.height ?? 1)) < 50);
    let url = null;
    if (avatarThumbs.length) {
      url = avatarThumbs.reduce((a, b) => ((b.width ?? 0) > (a.width ?? 0) ? b : a)).url ?? null;
    } else if (thumbs.length) {
      url = thumbs[0].url ?? null;
    }
    CHANNEL_AVATAR_CACHE.set(channelId, url);
    return url;
  } catch {
    CHANNEL_AVATAR_CACHE.set(channelId, null);
    return null;
  }
}

function cacheInfo(url, data) {
  INFO_CACHE.set(url, [Date.now() / 1000, data]);
  return data;
}

export function cachedInfo(url) {
  const hit = INFO_CACHE.get(url);
  if (hit && Date.now() / 1000 - hit[0] < INFO_TTL) return hit[1];
  return null;
}

/** Fetch metadata and shape it for /api/info. Throws Error on a bad link.
 *
 * Returns the same dicts the Python api_info endpoint returns (playlist or single),
 * and caches the result for INFO_TTL seconds.
 */
export async function extractInfo(url) {
  const hit = cachedInfo(url);
  if (hit !== null) return hit;
  // --flat-playlist == extract_flat:"in_playlist" (single videos still fully extracted)
  const info = await dumpJson(url, ["--flat-playlist"]);

  if (info._type === "playlist") {
    const entries = (info.entries || []).filter(Boolean);
    let thumb = info.thumbnail;
    if (!thumb && entries.length) {
      const t = entries[0].thumbnails || [];
      thumb = (t.length ? t[t.length - 1].url : null) || entries[0].thumbnail;
    }
    return cacheInfo(url, {
      is_playlist: true,
      title: info.title || "Playlist",
      uploader: info.uploader || info.channel || "",
      count: info.playlist_count || entries.length,
      cap: PLAYLIST_CAP,
      webpage_url: info.webpage_url || url,
      thumbnail: thumb,
      items: entries.slice(0, 8).map((e, i) => ({
        title: e.title || `Track ${i + 1}`,
        duration: e.duration,
        duration_str: fmtDuration(e.duration),
      })),
    });
  }

  const channelAvatar = await getChannelAvatar(info);
  const chapters = (info.chapters || []).map((c, i) => ({
    title: c.title || `Chapter ${i + 1}`,
    start: c.start_time,
    end: c.end_time,
  }));
  return cacheInfo(url, {
    is_playlist: false,
    title: info.title || "Untitled",
    uploader: info.uploader || info.channel || info.extractor_key || "",
    channel_avatar: channelAvatar,
    duration: info.duration,
    duration_str: fmtDuration(info.duration),
    thumbnail: info.thumbnail,
    webpage_url: info.webpage_url || url,
    extractor: info.extractor_key || info.extractor || "",
    view_count: info.view_count,
    chapters,
    has_chapters: chapters.length > 0,
    qualities: buildQualities(info),
  });
}
