/** Job status / Library listing / cancel+remove / file download.
 *
 * Every route is auth-gated (consumer) and ownership-scoped: a job is only visible to
 * the Mythos user who created it. Unknown OR not-owned both return 404 (no existence leak).
 * Mirrors pluck/routes/jobs.py.
 */
import { createReadStream, existsSync } from "node:fs";

import { Router } from "express";

import { HttpError } from "../mythos.js";
import { wrap } from "./helpers.js";

// fields never exposed to the client
const HIDDEN = new Set(["filepath", "params", "dl_key", "user_id"]);

function pub(job) {
  const out = {};
  for (const [k, v] of Object.entries(job)) {
    if (!HIDDEN.has(k) && v !== null && v !== undefined) out[k] = v;
  }
  return out;
}

export function createRouter(deps) {
  const { consumer, jobs, db } = deps;
  const router = Router();

  function ownedOr404(jobId, userId) {
    const job = db.getJob(jobId);
    if (!job || job.user_id !== userId) throw new HttpError(404, "unknown job");
    return job;
  }

  /** Library: this user's recent jobs (replaces localStorage history). */
  router.get("/api/jobs", wrap(async (req, res) => {
    const m = consumer(req);
    res.json({ jobs: db.listJobs(m.userId, 50).map(pub) });
  }));

  router.get("/api/jobs/:jobId", wrap(async (req, res) => {
    const m = consumer(req);
    res.json(pub(ownedOr404(req.params.jobId, m.userId)));
  }));

  /** Active list → cancel a running job; Library → remove a finished one (purge row + files). */
  router.delete("/api/jobs/:jobId", wrap(async (req, res) => {
    const m = consumer(req);
    const job = ownedOr404(req.params.jobId, m.userId);
    if (jobs.TERMINAL.includes(job.status)) {
      jobs.purge(req.params.jobId);
      return res.json({ ok: true, removed: true });
    }
    jobs.cancel(req.params.jobId);
    res.json({ ok: true, removed: false });
  }));

  router.get("/api/file/:jobId", wrap(async (req, res) => {
    const m = consumer(req);
    const job = ownedOr404(req.params.jobId, m.userId);
    if (job.status !== "done" || !job.filepath) throw new HttpError(404, "file not ready");
    if (!existsSync(job.filepath)) throw new HttpError(404, "file not ready");
    const filename = job.filename || "download";
    const fallback = filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition",
      `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    createReadStream(job.filepath).pipe(res);
  }));

  return router;
}
