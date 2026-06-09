"""JobQueue: runs pipelines on a thread pool, persists state to SQLite.

Replaces the old in-memory JOBS dict + ThreadPoolExecutor. Job state is durable
(survives restarts); an in-process FILE_CACHE gives identical requests an instant
result while the process is alive.
"""
import shutil
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from . import db
from .config import DL_DIR, JOB_TTL, MAX_WORKERS
from .models import DownloadReq, OutputMode
from .pipelines import PIPELINES, CancelledError, JobCtx
from .pipelines import playlist as playlist_pipeline
from .ytdlp import parse_hms

_POOL = ThreadPoolExecutor(max_workers=MAX_WORKERS)

# in-process result cache: dl_key -> {filepath, filename, size}
FILE_CACHE: dict[str, dict] = {}


def dl_key(req: DownloadReq) -> str:
    """Stable cache/dedup key — same url+options means the same file."""
    return "|".join(str(x) for x in (
        req.url.strip(), req.output.value, req.choice, req.convert_to,
        req.gif_fps, req.gif_width, req.music, req.subs, req.sponsorblock,
        req.remaster, parse_hms(req.start), parse_hms(req.end)))


def _finish(job_id: str, out: Path, key: str | None) -> None:
    info = {"filepath": str(out), "filename": out.name, "size": out.stat().st_size}
    # finish_job won't overwrite a job the user cancelled mid-flight; only cache if it landed.
    if db.finish_job(job_id, status="done", progress=100, **info) and key:
        FILE_CACHE[key] = info


def _execute(job_id: str, req: DownloadReq, is_playlist: bool, key: str | None) -> None:
    try:
        job = db.get_job(job_id)
        if job and job.get("status") == "cancelled":
            return
        ctx = JobCtx(job_id, req)   # creates the job dir — inside try so failures become status=error
        db.update_job(job_id, status="downloading")
        pipeline = playlist_pipeline.run if is_playlist else PIPELINES[req.output]
        out = pipeline(ctx)
        ctx.check_cancelled()
        _finish(job_id, out, key)
    except CancelledError:
        db.update_job(job_id, status="cancelled", error="Cancelled by user")
    except Exception as e:  # noqa: BLE001 - surface a short message to the UI
        msg = str(e).splitlines()[-1][:200] if str(e).strip() else e.__class__.__name__
        db.update_job(job_id, status="error", error=msg)


def submit(job_id: str, req: DownloadReq, is_playlist: bool = False, key: str | None = None) -> None:
    _POOL.submit(_execute, job_id, req, is_playlist, key)


_TERMINAL = ("done", "error", "interrupted", "cancelled")


def cancel(job_id: str) -> bool:
    job = db.get_job(job_id)
    if not job:
        return False
    if job.get("status") in _TERMINAL:
        return True
    db.update_job(job_id, status="cancelled", error="Cancelled by user")
    return True


def purge(job_id: str) -> None:
    """Delete a job row and its files (Library 'Remove')."""
    db.delete_job(job_id)
    shutil.rmtree(DL_DIR / job_id, ignore_errors=True)


def cached_result(key: str) -> dict | None:
    hit = FILE_CACHE.get(key)
    if hit and Path(hit["filepath"]).exists():
        return hit
    # fall back to any completed DB row whose file still exists (survives FILE_CACHE loss);
    # check every candidate, not just the newest — an older copy may still be on disk.
    for row in db.find_cached_candidates(key):
        if row.get("filepath") and Path(row["filepath"]).exists():
            return {"filepath": row["filepath"], "filename": row["filename"], "size": row["size"]}
    return None


# ---- background reaper -----------------------------------------------------
def _reaper() -> None:
    while True:
        time.sleep(3600)
        try:
            ids = db.reap_old(time.time() - JOB_TTL)
            for jid in ids:
                shutil.rmtree(DL_DIR / jid, ignore_errors=True)
        except Exception:
            pass


def start_background(recover: bool = True) -> None:
    """Called once on app startup."""
    db.init_db()
    if recover:
        db.recover_interrupted()
    threading.Thread(target=_reaper, daemon=True).start()
