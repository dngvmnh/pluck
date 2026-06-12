// Download manager + Library (server-backed history).
import { getJSON, postJSON } from "./api.js";
import { $, $$, hide, humanSize, show } from "./store.js";
import { setBalance } from "./session.js";
import { toastErr } from "./toast.js";

const ACTIVE = new Set(["queued", "downloading", "processing"]);
const DL_ICON = `<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 16l-5-5h3V4h4v7h3l-5 5zm-7 2h14v2H5v-2z"/></svg>`;

function makeCard(job) {
  const el = document.createElement("div");
  el.className = "job"; el.dataset.jobId = job.id;

  const thumb = document.createElement("img");
  thumb.className = "job-thumb"; thumb.alt = ""; thumb.src = job.thumb || "";

  const main = document.createElement("div"); main.className = "job-main";
  const title = document.createElement("div"); title.className = "job-title";
  title.textContent = job.title || job.filename || "Download";
  const sub = document.createElement("div"); sub.className = "job-sub";
  const subLabel = document.createElement("span"); subLabel.textContent = job.label || job.output || "";
  const sizeEl = document.createElement("span"); sizeEl.className = "js-size";
  const speedEl = document.createElement("span"); speedEl.className = "js-speed";
  sub.append(subLabel, sizeEl, speedEl);
  const bar = document.createElement("div"); bar.className = "bar indet";
  const fill = document.createElement("span"); bar.appendChild(fill);
  const status = document.createElement("div"); status.className = "job-status"; status.textContent = "Starting…";
  main.append(title, sub, bar, status);

  const action = document.createElement("div"); action.className = "job-action";

  el.append(thumb, main, action);
  return { el, els: { bar, fill, status, sizeEl, speedEl, action } };
}

function renderState(j, els, { retryParams = null } = {}) {
  const { bar, fill, status, sizeEl, speedEl, action } = els;
  if (j.status === "cancelled") {
    bar.classList.remove("indet"); bar.style.opacity = ".3";
    status.className = "job-status err"; status.textContent = "Cancelled";
    action.innerHTML = "";
  } else if (j.output === "playlist" && ACTIVE.has(j.status)) {
    status.textContent = `Downloading ${j.items_done || 0}/${j.items_total || "?"} — ${(j.label || "").slice(0, 42)}`;
    speedEl.textContent = j.speed || "";
  } else if (j.status === "downloading") {
    if (j.progress != null) { bar.classList.remove("indet"); fill.style.width = j.progress + "%"; }
    status.textContent = `Downloading ${j.progress != null ? j.progress + "%" : ""}`;
    sizeEl.textContent = humanSize(j.total_bytes); speedEl.textContent = j.speed || "";
  } else if (j.status === "processing") {
    bar.classList.remove("indet"); fill.style.width = "100%";
    status.textContent = "Processing…"; speedEl.textContent = "";
  } else if (j.status === "queued") {
    status.textContent = "Queued…";
  } else if (j.status === "done") {
    bar.classList.remove("indet"); fill.style.width = "100%";
    status.innerHTML = `<span class="chip-done">✓ Ready</span>`;
    sizeEl.textContent = humanSize(j.size); speedEl.textContent = "";
    action.innerHTML = "";
    const a = document.createElement("a");
    a.className = "btn-save"; a.href = "/api/file/" + j.id; a.setAttribute("download", "");
    a.innerHTML = `${DL_ICON} Save`;
    action.appendChild(a);
  } else if (j.status === "interrupted") {
    bar.classList.remove("indet"); bar.style.opacity = ".3";
    status.className = "job-status err"; status.textContent = "⚠ Interrupted — server restarted";
    action.innerHTML = "";
  } else if (j.status === "error") {
    bar.classList.add("indet"); bar.style.opacity = ".3";
    status.className = "job-status err"; status.textContent = "⚠ Failed: " + (j.error || "unknown error");
    action.innerHTML = "";
    if (retryParams) addRetry(action, retryParams);
  }
}

function addRetry(action, retryParams) {
  const btn = document.createElement("button");
  btn.className = "btn-cancel"; btn.textContent = "↻ Retry";
  btn.onclick = async () => {
    btn.disabled = true;
    const { ok, data } = await postJSON("/api/download", retryParams);
    if (!ok) { btn.disabled = false; toastErr(data.detail || "Retry failed"); return; }
    setBalance(data.balance);
    const card = action.closest(".job");
    if (card) card.remove();
    addJob(data.job_id, retryParams.title || "Download", null, retryParams);
  };
  action.appendChild(btn);
}

function poll(jobId, els, retryParams) {
  let fails = 0;
  const timer = setInterval(async () => {
    const { ok, status, data } = await getJSON("/api/jobs/" + jobId);
    if (status === 404) {
      clearInterval(timer);
      els.bar.classList.remove("indet"); els.status.className = "job-status err";
      els.status.textContent = "⚠ Lost — job expired"; els.action.innerHTML = "";
      return;
    }
    if (!ok) { if (++fails > 5) { clearInterval(timer); els.status.textContent = "⚠ Lost connection"; } return; }
    fails = 0;
    renderState(data, els, { retryParams });
    if (!ACTIVE.has(data.status)) clearInterval(timer);
  }, 600);
}

// Start tracking a freshly created job in the Active downloads list.
export function addJob(jobId, title, thumb, retryParams = null) {
  show("#downloads");
  const { el, els } = makeCard({ id: jobId, title, thumb, label: retryParams?.label });
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn-cancel"; cancelBtn.textContent = "Cancel";
  cancelBtn.onclick = async () => { cancelBtn.disabled = true; await postJSON("/api/jobs/" + jobId, null, "DELETE"); };
  els.action.appendChild(cancelBtn);
  $("#jobs").prepend(el);
  poll(jobId, els, retryParams);
}

export function clearDoneJobs() {
  $$(".job").forEach((el) => {
    const st = el.querySelector(".job-status");
    if (st && (st.querySelector(".chip-done") || st.classList.contains("err"))) el.remove();
  });
  if (!$("#jobs").children.length) hide("#downloads");
}

// ---- Library (server history) ----
export async function renderLibrary() {
  const { ok, data } = await getJSON("/api/jobs");
  const host = $("#library");
  host.innerHTML = "";
  const jobs = (ok && data.jobs) || [];
  $("#library-empty").classList.toggle("hidden", jobs.length > 0);
  for (const j of jobs) {
    const { el, els } = makeCard(j);
    if (j.status === "done") {
      const rm = document.createElement("button");
      rm.className = "btn-cancel"; rm.textContent = "Remove";
      rm.onclick = async () => { await postJSON("/api/jobs/" + j.id, null, "DELETE"); el.remove(); };
      els.action.appendChild(rm);
    }
    host.appendChild(el);
    renderState(j, els);
    if (ACTIVE.has(j.status)) poll(j.id, els, null);
  }
}
