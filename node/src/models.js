/** Request models + job enums (mirrors pluck/models.py). */

export const OutputMode = Object.freeze({
  VIDEO: "video",          // standard video download (quality ladder)
  AUDIO: "audio",          // audio-only / music mode
  GIF: "gif",              // clip window -> animated GIF
  CONVERT: "convert",      // remux / transcode to convert_to
  CHAPTERS: "chapters",    // split by chapters -> zip
  REMASTER: "remaster",    // audio denoise / loudness cleanup
  TRANSCRIPT: "transcript",// Whisper -> .srt + .txt  (optional dep)
  STEMS: "stems",          // Demucs -> vocals/drums/bass/other zip  (optional dep)
  PLAYLIST: "playlist",    // bulk playlist (set implicitly when playlist=True)
});

export const JobStatus = Object.freeze({
  QUEUED: "queued",
  DOWNLOADING: "downloading",
  PROCESSING: "processing",
  DONE: "done",
  ERROR: "error",
  CANCELLED: "cancelled",
  INTERRUPTED: "interrupted", // server restarted mid-job
});

const OUTPUT_VALUES = new Set(Object.values(OutputMode));

// Output modes that need an optional heavy ML dependency.
export const ML_MODES = new Set([OutputMode.TRANSCRIPT, OutputMode.STEMS]);

// Allow-list of convert targets (container/codec) -> ffmpeg expectations.
export const CONVERT_TARGETS = new Set(["mp4", "mkv", "webm", "mp3", "m4a", "opus", "wav", "flac"]);

export class ValidationError extends Error {}

function str(v, dflt = "") {
  if (v == null) return dflt;
  // Like a Pydantic v2 `str` field: don't silently coerce numbers/objects/bools into
  // strings (that would turn url:123 into "123" or url:{} into "[object Object]" and
  // create a charged job against garbage). Reject them, matching the Python 422.
  if (typeof v !== "string") throw new ValidationError(`expected string, got ${JSON.stringify(v)}`);
  return v;
}

function num(v, dflt) {
  if (v == null) return dflt;
  const n = Number(v);
  if (typeof v === "boolean" || !Number.isFinite(n)) {
    throw new ValidationError(`expected number, got ${JSON.stringify(v)}`);
  }
  return n;
}

function bool(v, dflt = false) {
  if (v == null) return dflt;
  if (typeof v === "boolean") return v;
  throw new ValidationError(`expected boolean, got ${JSON.stringify(v)}`);
}

function int(v, dflt) {
  if (v == null) return dflt;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new ValidationError(`expected number, got ${JSON.stringify(v)}`);
  return Math.trunc(n);
}

/** Parse + validate a /api/download body. Throws ValidationError (-> 422) on bad shape. */
export function parseDownloadReq(body) {
  const b = body && typeof body === "object" ? body : {};
  const output = str(b.output, OutputMode.VIDEO);
  if (!OUTPUT_VALUES.has(output)) {
    throw new ValidationError(`invalid output mode: ${JSON.stringify(b.output)}`);
  }
  let urls = null;
  if (b.urls != null) {
    if (!Array.isArray(b.urls)) throw new ValidationError("urls must be a list");
    urls = b.urls.map((u) => {
      if (typeof u !== "string") throw new ValidationError(`urls elements must be strings, got ${JSON.stringify(u)}`);
      return u;
    });
  }
  return {
    url: str(b.url),
    urls,                                       // multi-URL fan-out (one job each)
    choice: str(b.choice, "best"),              // quality id
    output,
    convert_to: b.convert_to == null ? null : str(b.convert_to), // for output=convert
    gif_fps: int(b.gif_fps, 12),                // for output=gif
    gif_width: int(b.gif_width, 480),           // for output=gif
    start: b.start == null ? null : str(b.start), // trim
    end: b.end == null ? null : str(b.end),
    subs: bool(b.subs),                         // download + embed subtitles
    music: bool(b.music),                       // audio + ID3 tags + album art + loudness (legacy flag => AUDIO)
    sponsorblock: bool(b.sponsorblock),         // cut sponsor/intro/outro segments
    remaster: bool(b.remaster),                 // audio denoise/normalize (modifier on audio/remaster)
    playlist: bool(b.playlist),                 // bulk download a playlist/channel
    min_minutes: num(b.min_minutes, null), // smart filter (reject non-numeric, like the float field)
    keyword: b.keyword == null ? null : str(b.keyword),                // smart filter
  };
}
