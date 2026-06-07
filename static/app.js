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

// ---- Mythos session / wallet ----------------------------------------------
async function loadSession() {
  try {
    const s = await (await fetch("/api/session")).json();
    cost = s.cost || 2;
    $("#mythos-user").textContent = (s.user || "?").trim().charAt(0).toUpperCase();
    $("#mythos-user").title = s.user || "";
    refreshCredits(s.balance);
  } catch { /* not launched */ }
}
function refreshCredits(balance) {
  $("#mythos-credits").textContent = "◎ " + (balance == null ? "—" : balance) + " cr";
  $("#topupBtn").classList.toggle("hidden", balance == null || balance >= cost);
}
async function topUp() {
  const d = await (await fetch("/api/topup", { method: "POST" })).json();
  refreshCredits(d.balance);
  hide("#error");
}

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
function updateCost() { $("#dlcost").textContent = "· " + clientCost() + " cr"; }

async function fetchInfo(url) {
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
    $("#error").textContent = "⚠ " + e.message;
    show("#error");
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
  $("#ch-avatar").textContent = (d.uploader || d.extractor || "?").trim().charAt(0);
  $("#meta").textContent = [d.extractor, humanCount(d.view_count), d.duration_str].filter(Boolean).join("  •  ");
  $("#result .dl-panel-head").textContent = "Choose a format";

  // reset advanced
  $("#trimStart").value = ""; $("#trimEnd").value = "";
  $("#optSubs").checked = $("#optMusic").checked = $("#optSponsor").checked = false;
  $("#adv").open = false;

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
  $("#pl-by").textContent = [d.uploader, `up to ${d.cap} per batch · 2 cr each`].filter(Boolean).join(" • ");
  const items = d.items || [];
  $("#pl-items").innerHTML = items.map((it) =>
    `<div class="pl-item"><span>${it.title}</span><span class="d">${it.duration_str || ""}</span></div>`).join("")
    + (((d.count || 0) > items.length) ? `<div class="pl-item d">+ ${d.count - items.length} more…</div>` : "");
  $("#plMin").value = ""; $("#plKw").value = "";
  $("#plcost").textContent = "";
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
  if (r.status === 402) { $("#error").textContent = "⚠ " + (data.detail || "Out of Mythos credits"); show("#error"); await loadSession(); return; }
  if (!r.ok) { alert(data.detail || "Download failed to start"); return; }
  if (data.balance != null) refreshCredits(data.balance);
  const qLabel = (current.qualities.find((q) => q.id === selected) || {}).label || selected;
  const tags = [o.music && "music", o.subs && "subs", (o.start || o.end) && "clip", o.sponsorblock && "no-sponsor"].filter(Boolean);
  addJob(data.job_id, current.thumbnail, current.title, [qLabel, ...tags].join(" · "));
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
  if (r.status === 402) { $("#error").textContent = "⚠ " + (data.detail || "Out of Mythos credits"); show("#error"); await loadSession(); return; }
  if (!r.ok) { alert(data.detail || "Batch failed to start"); return; }
  if (data.balance != null) refreshCredits(data.balance);
  addJob(data.job_id, current.thumbnail, current.title, `batch · charged ${data.charged} cr`);
}

function addJob(jobId, thumb, title, label) {
  show("#downloads");
  const el = document.createElement("div");
  el.className = "job";
  el.innerHTML = `
    <img class="job-thumb" src="${thumb || ""}" alt="">
    <div class="job-main">
      <div class="job-title">${title}</div>
      <div class="job-sub"><span>${label}</span><span class="js-size"></span><span class="js-speed"></span></div>
      <div class="bar indet"><span></span></div>
      <div class="job-status">Starting…</div>
    </div>
    <div class="job-action"></div>`;
  $("#jobs").prepend(el);
  pollJob(jobId, el);
}

function pollJob(jobId, el) {
  const bar = el.querySelector(".bar");
  const fill = el.querySelector(".bar > span");
  const status = el.querySelector(".job-status");
  const sizeEl = el.querySelector(".js-size");
  const speedEl = el.querySelector(".js-speed");
  const action = el.querySelector(".job-action");

  const timer = setInterval(async () => {
    let j;
    try { j = await (await fetch("/api/jobs/" + jobId)).json(); }
    catch { return; }

    if (j.playlist && (j.status === "downloading" || j.status === "processing")) {
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
      const a = document.createElement("a");
      a.className = "btn-save"; a.href = "/api/file/" + jobId; a.setAttribute("download", "");
      a.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 16l-5-5h3V4h4v7h3l-5 5zm-7 2h14v2H5v-2z"/></svg> Save`;
      action.innerHTML = ""; action.appendChild(a);
    } else if (j.status === "error") {
      clearInterval(timer);
      bar.classList.add("indet"); bar.style.opacity = ".3";
      status.className = "job-status err";
      status.textContent = "⚠ Failed: " + (j.error || "unknown error");
    }
  }, 600);
}

$("#search").addEventListener("submit", (e) => { e.preventDefault(); const u = $("#url").value.trim(); if (u) fetchInfo(u); });
$("#downloadBtn").addEventListener("click", startDownload);
$("#plDownloadBtn").addEventListener("click", startPlaylist);
$("#topupBtn").addEventListener("click", topUp);
["trimStart", "trimEnd"].forEach((id) => $("#" + id).addEventListener("input", updateCost));
["optSubs", "optMusic", "optSponsor"].forEach((id) => $("#" + id).addEventListener("change", updateCost));
document.querySelectorAll(".ex").forEach((b) => b.addEventListener("click", () => {
  $("#url").value = b.dataset.url; fetchInfo(b.dataset.url);
}));
loadSession();
