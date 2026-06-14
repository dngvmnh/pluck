/** SQLite persistence for jobs (mirrors pluck/db.py).
 *
 * Node is single-threaded so one connection serves the whole process. WAL mode
 * so readers (the polling endpoint) never block the writer. Progress updates are
 * throttled by the caller to avoid write storms.
 */
import { DatabaseSync } from "node:sqlite";

import { DB_PATH } from "./config.js";

// Columns persisted per job. JSON blobs (params) are (de)serialized at the edge.
const COLUMNS = [
  "id", "user_id", "kind", "output", "status", "progress", "speed", "eta",
  "total_bytes", "items_done", "items_total", "title", "thumb", "label",
  "params", "dl_key", "filename", "filepath", "size", "error", "charged",
  "created_at", "updated_at",
];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
    id          TEXT PRIMARY KEY,
    user_id     TEXT,
    kind        TEXT,
    output      TEXT,
    status      TEXT,
    progress    REAL,
    speed       TEXT,
    eta         TEXT,
    total_bytes INTEGER,
    items_done  INTEGER,
    items_total INTEGER,
    title       TEXT,
    thumb       TEXT,
    label       TEXT,
    params      TEXT,
    dl_key      TEXT,
    filename    TEXT,
    filepath    TEXT,
    size        INTEGER,
    error       TEXT,
    charged     INTEGER,
    created_at  REAL,
    updated_at  REAL
);
CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at);
`;

let _db = null;
let _dbPath = DB_PATH;

/** Point the layer at a different database file (tests). Closes any open handle. */
export function setDbPath(p) {
  closeDb();
  _dbPath = p;
}

export function closeDb() {
  if (_db) {
    try { _db.close(); } catch { /* already closed */ }
    _db = null;
  }
}

function conn() {
  if (!_db) {
    _db = new DatabaseSync(_dbPath);
    // WAL gives non-blocking reads while a job writes progress, but it relies on a
    // shared-memory (-shm) mmap that some filesystems can't provide — notably Windows
    // drives mounted in WSL at /mnt/c (DrvFs) and network shares, where it raises
    // "disk I/O error". Fall back to the default rollback journal there so the app
    // still runs; correctness is unchanged, only the read/write concurrency differs.
    try {
      _db.exec("PRAGMA journal_mode=WAL");
      _db.exec("PRAGMA synchronous=NORMAL");
    } catch {
      _db.exec("PRAGMA journal_mode=DELETE");
      _db.exec("PRAGMA synchronous=FULL");
    }
    _db.exec("PRAGMA busy_timeout=30000");
  }
  return _db;
}

export function initDb() {
  conn().exec(SCHEMA);
}

function now() {
  return Date.now() / 1000;
}

function rowToJob(row) {
  if (!row) return null;
  const job = { ...row };
  if (job.params) {
    try {
      job.params = JSON.parse(job.params);
    } catch {
      job.params = null;
    }
  }
  return job;
}

export function createJob(job) {
  const t = now();
  job.created_at ??= t;
  job.updated_at = t;
  if (job.params && typeof job.params === "object") {
    job.params = JSON.stringify(job.params);
  }
  const cols = COLUMNS.filter((c) => c in job);
  const placeholders = cols.map(() => "?").join(",");
  const sql = `INSERT INTO jobs (${cols.join(",")}) VALUES (${placeholders})`;
  conn().prepare(sql).run(...cols.map((c) => job[c] ?? null));
  return getJob(job.id);
}

export function updateJob(jobId, fields) {
  if (!fields || Object.keys(fields).length === 0) return;
  fields.updated_at = now();
  if (fields.params && typeof fields.params === "object") {
    fields.params = JSON.stringify(fields.params);
  }
  const cols = Object.keys(fields).filter((k) => COLUMNS.includes(k));
  const sets = cols.map((k) => `${k}=?`).join(",");
  conn().prepare(`UPDATE jobs SET ${sets} WHERE id=?`)
    .run(...cols.map((k) => fields[k] ?? null), jobId);
}

/** Like updateJob but refuses to clobber a job the user cancelled.
 * Returns true if the row was updated, false if it was already 'cancelled'. */
export function finishJob(jobId, fields) {
  fields.updated_at = now();
  const cols = Object.keys(fields).filter((k) => COLUMNS.includes(k));
  const sets = cols.map((k) => `${k}=?`).join(",");
  const res = conn().prepare(`UPDATE jobs SET ${sets} WHERE id=? AND status != 'cancelled'`)
    .run(...cols.map((k) => fields[k] ?? null), jobId);
  return res.changes > 0;
}

export function getJob(jobId) {
  const row = conn().prepare("SELECT * FROM jobs WHERE id=?").get(jobId);
  return row ? rowToJob(row) : null;
}

export function listJobs(userId = null, limit = 50) {
  const rows = userId
    ? conn().prepare("SELECT * FROM jobs WHERE user_id=? ORDER BY created_at DESC LIMIT ?").all(userId, limit)
    : conn().prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?").all(limit);
  return rows.map(rowToJob);
}

export function deleteJob(jobId) {
  conn().prepare("DELETE FROM jobs WHERE id=?").run(jobId);
}

/** An active (non-terminal) job with this dedup key, if any. */
export function findInflight(dlKey) {
  const row = conn().prepare(
    "SELECT * FROM jobs WHERE dl_key=? AND status NOT IN " +
    "('done','error','cancelled','interrupted') ORDER BY created_at DESC LIMIT 1").get(dlKey);
  return row ? rowToJob(row) : null;
}

/** Most-recent completed job with this dedup key (does not check the file). */
export function findCached(dlKey) {
  const candidates = findCachedCandidates(dlKey);
  return candidates.length ? candidates[0] : null;
}

/** Completed jobs with this dedup key, newest first — caller checks file existence. */
export function findCachedCandidates(dlKey, limit = 5) {
  const rows = conn().prepare(
    "SELECT * FROM jobs WHERE dl_key=? AND status='done' ORDER BY created_at DESC LIMIT ?")
    .all(dlKey, limit);
  return rows.map(rowToJob);
}

/** On startup, jobs left mid-flight by a crash/restart become 'interrupted'. */
export function recoverInterrupted() {
  const res = conn().prepare(
    "UPDATE jobs SET status='interrupted', error='Server restarted', updated_at=? " +
    "WHERE status IN ('queued','downloading','processing')").run(now());
  return res.changes;
}

/** Delete job rows older than cutoff; return their ids (caller removes files). */
export function reapOld(cutoff) {
  const c = conn();
  const rows = c.prepare("SELECT id FROM jobs WHERE created_at < ?").all(cutoff);
  const ids = rows.map((r) => r.id);
  if (ids.length) {
    c.prepare("DELETE FROM jobs WHERE created_at < ?").run(cutoff);
  }
  return ids;
}
