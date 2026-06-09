"""Shared test fixtures. Sets temp DB + download dir BEFORE importing pluck."""
import os
import tempfile
from pathlib import Path

import pytest

_TMP = Path(tempfile.mkdtemp(prefix="pluck-test-"))
os.environ["PLUCK_DB"] = str(_TMP / "test.db")
os.environ["PLUCK_DL_DIR"] = str(_TMP / "downloads")
os.environ.setdefault("MYTHOS_API_URL", "http://localhost:4000")


@pytest.fixture()
def fresh_db(tmp_path, monkeypatch):
    """Point the DB layer at a per-test database file."""
    from pluck import db
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "jobs.db")
    # force a fresh thread-local connection bound to the new path
    if hasattr(db._local, "conn"):
        db._local.conn.close()
        del db._local.conn
    db.init_db()
    yield db
    if hasattr(db._local, "conn"):
        db._local.conn.close()
        del db._local.conn


@pytest.fixture()
def client(monkeypatch):
    """TestClient with a faked Mythos session + mocked SDK/wallet calls."""
    from fastapi.testclient import TestClient

    import pluck.mythos as mythos
    import pluck.routes.download as dl_route
    import pluck.routes.session as sess_route
    from pluck import db
    from pluck.app import app

    # fresh DB for the app
    db.init_db()

    fake_session = {"userId": "user-test-1", "displayName": "Test User",
                    "email": "test@example.com", "sessionJti": "jti-1"}

    # inject a session cookie by overriding the consumer() gate everywhere it's used
    def fake_consumer(request):
        return fake_session
    monkeypatch.setattr(mythos, "consumer", fake_consumer)
    monkeypatch.setattr(dl_route, "consumer", fake_consumer)
    monkeypatch.setattr(sess_route, "consumer", fake_consumer)
    import pluck.routes.info as info_route
    import pluck.routes.jobs as jobs_route
    monkeypatch.setattr(info_route, "consumer", fake_consumer)
    monkeypatch.setattr(jobs_route, "consumer", fake_consumer)

    # mock wallet + payment
    async def fake_balance(uid):
        return 100
    monkeypatch.setattr(mythos, "wallet_balance", fake_balance)
    monkeypatch.setattr(dl_route, "wallet_balance", fake_balance)
    monkeypatch.setattr(sess_route, "wallet_balance", fake_balance)

    charges = []

    async def fake_report_usage(jti, credits, reason=None):
        charges.append({"jti": jti, "credits": credits, "reason": reason})
    monkeypatch.setattr(dl_route, "report_usage", fake_report_usage)

    # don't actually run pipelines
    monkeypatch.setattr(dl_route.jobs, "submit", lambda *a, **k: None)

    c = TestClient(app)
    c.charges = charges
    c.fake_session = fake_session
    return c
