const $ = (s) => document.querySelector(s);
const show = (s) => $(s).classList.remove("hidden");
const hide = (s) => $(s).classList.add("hidden");

let current = null;      // last fetched info
let selected = "best";   // chosen quality id
let cost = 2;            // base Mythos credits per download (from /api/session)

function humanCount(n) {
  if (!n) return "";
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B views";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M views";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K views";
  return n + " views";
}
function humanSize(b) {
  if (!b) return "";
  if (b >= 1e9) return (b / 1e9).toFixed(2) + " GB";
  if (b >= 1e6) return (b / 1e6).toFixed(1) + " MB";
  return Math.round(b / 1e3) + " KB";
}

// ---- time helpers + real avatars ------------------------------------------
function fmtClock(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
function parseClock(str) {          // "90" / "1:30" / "1:02:03" -> seconds (mirrors server parse_hms)
  if (!str) return null;
  const parts = String(str).trim().split(":").map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  return parts.reduce((a, n) => a * 60 + n, 0);
}
function setAvatar(el, seed, style, fallback) {   // real avatar image; letter shown until it loads / if it fails
  el.textContent = fallback || "";
  if (!seed) return;
  const img = new Image();
  img.className = "avatar-img"; img.alt = "";
  img.onload = () => { el.textContent = ""; el.appendChild(img); };
  img.src = `https://api.dicebear.com/9.x/${style}/svg?seed=${encodeURIComponent(seed)}`;
}

// ---- Mythos session / wallet ----------------------------------------------
async function loadSession() {
  try {
    const s = await (await fetch("/api/session")).json();
    cost = s.cost || 2;
    setAvatar($("#mythos-user"), s.email || s.user, "thumbs", (s.user || "?").trim().charAt(0).toUpperCase());
    $("#mythos-user").title = s.user || "";
    refreshCredits(s.balance);
  } catch { /* not launched */ }
}
function refreshCredits(balance) {
  $("#mythos-credits").textContent = "◎ " + (balance == null ? "—" : balance) + " cr";
  // Show top up when balance won't cover current selected cost (not just base cost)
  const needed = clientCost();
  $("#topupBtn").classList.toggle("hidden", balance == null || balance >= needed);
}
async function topUp() {
  const d = await (await fetch("/api/topup", { method: "POST" })).json();
  refreshCredits(d.balance);
  hideError();
}

// ---- error banner ----------------------------------------------------------
function showError(msg) {
  const el = $("#error");
  el.textContent = "";
  const txt = document.createElement("span");
  txt.textContent = "⚠ " + msg;
  const x = document.createElement("button");
  x.className = "err-close"; x.textContent = "×"; x.setAttribute("aria-label", "Dismiss");
  x.onclick = hideError;
  el.appendChild(txt); el.appendChild(x);
  show("#error");
}
function hideError() { hide("#error"); }

// ---- premium options + live credit cost (mirrors server cost_for) ----------
function gatherOpts() {
  return {
    start: $("#trimStart").value.trim() || null,
    end: $("#trimEnd").value.trim() || null,
    subs: $("#optSubs").checked,
    music: $("#optMusic").checked,
    sponsorblock: $("#optSponsor").checked,
  };
}
function clientCost() {
  let c = cost;
  const o = gatherOpts();
  if (o.start || o.end) c += 1;
  if (selected === "2160") c += 2;
  else if (selected === "4320") c += 4;
  if (o.subs) c += 1;
  if (o.music) c += 1;
  if (o.sponsorblock) c += 1;
  return c;
}
function updateCost() {
  $("#dlcost").textContent = "· " + clientCost() + " cr";
  // Re-evaluate top-up button whenever cost changes
  const pill = $("#mythos-credits").textContent;
  const m = pill.match(/◎ (\d+)/);
  if (m) refreshCredits(parseInt(m[1], 10));
}

// ---- playlist live cost ---------------------------------------------------
function updatePlaylistCost() {
  if (!current || !current.is_playlist) return;
  const count = current.count || 1;
  const kw = $("#plKw").value.trim();
  const minMin = parseFloat($("#plMin").value);
  let n = count;
  if ((kw || minMin) && current.items) {
    n = current.items.filter((it) => {
      if (minMin && (it.duration || 0) <= minMin * 60) return false;
      if (kw && !(it.title || "").toLowerCase().includes(kw.toLowerCase())) return false;
      return true;
    }).length || 1;
  }
  n = Math.min(n, current.cap || 10);
  const total = n * cost;
  $("#plcost").textContent = `· ${total} cr (${n} video${n === 1 ? "" : "s"})`;
}

// ---- trim slider (two handles, two-way synced with the text inputs) --------
let trimDur = 0;
function setupTrim(duration) {
  trimDur = Math.floor(duration || 0);
  const wrap = $("#trimRange");
  if (!trimDur) { wrap.classList.add("hidden"); return; }
  const rs = $("#rangeStart"), re = $("#rangeEnd");
  rs.max = re.max = trimDur; rs.value = 0; re.value = trimDur;
  $("#rangeMaxLbl").textContent = fmtClock(trimDur);
  wrap.classList.remove("hidden");
  paintRange();
}
function paintRange() {
  if (!trimDur) return;
  const rs = +$("#rangeStart").value, re = +$("#rangeEnd").value;
  $("#rangeSel").style.left = (rs / trimDur * 100) + "%";
  $("#rangeSel").style.right = (100 - re / trimDur * 100) + "%";
}
function onSlide(which) {            // handle moved -> write the text input (extreme = empty = no trim)
  let rs = +$("#rangeStart").value, re = +$("#rangeEnd").value;
  const MIN_GAP = Math.max(1, Math.min(5, trimDur / 20));
  if (which === "start" && rs > re - MIN_GAP) { rs = Math.max(0, re - MIN_GAP); $("#rangeStart").value = rs; }
  if (which === "end" && re < rs + MIN_GAP) { re = Math.min(trimDur, rs + MIN_GAP); $("#rangeEnd").value = re; }
  $("#trimStart").value = rs > 0 ? fmtClock(rs) : "";
  $("#trimEnd").value = re < trimDur ? fmtClock(re) : "";
  paintRange(); updateCost();
}
function onTrimText() {              // text typed -> move the handles
  if (!trimDur) { updateCost(); return; }
  const s = parseClock($("#trimStart").value), e = parseClock($("#trimEnd").value);
  $("#rangeStart").value = s != null ? Math.min(Math.max(0, s), trimDur) : 0;
  $("#rangeEnd").value = e != null ? Math.min(Math.max(0, e), trimDur) : trimDur;
  paintRange(); updateCost();
}

// ---- URL field helpers ----------------------------------------------------
function setUrl(url) {
  $("#url").value = url;
  $("#url-clear").style.display = url ? "flex" : "none";
}
function clearUrl() {
  setUrl("");
  hide("#result"); hide("#playlist"); hide("#error");
  show("#empty");
  $("#url").focus();
}

// ---- auto-paste detection -------------------------------------------------
async function checkClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    if (text && text !== $("#url").value && /^https?:\/\//i.test(text.trim())) {
      showPastePill(text.trim());
    }
  } catch { /* clipboard permission denied — ignore */ }
}
function showPastePill(url) {
  let pill = $("#paste-pill");
  if (!pill) {
    pill = document.createElement("div");
    pill.id = "paste-pill";
    pill.className = "paste-pill";
    document.body.appendChild(pill);
  }
  pill.innerHTML = "";
  const lbl = document.createElement("span");
  lbl.textContent = "Paste detected — ";
  const host = document.createElement("b");
  try { host.textContent = new URL(url).hostname; } catch { host.textContent = url.slice(0, 40); }
  const useBtn = document.createElement("button");
  useBtn.className = "paste-use"; useBtn.textContent = "Use it";
  useBtn.onclick = () => { setUrl(url); fetchInfo(url); pill.remove(); };
  const dismiss = document.createElement("button");
  dismiss.className = "paste-dismiss"; dismiss.textContent = "×";
  dismiss.onclick = () => pill.remove();
  pill.appendChild(lbl); pill.appendChild(host); pill.appendChild(useBtn); pill.appendChild(dismiss);
  pill.style.display = "flex";
  setTimeout(() => pill.remove(), 8000);
}

