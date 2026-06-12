// Mythos session: identity, wallet balance, credits pill, top-up.
import { getJSON, postJSON } from "./api.js";
import { $, state } from "./store.js";
import { toastOk } from "./toast.js";

let _balance = null;
let _needed = 0;

function setAvatar(el, seed, style, fallback) {
  el.textContent = fallback || "";
  if (!seed) return;
  const img = new Image();
  img.className = "avatar-img"; img.alt = "";
  img.onload = () => { el.textContent = ""; el.appendChild(img); };
  img.src = `https://api.dicebear.com/9.x/${style}/svg?seed=${encodeURIComponent(seed)}`;
}

function render() {
  $("#mythos-credits").textContent = "◎ " + (_balance == null ? "—" : _balance) + " cr";
  const insufficient = _balance != null && _balance < _needed;
  $("#topupBtn").classList.toggle("hidden", !insufficient && !(_balance != null && _balance < (state.pricing.base || 2)));
}

export function setBalance(b) { if (b != null) _balance = b; render(); }
export function setNeeded(n) { _needed = n || 0; render(); }
export function getBalance() { return _balance; }

export async function loadSession() {
  const { ok, data } = await getJSON("/api/session");
  if (!ok) return;
  state.session = data;
  setAvatar($("#mythos-user"), data.email || data.user, "thumbs",
            (data.user || "?").trim().charAt(0).toUpperCase());
  $("#mythos-user").title = data.user || "";
  setBalance(data.balance);
}

export async function topUp() {
  const { ok, data } = await postJSON("/api/topup");
  if (ok) { setBalance(data.balance); toastOk("Wallet topped up +10 credits"); }
}
