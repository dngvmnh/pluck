"""JobQueue orchestration: status transitions, result caching, error + cancel paths."""
import time

import pytest

from pluck import db, jobs
from pluck.models import DownloadReq, OutputMode
from pluck.pipelines import CancelledError


@pytest.fixture()
def a_job(fresh_db):
    jobs.FILE_CACHE.clear()
    req = DownloadReq(url="https://x/v", choice="best", output=OutputMode.VIDEO)
    key = jobs.dl_key(req)
    db.create_job({"id": "J1", "user_id": "u1", "kind": "single", "output": "video",
                   "status": "queued", "progress": 0, "dl_key": key,
                   "created_at": time.time()})
    return req, key


def test_execute_success_marks_done_and_caches(a_job, tmp_path, monkeypatch):
    req, key = a_job
    out = tmp_path / "result.mp4"
    out.write_bytes(b"x" * 50)

    monkeypatch.setitem(jobs.PIPELINES, OutputMode.VIDEO, lambda ctx: out)
    jobs._execute("J1", req, is_playlist=False, key=key)

    j = db.get_job("J1")
    assert j["status"] == "done" and j["progress"] == 100
    assert j["filename"] == "result.mp4" and j["size"] == 50
    assert jobs.cached_result(key)["filename"] == "result.mp4"


def test_execute_error_marks_error(a_job, monkeypatch):
    req, key = a_job

    def boom(ctx):
        raise RuntimeError("ffmpeg exploded\nlast line detail")

    monkeypatch.setitem(jobs.PIPELINES, OutputMode.VIDEO, boom)
    jobs._execute("J1", req, is_playlist=False, key=key)

    j = db.get_job("J1")
    assert j["status"] == "error" and "detail" in j["error"]


def test_execute_cancelled(a_job, monkeypatch):
    req, key = a_job

    def cancel_midway(ctx):
        raise CancelledError()

    monkeypatch.setitem(jobs.PIPELINES, OutputMode.VIDEO, cancel_midway)
    jobs._execute("J1", req, is_playlist=False, key=key)
    assert db.get_job("J1")["status"] == "cancelled"


def test_cancel_sets_status(a_job):
    assert jobs.cancel("J1") is True
    assert db.get_job("J1")["status"] == "cancelled"
    assert jobs.cancel("missing") is False


def test_finish_does_not_overwrite_cancellation(a_job, tmp_path):
    """If the user cancels in the finish window, _finish must not flip it back to done."""
    req, key = a_job
    db.update_job("J1", status="cancelled", error="Cancelled by user")
    out = tmp_path / "r.mp4"; out.write_bytes(b"x" * 10)
    jobs._finish("J1", out, key)
    assert db.get_job("J1")["status"] == "cancelled"   # stays cancelled
    assert key not in jobs.FILE_CACHE                   # and is not cached


def test_purge_removes_row(a_job):
    assert db.get_job("J1") is not None
    jobs.purge("J1")
    assert db.get_job("J1") is None
