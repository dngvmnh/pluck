/** Central configuration: env vars, paths, constants.
 *
 * Importing this module configures the Mythos SDK env BEFORE the SDK is used
 * anywhere else, exactly as the Python pluck/config.py does.
 */
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, rmSync, statSync, symlinkSync,
} from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Make the bundled deno (JS runtime for full YouTube extraction) discoverable.
const sep = process.platform === "win32" ? ";" : ":";
process.env.PATH = path.join(os.homedir(), ".deno", "bin") + sep + (process.env.PATH || "");

// Pluck is a Mythos Producer — MYTHOS_API_URL and MYTHOS_LISTING_ID must be
// set in the environment. No defaults: a missing value surfaces at request time
// via the SDK's own error rather than silently hitting localhost.

// ---- paths ----------------------------------------------------------------
const HERE = path.dirname(fileURLToPath(import.meta.url)); // .../node/src
export const ROOT = path.dirname(HERE);                    // .../node (where static/ + downloads/ live)
export const STATIC_DIR = path.join(ROOT, "static");
export const DL_DIR = process.env.PLUCK_DL_DIR || path.join(ROOT, "downloads");
mkdirSync(DL_DIR, { recursive: true });
export const DB_PATH = process.env.PLUCK_DB || path.join(ROOT, "pluck.db");

// ffmpeg + ffprobe. yt-dlp's --ffmpeg-location takes ONE path and finds ffmpeg AND
// ffprobe in it — but ffmpeg-static and ffprobe-static install to different dirs, and
// ffmpeg-static ships no ffprobe at all. Several yt-dlp postprocessors (duration probe,
// metadata, merge) need ffprobe, so we stage BOTH binaries into one dir and point
// yt-dlp at it. Direct ffmpeg calls use FFMPEG; --ffmpeg-location uses FFMPEG_DIR.
const require = createRequire(import.meta.url);

function resolveBin(envVar, pkg, pickPath) {
  if (process.env[envVar]) return process.env[envVar];
  try {
    const m = require(pkg);
    return pickPath ? m.path : m;
  } catch {
    return null;
  }
}

function stageBinary(src, dst) {
  if (!src || !existsSync(src)) return null;
  try {
    if (existsSync(dst) && statSync(dst).size > 0) return dst; // already staged
    rmSync(dst, { force: true });
    try { symlinkSync(src, dst); } catch { copyFileSync(src, dst); } // symlink, copy fallback
    if (process.platform !== "win32") { try { chmodSync(dst, 0o755); } catch { /* noop */ } }
    return dst;
  } catch {
    return null;
  }
}

function resolveFfTools() {
  const exe = process.platform === "win32" ? ".exe" : "";
  const ffmpegSrc = resolveBin("FFMPEG_PATH", "ffmpeg-static", false);
  const ffprobeSrc = resolveBin("FFPROBE_PATH", "ffprobe-static", true);

  // Stage both into .fftools/ so --ffmpeg-location finds the pair.
  const dir = path.join(ROOT, ".fftools");
  let ffmpeg = null, ffprobe = null;
  try {
    mkdirSync(dir, { recursive: true });
    ffmpeg = stageBinary(ffmpegSrc, path.join(dir, "ffmpeg" + exe));
    ffprobe = stageBinary(ffprobeSrc, path.join(dir, "ffprobe" + exe));
  } catch { /* fall through to PATH */ }

  if (ffmpeg && ffprobe) return { ffmpeg, ffprobe, dir };
  // Couldn't stage both — use whatever we resolved and let yt-dlp fall back to PATH
  // (FFMPEG_DIR=null ⇒ ytdlp omits --ffmpeg-location, so a system ffmpeg/ffprobe wins).
  return { ffmpeg: ffmpegSrc || "ffmpeg", ffprobe: ffprobeSrc || "ffprobe", dir: null };
}

const _ff = resolveFfTools();
export const FFMPEG = _ff.ffmpeg;     // direct ffmpeg calls (runFfmpeg)
export const FFPROBE = _ff.ffprobe;   // exposed for completeness / probes
export const FFMPEG_DIR = _ff.dir;    // dir holding ffmpeg+ffprobe for yt-dlp; null ⇒ use PATH

// yt-dlp binary + the python used for optional ML helpers (whisper/demucs).
export const YT_DLP = process.env.PLUCK_YTDLP || "yt-dlp";
export const PYTHON = process.env.PLUCK_PYTHON || "python";

// ---- Mythos ----------------------------------------------------------------
export const MYTHOS_API = process.env.MYTHOS_API_URL;
export const IS_DEV = (process.env.MYTHOS_ENV || "development") !== "production";

const _DEV_SECRET = "pluck-dev-secret-change-in-prod";
export const SESSION_SECRET = process.env.SESSION_SECRET || _DEV_SECRET;
// Fail closed: a known/default signing key in production lets anyone forge a session
// cookie and bypass the Mythos auth gate. Require a real secret when not in dev.
if (!IS_DEV && SESSION_SECRET === _DEV_SECRET) {
  throw new Error(
    "SESSION_SECRET must be set to a strong random value in production " +
    "(MYTHOS_ENV=production). Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"");
}

// Parse an integer env var the way Python's int() does: reject non-integers loudly
// at startup rather than letting a NaN silently disable the worker cap / TTL / etc.
export function intEnv(name, dflt) {
  const raw = process.env[name];
  if (raw == null || raw === "") return dflt;
  if (!/^[+-]?\d+$/.test(raw.trim())) {
    throw new Error(`${name} must be an integer, got ${JSON.stringify(raw)}`);
  }
  return parseInt(raw, 10);
}

// ---- job engine ------------------------------------------------------------
export const MAX_WORKERS = intEnv("PLUCK_MAX_WORKERS", 8);
export const JOB_TTL = intEnv("PLUCK_JOB_TTL", 86400); // seconds before job + files are reaped
export const PLAYLIST_CAP = intEnv("PLAYLIST_CAP", 10);

// ---- download tuning -------------------------------------------------------
export const FRAG_CONCURRENCY = intEnv("PLUCK_FRAGMENTS", 8);
export const INFO_TTL = 300; // seconds to trust a cached /api/info result
export const STD_HEIGHTS = [144, 240, 360, 480, 720, 1080, 1440, 2160, 4320];

// ---- ML (optional) ---------------------------------------------------------
export const WHISPER_MODEL = process.env.PLUCK_WHISPER_MODEL || "base";
export const DEMUCS_MODEL = process.env.PLUCK_DEMUCS_MODEL || "htdemucs";
