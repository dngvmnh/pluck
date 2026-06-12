// Multi-URL batch grab.
import { postJSON } from "./api.js";
import { $, hide, show, state } from "./store.js";
import { setBalance } from "./session.js";
import { addJob } from "./jobs.js";
import { toast, toastErr } from "./toast.js";

let _urls = [];

export function detectUrls(text) {
  return (text || "").split(/[\n\r]+/).map((s) => s.trim())
    .filter((s) => /^https?:\/\//i.test(s));
}

export function renderBatch(urls) {
  _urls = urls;
  hide("#result"); hide("#playlist"); hide("#empty");
  $("#batch-count").textContent = urls.length;
  const list = $("#batch-list");
  list.innerHTML = "";
  for (const u of urls) {
    let host = u; try { host = new URL(u).hostname; } catch { /* keep raw */ }
    const row = document.createElement("div"); row.className = "pl-item";
    const h = document.createElement("span"); h.textContent = host;            // textContent — no XSS
    const full = document.createElement("span"); full.className = "d"; full.textContent = u.slice(0, 50);
    row.append(h, full); list.appendChild(row);
  }
  updateBatchCost();
  show("#batch");
}

export function updateBatchCost() {
  const base = state.pricing.base || 2;
  $("#batchcost").textContent = `· ~${_urls.length * base} cr`;
}

export async function startBatch() {
  if (!_urls.length) return;
  const payload = { urls: _urls, choice: $("#batch-choice").value, output: "video" };
  const { ok, status, data } = await postJSON("/api/download", payload);
  if (status === 402) { toastErr(data.detail || "Out of credits"); return; }
  if (!ok) { toastErr(data.detail || "Batch failed"); return; }
  setBalance(data.balance);
  let started = 0, failed = 0;
  for (const j of data.jobs || []) {
    if (j.job_id) { addJob(j.job_id, j.url, null, null); started++; }
    else failed++;
  }
  toast(`Started ${started} download${started === 1 ? "" : "s"}` + (failed ? `, ${failed} failed` : ""),
        { type: failed ? "error" : "success" });
}
