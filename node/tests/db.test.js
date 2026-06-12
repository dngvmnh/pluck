/** SQLite job persistence: CRUD, dedup lookups, restart recovery, reaping.
 * Port of tests/test_db.py. */
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { freshDb } from "./helpers.js";

let db;
beforeEach(async () => {
  db = await freshDb();
});

function job(jid, kw = {}) {
  return {
    id: jid, user_id: "u1", kind: "single", output: "video",
    status: "queued", progress: 0, created_at: Date.now() / 1000, ...kw,
  };
}

test("create and get", () => {
  db.createJob(job("a", { params: { url: "x", choice: "best" } }));
  const j = db.getJob("a");
  assert.equal(j.status, "queued");
  assert.equal(j.params.choice, "best"); // round-trips JSON
});

test("update", () => {
  db.createJob(job("b"));
  db.updateJob("b", { status: "done", progress: 100, filename: "out.mp4", size: 123 });
  const j = db.getJob("b");
  assert.equal(j.status, "done");
  assert.equal(j.size, 123);
  assert.equal(j.filename, "out.mp4");
});

test("list scoped to user", () => {
  db.createJob(job("c", { user_id: "u1" }));
  db.createJob(job("d", { user_id: "u2" }));
  const ids = new Set(db.listJobs("u1").map((j) => j.id));
  assert.deepEqual(ids, new Set(["c"]));
});

test("find inflight and cached", () => {
  db.createJob(job("e", { dl_key: "K", status: "downloading" }));
  assert.equal(db.findInflight("K").id, "e");
  db.updateJob("e", { status: "done", filepath: "/tmp/x" });
  assert.equal(db.findInflight("K"), null);
  assert.equal(db.findCached("K").id, "e");
});

test("recover interrupted", () => {
  db.createJob(job("f", { status: "downloading" }));
  db.createJob(job("g", { status: "queued" }));
  db.createJob(job("h", { status: "done" }));
  const n = db.recoverInterrupted();
  assert.equal(n, 2);
  assert.equal(db.getJob("f").status, "interrupted");
  assert.equal(db.getJob("h").status, "done");
});

test("reap old", () => {
  db.createJob(job("old", { created_at: Date.now() / 1000 - 10_000 }));
  db.createJob(job("new", { created_at: Date.now() / 1000 }));
  const reaped = db.reapOld(Date.now() / 1000 - 5_000);
  assert.deepEqual(reaped, ["old"]);
  assert.equal(db.getJob("old"), null);
  assert.notEqual(db.getJob("new"), null);
});

test("finish_job refuses to clobber a cancelled job", () => {
  db.createJob(job("z", { status: "cancelled" }));
  const updated = db.finishJob("z", { status: "done", progress: 100 });
  assert.equal(updated, false);
  assert.equal(db.getJob("z").status, "cancelled");
});