window.addEventListener("focus", checkClipboard);

async function fetchInfo(url) {
  if (!url) return;
  hide("#empty"); hide("#result"); hide("#playlist"); hide("#error"); show("#loading");
  try {
    const r = await fetch("/api/info", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || "Could not read that link.");
    current = data;
    if (data.is_playlist) renderPlaylist(data);
    else renderSingle(data);
  } catch (e) {
    showError(e.message);
  } finally {
    hide("#loading");
  }
}

function renderSingle(d) {
  hide("#playlist");
  $("#thumb").src = d.thumbnail || "";
  $("#durbadge").textContent = d.duration_str || "";
  $("#durbadge").style.display = d.duration_str ? "" : "none";
  $("#title").textContent = d.title;
  $("#uploader").textContent = d.uploader || d.extractor;
  setAvatar($("#ch-avatar"), d.uploader || d.extractor, "shapes", (d.uploader || d.extractor || "?").trim().charAt(0).toUpperCase());
  $("#meta").textContent = [d.extractor, humanCount(d.view_count), d.duration_str].filter(Boolean).join("  •  ");
  $("#result .dl-panel-head").textContent = "Choose a format";

  // reset advanced
  $("#trimStart").value = ""; $("#trimEnd").value = "";
  $("#optSubs").checked = $("#optMusic").checked = $("#optSponsor").checked = false;
  $("#adv").open = false;
  setupTrim(d.duration);

  selected = "best";
  $("#qualities").innerHTML = "";
  d.qualities.forEach((q, i) => {
    const el = document.createElement("button");
    el.className = "q-chip" + (q.kind === "audio" ? " audio" : "") + (i === 0 ? " sel" : "");
    el.innerHTML = `<span class="q-label">${q.label}</span><span class="q-sub">${q.sub}</span>`;
    el.onclick = () => {
      selected = q.id;
      document.querySelectorAll(".q-chip").forEach((c) => c.classList.remove("sel"));
      el.classList.add("sel");
      updateCost();
    };
    $("#qualities").appendChild(el);
  });
  updateCost();
  show("#result");
}

