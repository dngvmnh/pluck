/** Full Mythos SDK integration against a mock Mythos backend (no mocks inside Pluck):
 *  real JWKS fetch, real RS256 launch-token verify (iss + aud + exp), real single-use
 *  /consume, real /meter charging, and the fail-closed behavior when /consume errors.
 *
 * The Node analogue of scripts/e2e_real.py.
 */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// ---- mock Mythos backend (JWKS + consume + meter + wallet) -------------------
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const consumed = new Set();
const metered = [];
let consumeMode = "ok"; // ok | error500

const mythos = createServer((req, res) => {
  const send = (code, body) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.url === "/.well-known/jwks.json") {
    const jwk = publicKey.export({ format: "jwk" });
    return send(200, { keys: [{ ...jwk, kid: "k1", alg: "RS256", use: "sig" }] });
  }
  const consume = req.url.match(/^\/api\/apps\/sessions\/([^/]+)\/consume$/);
  if (consume) {
    if (consumeMode === "error500") return send(500, { error: "boom" });
    if (consumed.has(consume[1])) return send(409, { error: "already consumed" });
    consumed.add(consume[1]);
    return send(200, { ok: true });
  }
  const meter = req.url.match(/^\/api\/apps\/sessions\/([^/]+)\/meter$/);
  if (meter) {
    let body = "";
    req.on("data", (d) => { body += d; });
    req.on("end", () => {
      metered.push({ jti: meter[1], ...JSON.parse(body) });
      send(200, { ok: true });
    });
    return;
  }
  if (req.url.startsWith("/api/wallet/")) return send(200, { balance: 42 });
  send(404, { error: "not found" });
});
await new Promise((r) => mythos.listen(0, r));
const MYTHOS_URL = `http://localhost:${mythos.address().port}`;

// ---- env BEFORE importing any src module -------------------------------------
const TMP = mkdtempSync(path.join(os.tmpdir(), "pluck-e2e-"));
process.env.PLUCK_DB = path.join(TMP, "e2e.db");
process.env.PLUCK_DL_DIR = path.join(TMP, "downloads");
process.env.MYTHOS_API_URL = MYTHOS_URL;
process.env.MYTHOS_LISTING_ID = "11111111-1111-1111-1111-111111111111";

const { createApp } = await import("../src/app.js");
const dbMod = await import("../src/db.js");
const jobsMod = await import("../src/jobs.js");
dbMod.initDb();

// Real SDK gate + real consumer + real reportUsage; only job submission is stubbed.
const app = createApp({ jobs: { ...jobsMod, submit: () => {} } });
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const BASE = `http://localhost:${srv.address().port}`;

after(() => {
  srv.close();
  mythos.close();
});

// ---- launch-token minting (what the Mythos platform does) --------------------
function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

// The real Mythos platform issues iss:'mythos' (backend apps.service.ts), which is
// what the SDK validates against — NOT the API URL.
async function mintLaunchToken({ jti = randomUUID(), iss = "mythos" } = {}) {
  const { createSign } = await import("node:crypto");
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    sub: "user-e2e", email: "e2e@example.com", displayName: "E2E User",
    listingId: process.env.MYTHOS_LISTING_ID,
    iss, aud: process.env.MYTHOS_LISTING_ID, jti,
    iat: now, exp: now + 300,
  }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  const sig = signer.sign(privateKey).toString("base64url");
  return `${header}.${payload}.${sig}`;
}

test("launch exchange: verify + consume + cookie session + app shell", async () => {
  const lt = await mintLaunchToken();
  const r1 = await fetch(`${BASE}/dashboard?lt=${encodeURIComponent(lt)}`, { redirect: "manual" });
  assert.equal(r1.status, 303);
  const cookie = r1.headers.getSetCookie().map((s) => s.split(";")[0]).join("; ");
  assert.ok(cookie.length > 0);

  const r2 = await fetch(`${BASE}/`, { headers: { cookie } });
  assert.equal(r2.status, 200);
  assert.ok((await r2.text()).includes('type="module"')); // the app shell, not the gate

  // session reflects the verified identity + live wallet balance from the mock
  const r3 = await fetch(`${BASE}/api/session`, { headers: { cookie } });
  const body = await r3.json();
  assert.equal(r3.status, 200);
  assert.equal(body.user, "E2E User");
  assert.equal(body.balance, 42);

  // a download charges through the REAL reportUsage -> mock /meter
  metered.length = 0;
  const r4 = await fetch(`${BASE}/api/download`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ url: "https://x/v", choice: "1080" }),
  });
  const dl = await r4.json();
  assert.equal(r4.status, 200, JSON.stringify(dl));
  assert.ok(dl.job_id);
  assert.equal(metered.length, 1);
  assert.ok(metered[0].credits >= 2);
});

test("replayed launch token is rejected (single-use consume)", async () => {
  const lt = await mintLaunchToken();
  const ok = await fetch(`${BASE}/dashboard?lt=${encodeURIComponent(lt)}`, { redirect: "manual" });
  assert.equal(ok.status, 303);
  const replay = await fetch(`${BASE}/dashboard?lt=${encodeURIComponent(lt)}`, { redirect: "manual" });
  assert.equal(replay.status, 401); // SDK: 409 from /consume -> 401
});

test("token from a different issuer is rejected (iss validation)", async () => {
  const evil = await mintLaunchToken({ iss: "https://evil.example" });
  const r = await fetch(`${BASE}/dashboard?lt=${encodeURIComponent(evil)}`, { redirect: "manual" });
  assert.equal(r.status, 401);
});

test("consume backend error fails CLOSED (503, no session)", async () => {
  consumeMode = "error500";
  try {
    const lt = await mintLaunchToken();
    const r = await fetch(`${BASE}/dashboard?lt=${encodeURIComponent(lt)}`, { redirect: "manual" });
    assert.equal(r.status, 503); // never next(), never a session cookie
    assert.equal(r.headers.getSetCookie().length, 0);
  } finally {
    consumeMode = "ok";
  }
});

test("missing launch token -> 401, no session", async () => {
  const r = await fetch(`${BASE}/dashboard`, { redirect: "manual" });
  assert.equal(r.status, 401);
});
