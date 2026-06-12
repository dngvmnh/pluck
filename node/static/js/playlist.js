// Playlist (bulk) view: render, live cost, start batch.
import { postJSON } from "./api.js";
import { $, hide, show, state } from "./store.js";
import { setBalance } from "./session.js";
import { addJob } from "./jobs.js";
import { toastErr } from "./toast.js";

export function updatePlaylistCost() {
  const d = state.current;
  if (!d || !d.is_playlist) return;
  const base = state.pricing.base || 2;
  const kw = $("#plKw").value.trim();
  const minMin = parseFloat($("#plMin").value);
  let n = d.count || 1;
  if ((kw || minMin) && d.items) {
    n = d.items.filter((it) => {
      if (minMin && (it.duration || 0) <= minMin * 60) return false;
      if (kw && !(it.title || "").toLowerCase().includes(kw.toLowerCase())) return false;
      return true;
    }).length || 1;
  }
  n = Math.min(n, d.cap || 10);
  $("#plcost").textContent = `· ${n * base} cr (${n} video${n === 1 ? "" : "s"})`;
}

export function renderPlaylist(d) {
  hide("#result"); hide("#batch"); hide("#empty");
  const base = state.pricing.base || 2;
  $("#pl-thumb").src = d.thumbnail || "";
  $("#pl-count").textContent = (d.count || "?") + " videos";
  $("#pl-title").textContent = d.title;
  $("#pl-by").textContent = [d.uploader, `up to ${d.cap} per batch · ${base} cr each`].filter(Boolean).join(" • ");
  const items = d.items || [];
  const host = $("#pl-items");
  host.innerHTML = "";
  for (const it of items) {
    const row = document.createElement("div"); row.className = "pl-item";
    const t = document.createElement("span"); t.textContent = it.title || "";          // textContent — no XSS
    const dur = document.createElement("span"); dur.className = "d"; dur.textContent = it.duration_str || "";
    row.append(t, dur); host.appendChild(row);
  }
  if ((d.count || 0) > items.length) {
    const more = document.createElement("div"); more.className = "pl-item d";
    more.textContent = `+ ${d.count - items.length} more…`;
    host.appendChild(more);
  }
  $("#plMin").value = ""; $("#plKw").value = "";
  updatePlaylistCost();
  show("#playlist");
}

export async function startPlaylist() {
  const d = state.current;
  if (!d || !d.is_playlist) return;
  const payload = {
    url: d.webpage_url, playlist: true,
    min_minutes: parseFloat($("#plMin").value) || null,
    keyword: $("#plKw").value.trim() || null,
  };
  const { ok, status, data } = await postJSON("/api/download", payload);
  if (status === 402) {
    toastErr(data.detail || "Out of Mythos credits", { action: { label: "Top up", onClick: () => $("#topupBtn").click() } });
    return;
  }
  if (!ok) { toastErr(data.detail || "Batch failed to start"); return; }
  setBalance(data.balance);
  addJob(data.job_id, d.title, d.thumbnail, null);
}