function renderPlaylist(d) {
  hide("#result");
  $("#pl-thumb").src = d.thumbnail || "";
  $("#pl-count").textContent = (d.count || "?") + " videos";
  $("#pl-title").textContent = d.title;
  $("#pl-by").textContent = [d.uploader, `up to ${d.cap} per batch · ${cost} cr each`].filter(Boolean).join(" • ");
  const items = d.items || [];
  $("#pl-items").innerHTML = items.map((it) =>
    `<div class="pl-item"><span>${it.title}</span><span class="d">${it.duration_str || ""}</span></div>`).join("")
    + (((d.count || 0) > items.length) ? `<div class="pl-item d">+ ${d.count - items.length} more…</div>` : "");
  $("#plMin").value = ""; $("#plKw").value = "";
  updatePlaylistCost();
  show("#playlist");
}

async function startDownload() {
  if (!current) return;
  const btn = $("#downloadBtn");
  const o = gatherOpts();
  const r = await fetch("/api/download", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: current.webpage_url, choice: selected, ...o }),
  });
  const data = await r.json();
  if (r.status === 402) { showError(data.detail || "Out of Mythos credits"); await loadSession(); return; }
  if (!r.ok) { showError(data.detail || "Download failed to start"); return; }
  if (data.balance != null) refreshCredits(data.balance);
  const qLabel = (current.qualities.find((q) => q.id === selected) || {}).label || selected;
  const tags = [o.music && "music", o.subs && "subs", (o.start || o.end) && "clip", o.sponsorblock && "no-sponsor"].filter(Boolean);
  addJob(data.job_id, current.thumbnail, current.title, [qLabel, ...tags].join(" · "), { url: current.webpage_url, choice: selected, ...o });
  btn.animate([{ transform: "scale(.96)" }, { transform: "scale(1)" }], { duration: 150 });
}

async function startPlaylist() {
  if (!current || !current.is_playlist) return;
  const r = await fetch("/api/download", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: current.webpage_url, playlist: true,
      min_minutes: parseFloat($("#plMin").value) || null,
      keyword: $("#plKw").value.trim() || null,
    }),
  });
  const data = await r.json();
  if (r.status === 402) { showError(data.detail || "Out of Mythos credits"); await loadSession(); return; }
  if (!r.ok) { showError(data.detail || "Batch failed to start"); return; }
  if (data.balance != null) refreshCredits(data.balance);
  addJob(data.job_id, current.thumbnail, current.title, `batch · charged ${data.charged} cr`, null);
}

