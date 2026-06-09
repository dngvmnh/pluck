"""Job status / Library listing / cancel+remove / file download.

Every route is auth-gated (consumer) and ownership-scoped: a job is only visible to
the Mythos user who created it. Unknown OR not-owned both return 404 (no existence leak).
"""
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from .. import db, jobs
from ..mythos import consumer

router = APIRouter()

# fields never exposed to the client
_HIDDEN = {"filepath", "params", "dl_key", "user_id"}


def _public(job: dict) -> dict:
    return {k: v for k, v in job.items() if k not in _HIDDEN and v is not None}


def _owned_or_404(job_id: str, user_id: str) -> dict:
    job = db.get_job(job_id)
    if not job or job.get("user_id") != user_id:
        raise HTTPException(404, "unknown job")
    return job


@router.get("/api/jobs")
def api_jobs(request: Request):
    """Library: this user's recent jobs (replaces localStorage history)."""
    m = consumer(request)
    return {"jobs": [_public(j) for j in db.list_jobs(m["userId"], limit=50)]}


@router.get("/api/jobs/{job_id}")
def api_job(job_id: str, request: Request):
    m = consumer(request)
    return _public(_owned_or_404(job_id, m["userId"]))


@router.delete("/api/jobs/{job_id}")
def api_cancel_job(job_id: str, request: Request):
    """Active list → cancel a running job; Library → remove a finished one (purge row + files)."""
    m = consumer(request)
    job = _owned_or_404(job_id, m["userId"])
    if job.get("status") in jobs._TERMINAL:
        jobs.purge(job_id)
        return {"ok": True, "removed": True}
    jobs.cancel(job_id)
    return {"ok": True, "removed": False}


@router.get("/api/file/{job_id}")
def api_file(job_id: str, request: Request):
    m = consumer(request)
    job = _owned_or_404(job_id, m["userId"])
    if job.get("status") != "done" or not job.get("filepath"):
        raise HTTPException(404, "file not ready")
    return FileResponse(job["filepath"], filename=job["filename"],
                        media_type="application/octet-stream")
