"""Real end-to-end smoke test (network): drives the actual job queue + pipelines +
SQLite + file serving through a genuine yt-dlp download. Mocks only the Mythos HTTP
calls (report_usage / wallet), whose contract is unchanged.

Run:  ./.venv/bin/python scripts/e2e_real.py
"""
import os
import tempfile
import time

_TMP = tempfile.mkdtemp(prefix="pluck-e2e-")
os.environ["PLUCK_DB"] = os.path.join(_TMP, "e2e.db")
os.environ["PLUCK_DL_DIR"] = os.path.join(_TMP, "downloads")
os.environ.setdefault("MYTHOS_API_URL", "http://localhost:4000")

from fastapi.testclient import TestClient  # noqa: E402
from mythos_sdk import MythosSession, require_launch_token  # noqa: E402

import pluck.routes.download as dl_route  # noqa: E402
from pluck import jobs as _jobs  # noqa: E402
from pluck.app import app  # noqa: E402

_jobs.start_background(recover=False)  # init DB + reaper (startup event needs the ctx-manager form)

SHORT = "https://www.youtube.com/watch?v=jNQXAC9IVRw"  # "Me at the zoo", ~19s


async def _no_charge(jti, credits, reason=None):
    print(f"  [mock] report_usage credits={credits} reason={reason}")


async def _balance(uid):
    return 100


dl_route.report_usage = _no_charge
dl_route.wallet_balance = _balance
import pluck.routes.session as sess_route  # noqa: E402
sess_route.wallet_balance = _balance

app.dependency_overrides[require_launch_token] = lambda: MythosSession(
    userId="e2e-user", email="e2e@example.com", displayName="E2E", listingId="L", sessionJti="jti")

c = TestClient(app)
c.get("/dashboard", follow_redirects=True)  # establish session cookie


def poll(job_id, timeout=180):
    t0 = time.time()
    last = None
    while time.time() - t0 < timeout:
        j = c.get(f"/api/jobs/{job_id}").json()
        if j.get("status") != last:
            last = j.get("status")
            print(f"  status={last} progress={j.get('progress')} {j.get('error') or ''}")
        if last in ("done", "error", "cancelled"):
            return j
        time.sleep(1.5)
    return {"status": "timeout"}


def run_case(name, payload):
    print(f"\n=== {name} ===")
    r = c.post("/api/download", json=payload)
    print("  POST", r.status_code, r.json() if r.status_code != 200 else {k: r.json()[k] for k in ("job_id", "charged")})
    if r.status_code != 200:
        return False
    jid = r.json()["job_id"]
    j = poll(jid)
    if j.get("status") != "done":
        print(f"  FAILED: {j}")
        return False
    f = c.get(f"/api/file/{jid}")
    print(f"  file: {f.status_code} {len(f.content)} bytes  name={j.get('filename')}")
    return f.status_code == 200 and len(f.content) > 0


def main():
    # sanity endpoints
    print("session:", c.get("/api/session").json())
    print("pricing.base:", c.get("/api/pricing").json()["pricing"]["base"])
    print("caps:", c.get("/api/capabilities").json())

    results = {
        "audio-mp3": run_case("audio mp3", {"url": SHORT, "choice": "audio-mp3", "output": "audio"}),
        "gif-clip": run_case("gif (0-3s)", {"url": SHORT, "output": "gif", "start": "0", "end": "3", "gif_fps": 10, "gif_width": 240}),
        "convert-mp3": run_case("convert -> mp3", {"url": SHORT, "output": "convert", "convert_to": "mp3"}),
        "library": None,
    }
    lib = c.get("/api/jobs").json()["jobs"]
    results["library"] = len(lib) >= 3
    print("\nlibrary entries:", len(lib))

    print("\n==== RESULTS ====")
    for k, v in results.items():
        print(f"  {k}: {'PASS' if v else 'FAIL'}")
    ok = all(results.values())
    print("OVERALL:", "PASS" if ok else "FAIL")
    raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    main()
