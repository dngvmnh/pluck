// Single-video result view: output modes, modifiers, live cost, download.
import { postJSON } from "./api.js";
import { $, $$, hide, humanCount, loadSettings, show, state, validHms } from "./store.js";
import { getTrim, resetTrim, setupTrim } from "./trim.js";
import { setBalance, setNeeded } from "./session.js";
import { addJob } from "./jobs.js";
import { toastErr } from "./toast.js";

// Output modes. `mods` = which modifier controls show; `cap` = required capability.
const MODES = [
  { id: "video", label: "Video", pane: "video", mods: ["clip", "subs", "sponsor"] },
  { id: "audio", label: "Audio", pane: "simple", mods: ["clip", "music", "subs", "remaster"], desc: "Audio-only download (best source)." },
  { id: "gif", label: "GIF", pane: "gif", mods: ["clip"] },
  { id: "convert", label: "Convert", pane: "convert", mods: ["clip"] },
  { id: "chapters", label: "Chapters", pane: "chapters", mods: [], needs: "has_chapters" },
  { id: "remaster", label: "Remaster", pane: "simple", mods: ["clip"], desc: "Denoise + loudness-normalize the audio." },
  { id: "transcript", label: "Transcribe", pane: "simple", mods: ["clip"], cap: "whisper", desc: "AI transcript (.srt + .txt) via Whisper." },
  { id: "stems", label: "Stems", pane: "simple", mods: ["clip"], cap: "demucs", desc: "Split into vocals / drums / bass / other via Demucs." },
];
const SURCHARGE = { gif: "gif", convert: "convert", chapters: "chapters", remaster: "remaster", transcript: "transcribe", stems: "stems" };

function modeById(id) { return MODES.find((m) => m.id === id) || MODES[0]; }

function gatherOpts() {
  const t = getTrim();
  return {
    start: t.start, end: t.end,
    subs: $("#optSubs").checked, music: $("#optMusic").checked,
    remaster: $("#optRemaster").checked, sponsorblock: $("#optSponsor").checked,
  };
}

export function clientCost() {
  const p = state.pricing || { base: 2 };
  const mode = state.mode, o = gatherOpts();
  let c = p.base || 2;
  if (SURCHARGE[mode]) c += p[SURCHARGE[mode]] || 0;
  else if (mode === "audio" && o.music) c += p.music || 0;
  if (validHms(o.start) || validHms(o.end)) c += p.trim || 0;   // mirror server parse_hms validity
  if (["video", "convert", "gif"].includes(mode)) {
    if (state.selected === "2160") c += p["4k"] || 0;
    else if (state.selected === "4320") c += p["8k"] || 0;
  }
  if (o.subs && ["video", "audio", "convert"].includes(mode)) c += p.subtitles || 0;
  if (o.sponsorblock && ["video", "audio", "convert", "chapters"].includes(mode)) c += p.sponsorblock || 0;
  if (o.remaster && ["audio", "video"].includes(mode)) c += p.remaster || 0;
  return c;
}

export function updateCost() {
  const c = clientCost();
  $("#dlcost").textContent = "· " + c + " cr";
  setNeeded(c);
}

function selectMode(id) {
  const m = modeById(id);
  state.mode = id;
  $$("#modes .mode-chip").forEach((b) => b.classList.toggle("sel", b.dataset.mode === id));
  $$(".mode-pane").forEach((p) => p.classList.add("hidden"));
  const pane = $(`.mode-pane[data-pane="${m.pane}"]`);
  if (pane) pane.classList.remove("hidden");
  if (m.pane === "simple") $("#simple-desc").textContent = m.desc || "";
  // modifier rows: hide those not applicable AND clear their checkbox so a hidden,
  // still-checked modifier can't leak into the payload (e.g. music turning a video into audio).
  $$(".adv-body [data-mod]").forEach((row) => {
    const applicable = m.mods.includes(row.dataset.mod);
    row.classList.toggle("hidden", !applicable);
    if (!applicable) {
      const cb = row.querySelector('input[type="checkbox"]');
      if (cb) cb.checked = false;
    }
  });
  $("#adv").classList.toggle("hidden", m.mods.length === 0);
  updateCost();
}

