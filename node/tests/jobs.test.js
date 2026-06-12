/** JobQueue orchestration: status transitions, result caching, error + cancel paths.
 * Port of tests/test_jobs.py. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, test } from "node:test";

import { TMP_DIR, freshDb } from "./helpers.js";

const db = await import("../src/db.js");
const jobs = await import("../src/jobs.js");
const { parseDownloadReq, OutputMode } = await import("../src/models.js");
const { CancelledError } = await import("../src/pipelines/index.js");

let req, key;
const realVideoPipeline = jobs.PIPELINES[OutputMode.VIDEO];

beforeEach(async () => {
  await freshDb();
  jobs.FILE_CACHE.clear();
  jobs.PIPELINES[OutputMode.VIDEO] = realVideoPipeline;
  req = parseDownloadReq({ url: "https://x/v", choice: "best", output: OutputMode.VIDEO });
  key = jobs.dlKey(req);
  db.createJob({
    id: "J1", user_id: "u1", kind: "single", output: "video",
    status: "queued", progress: 0, dl_key: key, created_at: Date.now() / 1000,
  });
});

test("execute success marks done and caches", async () => {
  const out = path.join(TMP_DIR, "result.mp4");
  writeFileSync(out, "x".repeat(50));

  jobs.PIPELINES[OutputMode.VIDEO] = async () => out;
  await jobs.execute("J1", req, false, key);

  const j = db.getJob("J1");
  assert.equal(j.status, "done");
  assert.equal(j.progress, 100);
  assert.equal(j.filename, "result.mp4");
  assert.equal(j.size, 50);
  assert.equal(jobs.cachedResult(key).filename, "result.mp4");
});

test("execute error marks error", async () => {
  jobs.PIPELINES[OutputMode.VIDEO] = async () => {
    throw new Error("ffmpeg exploded\nlast line detail");
  };
  await jobs.execute("J1", req, false, key);

  const j = db.getJob("J1");
  assert.equal(j.status, "error");
  assert.ok(j.error.includes("detail"));
});

test("execute cancelled", async () => {
  jobs.PIPELINES[OutputMode.VIDEO] = async () => {
    throw new CancelledError();
  };
  await jobs.execute("J1", req, false, key);
  assert.equal(db.getJob("J1").status, "cancelled");
});

test("cancel sets status", () => {
  assert.equal(jobs.cancel("J1"), true);
  assert.equal(db.getJob("J1").status, "cancelled");
  assert.equal(jobs.cancel("missing"), false);
});

test("finish does not overwrite cancellation", () => {
  // If the user cancels in the finish window, finish() must not flip it back to done.
  db.updateJob("J1", { status: "cancelled", error: "Cancelled by user" });
  const out = path.join(TMP_DIR, "r.mp4");
  writeFileSync(out, "x".repeat(10));
  jobs.finish("J1", out, key);
  assert.equal(db.getJob("J1").status, "cancelled"); // stays cancelled
  assert.ok(!jobs.FILE_CACHE.has(key));              // and is not cached
});

test("purge removes row", () => {
  assert.notEqual(db.getJob("J1"), null);
  jobs.purge("J1");
  assert.equal(db.getJob("J1"), null);
});
