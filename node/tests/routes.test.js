/** API routes via a live app with mocked Mythos + mocked job submission.
 * Port of tests/test_routes.py. */
import assert from "node:assert/strict";
import { after, test } from "node:test";

import { makeClient } from "./helpers.js";

const client = await makeClient();
after(() => client.close());

test("pricing endpoint", async () => {
  const r = await client.get("/api/pricing");
  assert.equal(r.status, 200);
  const p = r.data.pricing;
  assert.ok(p.base >= 1 && "gif" in p && "stems" in p);
});

test("capabilities endpoint", async () => {
  const r = await client.get("/api/capabilities");
  assert.equal(r.status, 200);
  for (const k of ["ffmpeg", "whisper", "demucs"]) {
    assert.ok(k in r.data, `missing ${k}`);
  }
});

test("session endpoint", async () => {
  const r = await client.get("/api/session");
  assert.equal(r.status, 200);
  assert.equal(r.data.user, "Test User");
  assert.equal(r.data.balance, 100);
});

test("single download charges once", async () => {
  client.charges.length = 0;
  const r = await client.post("/api/download", { url: "https://x/v", choice: "1080" });
  assert.equal(r.status, 200, r.text);
  assert.ok("job_id" in r.data && r.data.charged >= 2);
  assert.equal(client.charges.length, 1);
  // job persisted + listable
  const jid = r.data.job_id;
  assert.equal((await client.get(`/api/jobs/${jid}`)).status, 200);
  const listed = (await client.get("/api/jobs")).data.jobs;
  assert.ok(listed.some((j) => j.id === jid));
});

test("multi url fans out", async () => {
  client.charges.length = 0;
  const urls = ["https://x/1", "https://x/2", "https://x/3"];
  const r = await client.post("/api/download", { urls, choice: "best" });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.jobs.length, 3);
  assert.ok(r.data.jobs.every((j) => "job_id" in j));
  assert.equal(client.charges.length, 3); // one charge per URL
});

test("ml mode without capability 400", async () => {
  // Force the capability off (env-independent: ML deps may or may not be installed here)
  const c = await makeClient({ has: () => false });
  try {
    const r = await c.post("/api/download", { url: "https://x/v", output: "transcript" });
    assert.equal(r.status, 400);
    assert.ok(r.data.detail.toLowerCase().includes("not available"));
  } finally {
    await c.close();
  }
});

test("ml mode with capability proceeds", async () => {
  const c = await makeClient({ has: () => true });
  try {
    const r = await c.post("/api/download", { url: "https://x/v", output: "stems" });
    assert.equal(r.status, 200);
    assert.ok("job_id" in r.data);
  } finally {
    await c.close();
  }
});

test("convert without target 400 no charge", async () => {
  client.charges.length = 0;
  const r = await client.post("/api/download", { url: "https://x/v", output: "convert" });
  assert.equal(r.status, 400);
  assert.ok(r.data.detail.toLowerCase().includes("convert target"));
  assert.equal(client.charges.length, 0); // rejected BEFORE charging
});

test("unknown job 404", async () => {
  assert.equal((await client.get("/api/jobs/doesnotexist")).status, 404);
});

test("cross-user job and file are 404", async () => {
  // IDOR guard: a job owned by another user is invisible (404), not downloadable.
  client.db.createJob({
    id: "OTHER1", user_id: "someone-else", kind: "single",
    output: "video", status: "done", filepath: "/tmp/x", filename: "x.mp4",
  });
  assert.equal((await client.get("/api/jobs/OTHER1")).status, 404);
  assert.equal((await client.get("/api/file/OTHER1")).status, 404);
  assert.equal((await client.del("/api/jobs/OTHER1")).status, 404);
});

test("remove purges owned terminal job", async () => {
  client.db.createJob({
    id: "MINE1", user_id: client.fakeSession.userId, kind: "single",
    output: "video", status: "done", filepath: "/tmp/x", filename: "x.mp4",
  });
  const r = await client.del("/api/jobs/MINE1");
  assert.equal(r.status, 200);
  assert.equal(r.data.removed, true);
  assert.equal(client.db.getJob("MINE1"), null); // row actually deleted (Library Remove)
  assert.equal((await client.get("/api/jobs/MINE1")).status, 404);
});

test("not launched gate", async () => {
  // A client whose consumer/session is REAL (no fake session cookie) -> gate page.
  const { consumer } = await import("../src/mythos.js");
  const gated = await makeClient({ consumer });
  try {
    const r = await gated.get("/");
    assert.equal(r.status, 200);
    assert.ok(r.text.includes("Launch it from the Mythos platform"));
  } finally {
    await gated.close();
  }
});

test("index and static with session", async () => {
  // After the launch-token exchange, / serves the app shell and assets load.
  const { consumer } = await import("../src/mythos.js");
  const fakeGate = (req, _res, next) => {
    req.mythos = client.fakeSession;
    next();
  };
  const c = await makeClient({ consumer, launchGate: fakeGate });
  try {
    // /dashboard sets the cookie session and redirects to /
    const r1 = await c.get("/dashboard?lt=fake");
    assert.equal(r1.status, 303);
    const cookie = r1.headers.getSetCookie().map((s) => s.split(";")[0]).join("; ");
    const r2 = await c.get("/", { cookie });
    assert.equal(r2.status, 200);
    assert.ok(r2.text.includes('type="module"'));
    assert.ok(r2.text.includes('data-tab="library"'));
    assert.equal((await c.get("/static/js/main.js")).status, 200);
    assert.equal((await c.get("/static/styles.css")).status, 200);
  } finally {
    await c.close();
  }
});

test("auth gate: protected APIs 401 without session", async () => {
  const { consumer } = await import("../src/mythos.js");
  const gated = await makeClient({ consumer });
  try {
    for (const p of ["/api/session", "/api/jobs"]) {
      const r = await gated.get(p);
      assert.equal(r.status, 401, p);
      assert.ok(r.data.detail.includes("Launch Pluck from Mythos"));
    }
    assert.equal((await gated.post("/api/download", { url: "https://x/v" })).status, 401);
    assert.equal((await gated.post("/api/info", { url: "https://x/v" })).status, 401);
  } finally {
    await gated.close();
  }
});