// ---- job localStorage persistence -----------------------------------------
const LS_KEY = "pluck_jobs_v1";
function saveJobToStorage(jobId, thumb, title, label) {
  try {
    const stored = JSON.parse(localStorage.getItem(LS_KEY) || "[]");
    stored.unshift({ jobId, thumb, title, label, ts: Date.now() });
    // Keep last 50 entries, drop older than 24h
    const cutoff = Date.now() - 86400000;
    localStorage.setItem(LS_KEY, JSON.stringify(stored.filter((j) => j.ts > cutoff).slice(0, 50)));
  } catch { /* storage quota */ }
}
function removeJobFromStorage(jobId) {
  try {
    const stored = JSON.parse(localStorage.getItem(LS_KEY) || "[]");
    localStorage.setItem(LS_KEY, JSON.stringify(stored.filter((j) => j.jobId !== jobId)));
  } catch {}
}

function addJob(jobId, thumb, title, label, retryParams) {
  show("#downloads");
  const el = document.createElement("div");
  el.className = "job";
  el.dataset.jobId = jobId;

  const thumbEl = document.createElement("img");
  thumbEl.className = "job-thumb"; thumbEl.alt = "";
  thumbEl.src = thumb || "";

  const main = document.createElement("div");
  main.className = "job-main";

  const titleEl = document.createElement("div");
  titleEl.className = "job-title";
  titleEl.textContent = title;  // textContent — no XSS

  const sub = document.createElement("div");
  sub.className = "job-sub";
  const subLabel = document.createElement("span");
  subLabel.textContent = label;
  const sizeEl = document.createElement("span"); sizeEl.className = "js-size";
  const speedEl = document.createElement("span"); speedEl.className = "js-speed";
  sub.appendChild(subLabel); sub.appendChild(sizeEl); sub.appendChild(speedEl);

  const bar = document.createElement("div"); bar.className = "bar indet";
  const fill = document.createElement("span"); bar.appendChild(fill);

  const status = document.createElement("div"); status.className = "job-status";
  status.textContent = "Starting…";

  main.appendChild(titleEl); main.appendChild(sub); main.appendChild(bar); main.appendChild(status);

  const action = document.createElement("div"); action.className = "job-action";
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn-cancel"; cancelBtn.textContent = "Cancel";
  cancelBtn.onclick = () => cancelJob(jobId, el, cancelBtn);
  action.appendChild(cancelBtn);

  el.appendChild(thumbEl); el.appendChild(main); el.appendChild(action);
  $("#jobs").prepend(el);
  saveJobToStorage(jobId, thumb, title, label);
  pollJob(jobId, el, { bar, fill, status, sizeEl, speedEl, action, cancelBtn }, retryParams);
}

async function cancelJob(jobId, el, btn) {
  btn.disabled = true;
  await fetch("/api/jobs/" + jobId, { method: "DELETE" });
  // poll will detect "cancelled" status and update UI
}

