// Settings: theme + download defaults, persisted to localStorage.
import { $, loadSettings, saveSettings, state } from "./store.js";

export function applyTheme(theme) {
  let t = theme;
  if (theme === "system") {
    t = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  document.documentElement.setAttribute("data-theme", t);
}

export function initSettings() {
  const s = loadSettings();
  applyTheme(s.theme);

  // hydrate controls
  $("#setTheme").value = s.theme;
  $("#setQuality").value = s.quality;
  $("#setOutput").value = s.output;
  $("#setGifFps").value = s.gifFps;
  $("#setGifWidth").value = s.gifWidth;

  const persist = () => {
    const next = {
      theme: $("#setTheme").value,
      quality: $("#setQuality").value,
      output: $("#setOutput").value,
      gifFps: parseInt($("#setGifFps").value, 10) || 12,
      gifWidth: parseInt($("#setGifWidth").value, 10) || 480,
    };
    saveSettings(next);
    applyTheme(next.theme);
  };
  ["setTheme", "setQuality", "setOutput", "setGifFps", "setGifWidth"]
    .forEach((id) => $("#" + id).addEventListener("change", persist));

  // header quick toggle just flips dark/light
  $("#themeBtn").addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme");
    const next = cur === "light" ? "dark" : "light";
    const cfg = loadSettings(); cfg.theme = next; saveSettings(cfg);
    $("#setTheme").value = next; applyTheme(next);
  });

  // capability line
  const caps = state.caps || {};
  $("#caps-line").textContent =
    "Optional features — Transcribe (Whisper): " + (caps.whisper ? "available" : "not installed")
    + " · Stems (Demucs): " + (caps.demucs ? "available" : "not installed");
}
