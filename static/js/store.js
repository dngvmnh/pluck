// Shared client state + DOM helpers.
export const $ = (s) => document.querySelector(s);
export const $$ = (s) => Array.from(document.querySelectorAll(s));
export const show = (s) => (typeof s === "string" ? $(s) : s)?.classList.remove("hidden");
export const hide = (s) => (typeof s === "string" ? $(s) : s)?.classList.add("hidden");

export const state = {
  current: null,        // last fetched /api/info
  selected: "best",     // chosen quality id
  mode: "video",        // output mode
  pricing: { base: 2 }, // from /api/pricing
  caps: {},             // from /api/capabilities
  session: null,        // from /api/session
};

const SETTINGS_KEY = "pluck_settings_v1";
const DEFAULTS = { theme: "dark", quality: "best", output: "video", gifFps: 12, gifWidth: 480 };

export function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") }; }
  catch { return { ...DEFAULTS }; }
}
export function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* quota */ }
}

// ---- formatting helpers ----
export function humanCount(n) {
  if (!n) return "";
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B views";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M views";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K views";
  return n + " views";
}
export function humanSize(b) {
  if (!b) return "";
  if (b >= 1e9) return (b / 1e9).toFixed(2) + " GB";
  if (b >= 1e6) return (b / 1e6).toFixed(1) + " MB";
  return Math.round(b / 1e3) + " KB";
}
export function fmtClock(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
export function parseClock(str) {
  if (!str) return null;
  const parts = String(str).trim().split(":").map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  return parts.reduce((a, n) => a * 60 + n, 0);
}
// Mirrors the server's parse_hms validity check exactly (empty colon-part = invalid),
// so the trim surcharge estimate matches what the server actually charges.
export function validHms(str) {
  if (!str) return false;
  return String(str).trim().split(":").every((p) => p !== "" && Number.isFinite(Number(p)));
}