function pollJob(jobId, el, { bar, fill, status, sizeEl, speedEl, action, cancelBtn }, retryParams) {
  let failCount = 0;
  const timer = setInterval(async () => {
    let j;
    try {
      const res = await fetch("/api/jobs/" + jobId);
      if (res.status === 404) {
        // Server restarted — mark stale
        clearInterval(timer);
        bar.classList.remove("indet"); fill.style.width = "0";
        status.className = "job-status err";
        status.textContent = "⚠ Lost — server restarted";
        action.innerHTML = "";
        removeJobFromStorage(jobId);
        return;
      }
      j = await res.json();
      failCount = 0;
    } catch {
      if (++failCount > 5) {
        clearInterval(timer);
        status.textContent = "⚠ Lost connection";
      }
      return;
    }

    if (j.status === "cancelled") {
      clearInterval(timer);
      bar.classList.remove("indet"); bar.style.opacity = ".3";
      status.className = "job-status err";
      status.textContent = "Cancelled";
      action.innerHTML = "";
      removeJobFromStorage(jobId);
    } else if (j.playlist && (j.status === "downloading" || j.status === "processing")) {
      status.textContent = `Downloading ${j.items_done || 0}/${j.items_total || "?"} — ${(j.current || "").slice(0, 42)}`;
      speedEl.textContent = j.speed || "";
    } else if (j.status === "downloading") {
      if (j.progress != null) { bar.classList.remove("indet"); fill.style.width = j.progress + "%"; }
      status.textContent = `Downloading ${j.progress != null ? j.progress + "%" : ""}`;
      sizeEl.textContent = humanSize(j.total_bytes);
      speedEl.textContent = j.speed || "";
    } else if (j.status === "processing") {
      bar.classList.remove("indet"); fill.style.width = "100%";
      status.textContent = "Processing…";
      speedEl.textContent = "";
    } else if (j.status === "done") {
      clearInterval(timer);
      bar.classList.remove("indet"); fill.style.width = "100%";
      status.innerHTML = `<span class="chip-done">✓ Ready</span>`;
      sizeEl.textContent = humanSize(j.size);
      speedEl.textContent = "";
      action.innerHTML = "";
      const a = document.createElement("a");
      a.className = "btn-save"; a.href = "/api/file/" + jobId; a.setAttribute("download", "");
      a.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 16l-5-5h3V4h4v7h3l-5 5zm-7 2h14v2H5v-2z"/></svg> Save`;
      action.appendChild(a);
      removeJobFromStorage(jobId);
    } else if (j.status === "error") {
      clearInterval(timer);
      bar.classList.add("indet"); bar.style.opacity = ".3";
      status.className = "job-status err";
      status.textContent = "⚠ Failed: " + (j.error || "unknown error");
      action.innerHTML = "";
      if (retryParams) {
        const retryBtn = document.createElement("button");
        retryBtn.className = "btn-cancel"; retryBtn.textContent = "↻ Retry";
        retryBtn.onclick = async () => {
          retryBtn.disabled = true;
          const res = await fetch("/api/download", {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify(retryParams),
          });
          const data = await res.json();
          if (!res.ok) { retryBtn.disabled = false; showError(data.detail || "Retry failed"); return; }
          if (data.balance != null) refreshCredits(data.balance);
          el.remove();
          addJob(data.job_id, el.querySelector(".job-thumb").src, el.querySelector(".job-title").textContent,
                 el.querySelector(".job-sub span").textContent, retryParams);
        };
        action.appendChild(retryBtn);
      }
      removeJobFromStorage(jobId);
    }
  }, 600);
}

// ---- clear completed jobs -------------------------------------------------
function clearDoneJobs() {
  document.querySelectorAll(".job").forEach((el) => {
    const st = el.querySelector(".job-status");
    if (st && (st.querySelector(".chip-done") || st.classList.contains("err"))) {
      el.remove();
    }
  });
  if (!$("#jobs").children.length) hide("#downloads");
}

// ---- keyboard shortcuts ---------------------------------------------------
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "v" && document.activeElement !== $("#url")) {
    $("#url").focus();
  }
  if (e.key === "Escape") {
    const pill = $("#paste-pill");
    if (pill) { pill.remove(); return; }
    if (!$("#error").classList.contains("hidden")) { hideError(); return; }
    clearUrl();
  }
});

// ---- event wiring ---------------------------------------------------------
$("#search").addEventListener("submit", (e) => {
  e.preventDefault();
  const u = $("#url").value.trim();
  if (u) { setUrl(u); fetchInfo(u); }
});
$("#url").addEventListener("input", () => {
  $("#url-clear").style.display = $("#url").value ? "flex" : "none";
});
$("#url-clear").addEventListener("click", clearUrl);
$("#downloadBtn").addEventListener("click", startDownload);
$("#plDownloadBtn").addEventListener("click", startPlaylist);
$("#topupBtn").addEventListener("click", topUp);
$("#clear-done-btn").addEventListener("click", clearDoneJobs);
["trimStart", "trimEnd"].forEach((id) => $("#" + id).addEventListener("input", onTrimText));
$("#rangeStart").addEventListener("input", () => onSlide("start"));
$("#rangeEnd").addEventListener("input", () => onSlide("end"));
["optSubs", "optMusic", "optSponsor"].forEach((id) => $("#" + id).addEventListener("change", updateCost));
["plMin", "plKw"].forEach((id) => $("#" + id).addEventListener("input", updatePlaylistCost));
document.querySelectorAll(".ex").forEach((b) => b.addEventListener("click", () => {
  setUrl(b.dataset.url); fetchInfo(b.dataset.url);
}));

loadSession();
