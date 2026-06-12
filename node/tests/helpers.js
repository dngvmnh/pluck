/** Shared test fixtures (the Node analogue of tests/conftest.py).
 * Sets temp DB + download dir BEFORE importing any src module.
 */
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = mkdtempSync(path.join(os.tmpdir(), "pluck-test-"));
process.env.PLUCK_DB = path.join(TMP, "test.db");
process.env.PLUCK_DL_DIR = path.join(TMP, "downloads");
process.env.MYTHOS_API_URL ??= "http://localhost:4000";

export const TMP_DIR = TMP;

let _n = 0;

/** Point the DB layer at a per-test database file (the fresh_db fixture). */
export async function freshDb() {
  const db = await import("../src/db.js");
  db.setDbPath(path.join(TMP, `jobs-${++_n}.db`));
  db.initDb();
  return db;
}

/** App + fetch client with a faked Mythos session + mocked SDK/wallet calls
 * (the conftest `client` fixture). */
export async function makeClient(overrides = {}) {
  const { createApp } = await import("../src/app.js");
  const db = await import("../src/db.js");
  const jobsMod = await import("../src/jobs.js");
  db.initDb();

  const fakeSession = {
    userId: "user-test-1", displayName: "Test User",
    email: "test@example.com", sessionJti: "jti-1",
  };
  const charges = [];

  const app = createApp({
    consumer: () => fakeSession,
    walletBalance: async () => 100,
    walletTopup: async () => 100,
    reportUsage: async (jti, { credits, reason }) => { charges.push({ jti, credits, reason }); },
    jobs: { ...jobsMod, submit: () => {} }, // don't actually run pipelines
    ...overrides,
  });

  const srv = app.listen(0);
  await new Promise((r) => srv.once("listening", r));
  const base = `http://localhost:${srv.address().port}`;

  async function request(method, p, body, headers = {}) {
    const r = await fetch(base + p, {
      method,
      headers: body != null ? { "content-type": "application/json", ...headers } : headers,
      body: body != null ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
    let data = null;
    const text = await r.text();
    try { data = JSON.parse(text); } catch { data = null; }
    return { status: r.status, data, text, headers: r.headers };
  }

  return {
    base,
    charges,
    fakeSession,
    db,
    get: (p, h) => request("GET", p, null, h),
    post: (p, b, h) => request("POST", p, b, h),
    del: (p, h) => request("DELETE", p, null, h),
    close: () => new Promise((r) => srv.close(r)),
  };
}