function buildModes(d) {
  const host = $("#modes"); host.innerHTML = "";
  for (const m of MODES) {
    if (m.cap && !state.caps[m.cap]) continue;       // hide features whose dep isn't installed
    if (m.needs === "has_chapters" && !d.has_chapters) continue;
    const b = document.createElement("button");
    b.className = "mode-chip"; b.dataset.mode = m.id; b.textContent = m.label;
    b.setAttribute("role", "tab");
    b.onclick = () => selectMode(m.id);
    host.appendChild(b);
  }
}

export function renderSingle(d) {
  const settings = loadSettings();
  hide("#playlist"); hide("#batch"); hide("#empty");
  $("#thumb").src = d.thumbnail || "";
  $("#durbadge").textContent = d.duration_str || "";
  $("#durbadge").style.display = d.duration_str ? "" : "none";
  $("#title").textContent = d.title;
  $("#uploader").textContent = d.uploader || d.extractor;

  const seed = d.uploader || d.extractor || "?";
  const fallback = seed.trim().charAt(0).toUpperCase();
  const av = $("#ch-avatar");
  if (d.channel_avatar) {
    av.textContent = fallback;
    const img = new Image(); img.className = "avatar-img"; img.alt = "";
    img.onload = () => { av.textContent = ""; av.appendChild(img); };
    img.src = d.channel_avatar;
  } else {
    av.textContent = fallback;
  }
  $("#meta").textContent = [d.extractor, humanCount(d.view_count), d.duration_str].filter(Boolean).join("  •  ");

  // reset modifiers + trim
  resetTrim();
  $("#optSubs").checked = $("#optMusic").checked = $("#optRemaster").checked = $("#optSponsor").checked = false;
  $("#adv").open = false;
  setupTrim(d.duration, updateCost);

  // quality chips
  state.selected = settings.quality && d.qualities.some((q) => q.id === settings.quality) ? settings.quality : "best";
  $("#qualities").innerHTML = "";
  d.qualities.forEach((q) => {
    const el = document.createElement("button");
    el.className = "q-chip" + (q.kind === "audio" ? " audio" : "") + (q.id === state.selected ? " sel" : "");
    el.innerHTML = `<span class="q-label">${q.label}</span><span class="q-sub">${q.sub}</span>`;
    el.onclick = () => {
      state.selected = q.id;
      $$(".q-chip").forEach((c) => c.classList.remove("sel"));
      el.classList.add("sel"); updateCost();
    };
    $("#qualities").appendChild(el);
  });

  // chapters info
  if (d.has_chapters) {
    $("#chapters-info").textContent = `${d.chapters.length} chapters → one file each, delivered as a .zip.`;
  }

  // convert default
  $("#gifFps").value = settings.gifFps; $("#gifWidth").value = settings.gifWidth;

  buildModes(d);
  selectMode(d.is_playlist ? "video" : (settings.output === "audio" ? "audio" : "video"));
  show("#result");
}

export async function startDownload() {
  const d = state.current;
  if (!d) return;
  const btn = $("#downloadBtn");
  if (btn.disabled) return;          // guard against double-submit (best-effort dedup is server-side)
  const o = gatherOpts();
  const payload = {
    url: d.webpage_url, choice: state.selected, output: state.mode,
    convert_to: state.mode === "convert" ? $("#convertTo").value : null,
    gif_fps: parseInt($("#gifFps").value, 10) || 12,
    gif_width: parseInt($("#gifWidth").value, 10) || 480,
    ...o,
  };
  btn.disabled = true;
  try {
    const { ok, status, data } = await postJSON("/api/download", payload);
    if (status === 402) {
      toastErr(data.detail || "Out of Mythos credits", { action: { label: "Top up", onClick: () => $("#topupBtn").click() } });
      return;
    }
    if (!ok) { toastErr(data.detail || "Download failed to start"); return; }
    setBalance(data.balance);
    const qLabel = (d.qualities.find((q) => q.id === state.selected) || {}).label || state.selected;
    const tag = state.mode === "video" ? qLabel : state.mode;
    addJob(data.job_id, d.title, d.thumbnail, { ...payload, title: d.title, label: tag });
    btn.animate([{ transform: "scale(.96)" }, { transform: "scale(1)" }], { duration: 150 });
  } finally {
    btn.disabled = false;
  }
}
