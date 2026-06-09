"""SQLite persistence for jobs (replaces the in-memory JOBS dict + localStorage).

Thread-safe: one connection per thread (jobs run on a ThreadPoolExecutor). WAL mode
so readers (the polling endpoint) never block the writer. Progress updates are
throttled by the caller to avoid write storms.
"""
import json
import sqlite3
import threading
import time

from .config import DB_PATH

_local = threading.local()

# Columns persisted per job. JSON blobs (params) are (de)serialized at the edge.
_COLUMNS = [
    "id", "user_id", "kind", "output", "status", "progress", "speed", "eta",
    "total_bytes", "items_done", "items_total", "title", "thumb", "label",
    "params", "dl_key", "filename", "filepath", "size", "error", "charged",
    "created_at", "updated_at",
]

_SCHEMA = """
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
"""


def _conn() -> sqlite3.Connection:
    c = getattr(_local, "conn", None)
    if c is None:
        c = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=30)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA synchronous=NORMAL")
        c.execute("PRAGMA busy_timeout=30000")
        _local.conn = c
    return c


def init_db() -> None:
    _conn().executescript(_SCHEMA)
    _conn().commit()


def _row_to_job(row: sqlite3.Row) -> dict:
    job = dict(row)
    if job.get("params"):
        try:
            job["params"] = json.loads(job["params"])
        except (json.JSONDecodeError, TypeError):
            job["params"] = None
    return job


def create_job(job: dict) -> dict:
    now = time.time()
    job.setdefault("created_at", now)
    job["updated_at"] = now
    if isinstance(job.get("params"), (dict, list)):
        job["params"] = json.dumps(job["params"])
    cols = [c for c in _COLUMNS if c in job]
    placeholders = ",".join("?" for _ in cols)
    sql = f"INSERT INTO jobs ({','.join(cols)}) VALUES ({placeholders})"
    c = _conn()
    c.execute(sql, [job[c_] for c_ in cols])
    c.commit()
    return get_job(job["id"])


def update_job(job_id: str, **fields) -> None:
    if not fields:
        return
    fields["updated_at"] = time.time()
    if isinstance(fields.get("params"), (dict, list)):
        fields["params"] = json.dumps(fields["params"])
    cols = [k for k in fields if k in _COLUMNS]
    sets = ",".join(f"{k}=?" for k in cols)
    c = _conn()
    c.execute(f"UPDATE jobs SET {sets} WHERE id=?", [fields[k] for k in cols] + [job_id])
    c.commit()


def finish_job(job_id: str, **fields) -> bool:
    """Like update_job but refuses to clobber a job the user cancelled.
    Returns True if the row was updated, False if it was already 'cancelled'."""
    fields["updated_at"] = time.time()
    cols = [k for k in fields if k in _COLUMNS]
    sets = ",".join(f"{k}=?" for k in cols)
    c = _conn()
    cur = c.execute(f"UPDATE jobs SET {sets} WHERE id=? AND status != 'cancelled'",
                    [fields[k] for k in cols] + [job_id])
    c.commit()
    return cur.rowcount > 0


def get_job(job_id: str) -> dict | None:
    row = _conn().execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
    return _row_to_job(row) if row else None


def list_jobs(user_id: str | None = None, limit: int = 50) -> list[dict]:
    if user_id:
        rows = _conn().execute(
            "SELECT * FROM jobs WHERE user_id=? ORDER BY created_at DESC LIMIT ?",
            (user_id, limit)).fetchall()
    else:
        rows = _conn().execute(
            "SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
    return [_row_to_job(r) for r in rows]


def delete_job(job_id: str) -> None:
    c = _conn()
    c.execute("DELETE FROM jobs WHERE id=?", (job_id,))
    c.commit()


def find_inflight(dl_key: str) -> dict | None:
    """An active (non-terminal) job with this dedup key, if any."""
    row = _conn().execute(
        "SELECT * FROM jobs WHERE dl_key=? AND status NOT IN "
        "('done','error','cancelled','interrupted') ORDER BY created_at DESC LIMIT 1",
        (dl_key,)).fetchone()
    return _row_to_job(row) if row else None


def find_cached(dl_key: str) -> dict | None:
    """Most-recent completed job with this dedup key (does not check the file)."""
    candidates = find_cached_candidates(dl_key)
    return candidates[0] if candidates else None


def find_cached_candidates(dl_key: str, limit: int = 5) -> list[dict]:
    """Completed jobs with this dedup key, newest first — caller checks file existence."""
    rows = _conn().execute(
        "SELECT * FROM jobs WHERE dl_key=? AND status='done' ORDER BY created_at DESC LIMIT ?",
        (dl_key, limit)).fetchall()
    return [_row_to_job(r) for r in rows]


def recover_interrupted() -> int:
    """On startup, jobs left mid-flight by a crash/restart become 'interrupted'."""
    c = _conn()
    cur = c.execute(
        "UPDATE jobs SET status='interrupted', error='Server restarted', updated_at=? "
        "WHERE status IN ('queued','downloading','processing')", (time.time(),))
    c.commit()
    return cur.rowcount


def reap_old(cutoff: float) -> list[str]:
    """Delete job rows older than cutoff; return their ids (caller removes files)."""
    c = _conn()
    rows = c.execute("SELECT id FROM jobs WHERE created_at < ?", (cutoff,)).fetchall()
    ids = [r["id"] for r in rows]
    if ids:
        c.execute("DELETE FROM jobs WHERE created_at < ?", (cutoff,))
        c.commit()
    return ids
