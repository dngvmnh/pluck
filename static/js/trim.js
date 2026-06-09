// Two-handle trim slider, two-way synced with the timestamp inputs.
import { $, fmtClock, parseClock } from "./store.js";

let trimDur = 0;
let _onChange = () => {};

export function getTrim() {
  return { start: $("#trimStart").value.trim() || null, end: $("#trimEnd").value.trim() || null };
}

export function resetTrim() {
  $("#trimStart").value = ""; $("#trimEnd").value = "";
}

export function setupTrim(duration, onChange) {
  _onChange = onChange || (() => {});
  trimDur = Math.floor(duration || 0);
  const wrap = $("#trimRange");
  if (!trimDur) { wrap.classList.add("hidden"); return; }
  const rs = $("#rangeStart"), re = $("#rangeEnd");
  rs.max = re.max = trimDur; rs.value = 0; re.value = trimDur;
  $("#rangeMaxLbl").textContent = fmtClock(trimDur);
  wrap.classList.remove("hidden");
  paint();
}

function paint() {
  if (!trimDur) return;
  const rs = +$("#rangeStart").value, re = +$("#rangeEnd").value;
  $("#rangeSel").style.left = (rs / trimDur * 100) + "%";
  $("#rangeSel").style.right = (100 - re / trimDur * 100) + "%";
}

function onSlide(which) {
  let rs = +$("#rangeStart").value, re = +$("#rangeEnd").value;
  const MIN_GAP = Math.max(1, Math.min(5, trimDur / 20));
  if (which === "start" && rs > re - MIN_GAP) { rs = Math.max(0, re - MIN_GAP); $("#rangeStart").value = rs; }
  if (which === "end" && re < rs + MIN_GAP) { re = Math.min(trimDur, rs + MIN_GAP); $("#rangeEnd").value = re; }
  $("#trimStart").value = rs > 0 ? fmtClock(rs) : "";
  $("#trimEnd").value = re < trimDur ? fmtClock(re) : "";
  paint(); _onChange();
}

function onTrimText() {
  if (!trimDur) { _onChange(); return; }
  const s = parseClock($("#trimStart").value), e = parseClock($("#trimEnd").value);
  $("#rangeStart").value = s != null ? Math.min(Math.max(0, s), trimDur) : 0;
  $("#rangeEnd").value = e != null ? Math.min(Math.max(0, e), trimDur) : trimDur;
  paint(); _onChange();
}

export function wireTrim() {
  ["trimStart", "trimEnd"].forEach((id) => $("#" + id).addEventListener("input", onTrimText));
  $("#rangeStart").addEventListener("input", () => onSlide("start"));
  $("#rangeEnd").addEventListener("input", () => onSlide("end"));
}
