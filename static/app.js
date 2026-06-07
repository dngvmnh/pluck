const $ = (s) => document.querySelector(s);
const show = (s) => $(s).classList.remove("hidden");
const hide = (s) => $(s).classList.add("hidden");

let current = null;      // last fetched info
let selected = "best";   // chosen quality id
let cost = 1;            // Mythos credits per download (from /api/session)

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
    cost = s.cost || 1;
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

async function fetchInfo(url) {
  hide("#empty"); hide("#result"); hide("#error"); show("#loading");
  try {
    const r = await fetch("/api/info", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || "Could not read that link.");
    current = data;
    renderResult(data);
  } catch (e) {
    $("#error").textContent = "⚠ " + e.message;
    show("#error");
  } finally {
    hide("#loading");
  }
}

function renderResult(d) {
  $("#thumb").src = d.thumbnail || "";
  $("#durbadge").textContent = d.duration_str || "";
  $("#durbadge").style.display = d.duration_str ? "" : "none";
  $("#title").textContent = d.title;
  $("#uploader").textContent = d.uploader || d.extractor;
  $("#ch-avatar").textContent = (d.uploader || d.extractor || "?").trim().charAt(0);
  $("#meta").textContent = [d.extractor, humanCount(d.view_count), d.duration_str].filter(Boolean).join("  •  ");
  $(".dl-panel-head").textContent = `Choose a format — this download costs ${cost} Mythos credit${cost === 1 ? "" : "s"}`;

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
    };
    $("#qualities").appendChild(el);
  });
  show("#result");
}

async function startDownload() {
  if (!current) return;
  const btn = $("#downloadBtn");
  const r = await fetch("/api/download", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: current.webpage_url, choice: selected }),
  });
  const data = await r.json();
  if (r.status === 402) {                       // PAYMENT: out of Mythos credits
    $("#error").textContent = "⚠ " + (data.detail || "Out of Mythos credits");
    show("#error");
    await loadSession();                         // refresh real balance + reveal Top up
    return;
  }
  if (!r.ok) { alert(data.detail || "Download failed to start"); return; }
  if (data.balance != null) refreshCredits(data.balance);   // wallet was debited
  addJob(data.job_id, current, selected);
  btn.animate([{ transform: "scale(.96)" }, { transform: "scale(1)" }], { duration: 150 });
}

function addJob(jobId, info, choice) {
  show("#downloads");
  const qLabel = (info.qualities.find((q) => q.id === choice) || {}).label || choice;
  const el = document.createElement("div");
  el.className = "job";
  el.innerHTML = `
    <img class="job-thumb" src="${info.thumbnail || ""}" alt="">
    <div class="job-main">
      <div class="job-title">${info.title}</div>
      <div class="job-sub"><span>${qLabel}</span><span class="js-size"></span><span class="js-speed"></span></div>
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

    if (j.status === "downloading") {
      if (j.progress != null) { bar.classList.remove("indet"); fill.style.width = j.progress + "%"; }
      status.textContent = `Downloading ${j.progress != null ? j.progress + "%" : ""}`;
      sizeEl.textContent = humanSize(j.total_bytes);
      speedEl.textContent = j.speed || "";
    } else if (j.status === "processing") {
      bar.classList.remove("indet"); fill.style.width = "100%";
      status.textContent = "Processing (merging audio + video)…";
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
$("#topupBtn").addEventListener("click", topUp);
document.querySelectorAll(".ex").forEach((b) => b.addEventListener("click", () => {
  $("#url").value = b.dataset.url; fetchInfo(b.dataset.url);
}));
loadSession();
