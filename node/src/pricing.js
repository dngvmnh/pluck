/** Credit pricing — the single source of truth (server-authoritative).
 *
 * `costFor(req)` computes the charge for one job. `/api/pricing` serves PRICING so
 * the frontend can show a live estimate without duplicating the numbers.
 * Mirrors pluck/pricing.py exactly.
 */
import { intEnv } from "./config.js";
import { OutputMode } from "./models.js";
import { parseHms } from "./ytdlp.js";

// Strict like Python's int(): a misconfigured CREDITS_PER_DOWNLOAD fails at startup
// rather than poisoning every job's price with NaN.
const BASE = intEnv("CREDITS_PER_DOWNLOAD", 2);

// Per-feature surcharges added on top of BASE.
export const PRICING = Object.freeze({
  base: BASE,
  trim: 1,
  "4k": 2,
  "8k": 4,
  subtitles: 1,
  music: 1,
  sponsorblock: 1,
  gif: 3,
  convert: 1,
  chapters: 2,
  remaster: 2,
  transcribe: 8,
  stems: 15,
});

// Surcharge keyed by exclusive output mode.
const MODE_SURCHARGE = {
  [OutputMode.GIF]: ["gif", "gif"],
  [OutputMode.CONVERT]: ["convert", "convert"],
  [OutputMode.CHAPTERS]: ["chapters", "chapters"],
  [OutputMode.REMASTER]: ["remaster", "remaster"],
  [OutputMode.TRANSCRIPT]: ["transcribe", "transcribe"],
  [OutputMode.STEMS]: ["stems", "stems"],
};

/** Credits + a '+'-joined reason string for a single (non-playlist) job. */
export function costFor(req) {
  let credits = PRICING.base;
  const reasons = ["download"];

  let mode = req.output;
  if (req.music && (mode === OutputMode.VIDEO || mode === OutputMode.AUDIO)) {
    mode = OutputMode.AUDIO; // legacy music flag is an audio job
  }

  // exclusive output-mode surcharge
  if (mode in MODE_SURCHARGE) {
    const [key, reason] = MODE_SURCHARGE[mode];
    credits += PRICING[key];
    reasons.push(reason);
  } else if (mode === OutputMode.AUDIO && req.music) {
    credits += PRICING.music;
    reasons.push("music");
  }

  // modifiers (apply where compatible with the mode)
  if (parseHms(req.start) !== null || parseHms(req.end) !== null) {
    credits += PRICING.trim;
    reasons.push("trim");
  }

  if (mode === OutputMode.VIDEO || mode === OutputMode.CONVERT || mode === OutputMode.GIF) {
    if (req.choice === "2160") {
      credits += PRICING["4k"];
      reasons.push("4k");
    } else if (req.choice === "4320") {
      credits += PRICING["8k"];
      reasons.push("8k");
    }
  }

  // subs + sponsorblock are only applied by the standard download pipeline (video/audio),
  // so only charge for them there — the convert/chapters pipelines don't honour them.
  if (req.subs && (mode === OutputMode.VIDEO || mode === OutputMode.AUDIO)) {
    credits += PRICING.subtitles;
    reasons.push("subtitles");
  }

  if (req.sponsorblock && (mode === OutputMode.VIDEO || mode === OutputMode.AUDIO)) {
    credits += PRICING.sponsorblock;
    reasons.push("sponsorblock");
  }

  // remaster as a modifier on an otherwise-audio/video job (distinct from REMASTER output mode)
  if (req.remaster && (mode === OutputMode.AUDIO || mode === OutputMode.VIDEO)) {
    credits += PRICING.remaster;
    reasons.push("remaster");
  }

  return [credits, reasons.join("+")];
}
