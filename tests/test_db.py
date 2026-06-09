"""SQLite job persistence: CRUD, dedup lookups, restart recovery, reaping."""
import time


def _job(jid, **kw):
    base = {"id": jid, "user_id": "u1", "kind": "single", "output": "video",
            "status": "queued", "progress": 0, "created_at": time.time()}
    base.update(kw)
    return base


def test_create_and_get(fresh_db):
    db = fresh_db
    db.create_job(_job("a", params={"url": "x", "choice": "best"}))
    j = db.get_job("a")
    assert j["status"] == "queued"
    assert j["params"]["choice"] == "best"   # round-trips JSON


def test_update(fresh_db):
    db = fresh_db
    db.create_job(_job("b"))
    db.update_job("b", status="done", progress=100, filename="out.mp4", size=123)
    j = db.get_job("b")
    assert j["status"] == "done" and j["size"] == 123 and j["filename"] == "out.mp4"


def test_list_scoped_to_user(fresh_db):
    db = fresh_db
    db.create_job(_job("c", user_id="u1"))
    db.create_job(_job("d", user_id="u2"))
    ids = {j["id"] for j in db.list_jobs("u1")}
    assert ids == {"c"}


def test_find_inflight_and_cached(fresh_db):
    db = fresh_db
    db.create_job(_job("e", dl_key="K", status="downloading"))
    assert db.find_inflight("K")["id"] == "e"
    db.update_job("e", status="done", filepath="/tmp/x")
    assert db.find_inflight("K") is None
    assert db.find_cached("K")["id"] == "e"


def test_recover_interrupted(fresh_db):
    db = fresh_db
    db.create_job(_job("f", status="downloading"))
    db.create_job(_job("g", status="queued"))
    db.create_job(_job("h", status="done"))
    n = db.recover_interrupted()
    assert n == 2
    assert db.get_job("f")["status"] == "interrupted"
    assert db.get_job("h")["status"] == "done"


def test_reap_old(fresh_db):
    db = fresh_db
    db.create_job(_job("old", created_at=time.time() - 10_000))
    db.create_job(_job("new", created_at=time.time()))
    reaped = db.reap_old(time.time() - 5_000)
    assert reaped == ["old"]
    assert db.get_job("old") is None and db.get_job("new") is not None
