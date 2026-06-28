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

// The real Mythos BE scopes GET /api/wallet to the user's own Bearer token;
// Pluck's server only has userId from the launch JWT, not the Bearer token.
// Balance is visible in the Mythos platform chrome — no need to duplicate it here.
export async function walletBalance(_userId) {
  return null;
}

// Producer-side top-up has no equivalent on the real platform.
export async function walletTopup(_userId, _amount = 10) {
  return null;
}
