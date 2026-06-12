/** Mythos integration helpers: the AUTH gate + wallet reads/top-up.
 *
 * Payment itself (reportUsage) is called from the download route; this module owns
 * the session gate and wallet HTTP calls. Mirrors pluck/mythos.py.
 */
import { MYTHOS_API } from "./config.js";

export class HttpError extends Error {
  constructor(status, detail) {
    super(detail);
    this.status = status;
    this.detail = detail;
  }
}

/** Gate every protected route on our own cookie session (launch tokens are single-use). */
export function consumer(req) {
  const m = req.session?.mythos;
  if (!m) throw new HttpError(401, "Launch Pluck from Mythos first");
  return m;
}

export async function walletBalance(userId) {
  try {
    const r = await fetch(`${MYTHOS_API}/api/wallet/${userId}`);
    if (r.status !== 200) return null;
    const body = await r.json();
    return body.balance ?? null;
  } catch {
    return null;
  }
}

export async function walletTopup(userId, amount = 10) {
  await fetch(`${MYTHOS_API}/api/wallet/topup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, amount }),
  });
  return walletBalance(userId);
}
