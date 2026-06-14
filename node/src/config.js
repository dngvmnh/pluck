/** Central configuration: env vars, paths, constants.
 *
 * Importing this module configures the Mythos SDK env BEFORE the SDK is used
 * anywhere else, exactly as the Python pluck/config.py does.
 */
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Make the bundled deno (JS runtime for full YouTube extraction) discoverable.
const sep = process.platform === "win32" ? ";" : ":";
process.env.PATH = path.join(os.homedir(), ".deno", "bin") + sep + (process.env.PATH || "");

// Pluck is a Mythos Producer — configure the SDK BEFORE using it.
process.env.MYTHOS_API_URL ??= "http://localhost:4000";
process.env.MYTHOS_LISTING_ID ??= "11111111-1111-1111-1111-111111111111";

// ---- paths ----------------------------------------------------------------
const HERE = path.dirname(fileURLToPath(import.meta.url)); // .../node/src
export const ROOT = path.dirname(HERE);                    // .../node (where static/ + downloads/ live)
export const STATIC_DIR = path.join(ROOT, "static");
export const DL_DIR = process.env.PLUCK_DL_DIR || path.join(ROOT, "downloads");
mkdirSync(DL_DIR, { recursive: true });
export const DB_PATH = process.env.PLUCK_DB || path.join(ROOT, "pluck.db");

// ffmpeg: env override > bundled ffmpeg-static binary > PATH lookup.
const require = createRequire(import.meta.url);
function resolveFfmpeg() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    return require("ffmpeg-static");
  } catch {
    return "ffmpeg";
  }
}
export const FFMPEG = resolveFfmpeg();

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
