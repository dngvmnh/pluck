// Toast notifications (replaces the single error banner).
import { $ } from "./store.js";

export function toast(msg, { type = "info", action = null, timeout = 5000 } = {}) {
  const host = $("#toasts");
  if (!host) return;
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.setAttribute("role", type === "error" ? "alert" : "status");

  const icon = { info: "ℹ", success: "✓", error: "⚠" }[type] || "ℹ";
  const ico = document.createElement("span");
  ico.className = "toast-ico"; ico.textContent = icon;

  const txt = document.createElement("span");
  txt.className = "toast-msg"; txt.textContent = msg;

  el.appendChild(ico); el.appendChild(txt);

  if (action) {
    const btn = document.createElement("button");
    btn.className = "toast-action"; btn.textContent = action.label;
    btn.onclick = () => { action.onClick(); dismiss(); };
    el.appendChild(btn);
  }
  const x = document.createElement("button");
  x.className = "toast-close"; x.textContent = "×"; x.setAttribute("aria-label", "Dismiss");
  x.onclick = () => dismiss();
  el.appendChild(x);

  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add("in"));
  let timer = timeout ? setTimeout(dismiss, timeout) : null;

  function dismiss() {
    if (timer) clearTimeout(timer);
    el.classList.remove("in");
    el.addEventListener("transitionend", () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 300);
  }
  return dismiss;
}

export const toastErr = (m, o) => toast(m, { ...o, type: "error" });
export const toastOk = (m, o) => toast(m, { ...o, type: "success" });
