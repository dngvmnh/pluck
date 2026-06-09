// App bootstrap + wiring.
import { getJSON } from "./api.js";
import { $, $$, hide, show, state } from "./store.js";
import { loadSession, topUp } from "./session.js";
import { renderSingle, startDownload, updateCost } from "./result.js";
import { renderPlaylist, startPlaylist, updatePlaylistCost } from "./playlist.js";
import { detectUrls, renderBatch, startBatch } from "./batch.js";
import { addJob, clearDoneJobs, renderLibrary } from "./jobs.js";
import { wireTrim } from "./trim.js";
import { initSettings } from "./settings.js";
import { toast, toastErr } from "./toast.js";

// ---- URL field ----
function setUrl(url) {
  $("#url").value = url;
  $("#url-clear").style.display = url ? "flex" : "none";
}
function clearUrl() {
  setUrl(""); hide("#result"); hide("#playlist"); hide("#batch"); show("#empty"); $("#url").focus();
}

// ---- fetch metadata + render ----
async function grab(text) {
  const urls = detectUrls(text);
  if (urls.length > 1) { renderBatch(urls); return; }
  const url = (urls[0] || text || "").trim();
  if (!url) return;
  hide("#empty"); hide("#result"); hide("#playlist"); hide("#batch"); show("#loading");
  try {
    const r = await fetch("/api/info", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || "Could not read that link.");
    state.current = data;
    if (data.is_playlist) renderPlaylist(data); else renderSingle(data);
  } catch (e) {
    toastErr(e.message);
    show("#empty");
  } finally {
    hide("#loading");
  }
}

// ---- tabs ----
function switchTab(name) {
  $$(".tab").forEach((t) => {
    const on = t.dataset.tab === name;
    t.classList.toggle("sel", on); t.setAttribute("aria-selected", on ? "true" : "false");
  });
  $$(".tabpanel").forEach((p) => p.classList.add("hidden"));
  $("#tab-" + name).classList.remove("hidden");
  if (name === "library") renderLibrary();
}

// ---- paste detection ----
async function checkClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    if (text && text !== $("#url").value && /^https?:\/\//i.test(text.trim())) showPastePill(text.trim());
  } catch { /* permission denied */ }
}
function showPastePill(url) {
  let host = url; try { host = new URL(url).hostname; } catch { /* raw */ }
  toast(`Paste detected — ${host}`, {
    type: "info", timeout: 8000,
    action: { label: "Use it", onClick: () => { setUrl(url); grab(url); } },
  });
}

function init() {
  // load config in parallel
  Promise.all([
    getJSON("/api/pricing").then(({ ok, data }) => { if (ok) state.pricing = data.pricing; }),
    getJSON("/api/capabilities").then(({ ok, data }) => { if (ok) state.caps = data; }),
  ]).then(() => { initSettings(); });

  loadSession();
  wireTrim();

  // search
  $("#search").addEventListener("submit", (e) => {
    e.preventDefault();
    const u = $("#url").value.trim();
    if (u) grab(u);
  });
  $("#url").addEventListener("input", () => { $("#url-clear").style.display = $("#url").value ? "flex" : "none"; });
  $("#url-clear").addEventListener("click", clearUrl);

  // actions
  $("#downloadBtn").addEventListener("click", startDownload);
  $("#plDownloadBtn").addEventListener("click", startPlaylist);
  $("#batchDownloadBtn").addEventListener("click", startBatch);
  $("#topupBtn").addEventListener("click", topUp);
  $("#clear-done-btn").addEventListener("click", clearDoneJobs);
  $("#refresh-lib-btn").addEventListener("click", renderLibrary);

  // modifiers + selects -> live cost
  ["optSubs", "optMusic", "optRemaster", "optSponsor"].forEach((id) => $("#" + id).addEventListener("change", updateCost));
  ["convertTo", "gifFps", "gifWidth"].forEach((id) => $("#" + id).addEventListener("input", updateCost));
  ["plMin", "plKw"].forEach((id) => $("#" + id).addEventListener("input", updatePlaylistCost));

  // examples
  $$(".ex").forEach((b) => b.addEventListener("click", () => { setUrl(b.dataset.url); grab(b.dataset.url); }));

  // tabs
  $$(".tab").forEach((t) => t.addEventListener("click", () => switchTab(t.dataset.tab)));

  // keyboard
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "v" && document.activeElement !== $("#url")) $("#url").focus();
    if (e.key === "Escape") clearUrl();
  });
  window.addEventListener("focus", checkClipboard);
}

init();
