"""API routes via TestClient with mocked Mythos + mocked job submission."""


def test_pricing_endpoint(client):
    r = client.get("/api/pricing")
    assert r.status_code == 200
    p = r.json()["pricing"]
    assert p["base"] >= 1 and "gif" in p and "stems" in p


def test_capabilities_endpoint(client):
    r = client.get("/api/capabilities")
    assert r.status_code == 200
    caps = r.json()
    assert set(caps) >= {"ffmpeg", "whisper", "demucs"}


def test_session_endpoint(client):
    r = client.get("/api/session")
    assert r.status_code == 200
    body = r.json()
    assert body["user"] == "Test User" and body["balance"] == 100


def test_single_download_charges_once(client):
    r = client.post("/api/download", json={"url": "https://x/v", "choice": "1080"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert "job_id" in body and body["charged"] >= 2
    assert len(client.charges) == 1
    # job persisted + listable
    jid = body["job_id"]
    assert client.get(f"/api/jobs/{jid}").status_code == 200
    listed = client.get("/api/jobs").json()["jobs"]
    assert any(j["id"] == jid for j in listed)


def test_multi_url_fans_out(client):
    client.charges.clear()
    urls = ["https://x/1", "https://x/2", "https://x/3"]
    r = client.post("/api/download", json={"urls": urls, "choice": "best"})
    assert r.status_code == 200, r.text
    jobs = r.json()["jobs"]
    assert len(jobs) == 3
    assert all("job_id" in j for j in jobs)
    assert len(client.charges) == 3   # one charge per URL


def test_ml_mode_without_capability_400(client, monkeypatch):
    # Force the capability off (env-independent: ML deps may or may not be installed here)
    import pluck.routes.download as dl
    monkeypatch.setattr(dl, "has", lambda feature: False)
    r = client.post("/api/download", json={"url": "https://x/v", "output": "transcript"})
    assert r.status_code == 400
    assert "not available" in r.json()["detail"].lower()


def test_ml_mode_with_capability_proceeds(client, monkeypatch):
    import pluck.routes.download as dl
    monkeypatch.setattr(dl, "has", lambda feature: True)
    r = client.post("/api/download", json={"url": "https://x/v", "output": "stems"})
    assert r.status_code == 200 and "job_id" in r.json()


def test_convert_without_target_400_no_charge(client):
    client.charges.clear()
    r = client.post("/api/download", json={"url": "https://x/v", "output": "convert"})
    assert r.status_code == 400
    assert "convert target" in r.json()["detail"].lower()
    assert len(client.charges) == 0   # rejected BEFORE charging


def test_unknown_job_404(client):
    assert client.get("/api/jobs/doesnotexist").status_code == 404


def test_cross_user_job_and_file_are_404(client):
    """IDOR guard: a job owned by another user is invisible (404), not downloadable."""
    from pluck import db
    db.create_job({"id": "OTHER1", "user_id": "someone-else", "kind": "single",
                   "output": "video", "status": "done", "filepath": "/tmp/x", "filename": "x.mp4"})
    assert client.get("/api/jobs/OTHER1").status_code == 404
    assert client.get("/api/file/OTHER1").status_code == 404
    assert client.request("DELETE", "/api/jobs/OTHER1").status_code == 404


def test_remove_purges_owned_terminal_job(client):
    from pluck import db
    db.create_job({"id": "MINE1", "user_id": client.fake_session["userId"], "kind": "single",
                   "output": "video", "status": "done", "filepath": "/tmp/x", "filename": "x.mp4"})
    r = client.request("DELETE", "/api/jobs/MINE1")
    assert r.status_code == 200 and r.json().get("removed") is True
    assert db.get_job("MINE1") is None              # row actually deleted (Library Remove)
    assert client.get("/api/jobs/MINE1").status_code == 404


def test_not_launched_gate(client):
    # No session cookie -> the "Launch from Mythos" gate page, not the app shell.
    r = client.get("/")
    assert r.status_code == 200 and "Launch it from the Mythos platform" in r.text


def test_index_and_static_with_session(client):
    """After the launch-token exchange, / serves the redesigned shell and assets load."""
    from mythos_sdk import MythosSession, require_launch_token
    from pluck.app import app

    app.dependency_overrides[require_launch_token] = lambda: MythosSession(
        userId="user-test-1", email="t@e.com", displayName="Test User",
        listingId="L", sessionJti="jti-1")
    try:
        # /dashboard sets the cookie session and redirects to /
        r = client.get("/dashboard", follow_redirects=True)
        assert r.status_code == 200
        assert 'type="module"' in r.text and 'data-tab="library"' in r.text
        assert client.get("/static/js/main.js").status_code == 200
        assert client.get("/static/styles.css").status_code == 200
    finally:
        app.dependency_overrides.clear()
