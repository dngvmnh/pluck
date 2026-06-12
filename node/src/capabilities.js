/** Detect optional features (heavy ML deps) so the UI can hide what isn't installed
 * and routes can reject unavailable modes with a clean 400 instead of a 500.
 *
 * A feature is only "available" when its WHOLE runtime dependency chain is importable
 * by the configured Python — not just its top-level package (mirrors pluck/capabilities.py:
 * e.g. Demucs needs torchcodec too, or separation fails at runtime). This keeps the
 * capability honest: a feature reported as available will actually run, so we never
 * charge for a job that's structurally doomed.
 *
 * The ML pipelines shell out to Python (PLUCK_PYTHON), so the probe asks that same
 * interpreter whether the chain imports.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { FFMPEG, PYTHON, YT_DLP } from "./config.js";

/** Cross-platform `shutil.which`. Returns the resolved path or null. */
export function which(cmd) {
  const exts = process.platform === "win32"
    ? (process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";")
    : [""];
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = path.join(dir, cmd + ext.toLowerCase());
      if (existsSync(p)) return p;
    }
  }
  return null;
}

function pythonImports(...modules) {
  try {
    const r = spawnSync(PYTHON, ["-c", `import ${modules.join(", ")}`],
      { timeout: 30000, windowsHide: true });
    return r.status === 0;
  } catch {
    return false;
  }
}

function whisperOk() {
  // faster-whisper runs on the ctranslate2 backend.
  return pythonImports("faster_whisper", "ctranslate2");
}

function demucsOk() {
  // Demucs needs torch + torchaudio; torchaudio>=2.1 decodes audio via torchcodec,
  // so without torchcodec, separation fails at runtime. Require the full chain.
  return pythonImports("demucs", "torch", "torchaudio", "torchcodec");
}

function ytdlpOk() {
  return Boolean(which(YT_DLP)) || existsSync(YT_DLP);
}

let _caps = null;

export function capabilities() {
  if (_caps === null) {
    _caps = {
      ffmpeg: Boolean(FFMPEG) && (FFMPEG === "ffmpeg" ? Boolean(which("ffmpeg")) : existsSync(FFMPEG)),
      ytdlp: ytdlpOk(),
      aria2c: which("aria2c") !== null,
      whisper: whisperOk(),
      demucs: demucsOk(),
    };
  }
  return _caps;
}

export function has(feature) {
  return capabilities()[feature] ?? false;
}

/** Reset the cache (tests). */
export function resetCapabilities(override = null) {
  _caps = override;
}
