"""Screenshot the header search bar focused + unfocused, dark + light, to verify the pill."""
import os
import tempfile
import threading
import time

_TMP = tempfile.mkdtemp(prefix="pluck-search-")
os.environ["PLUCK_DB"] = os.path.join(_TMP, "s.db")
os.environ["PLUCK_DL_DIR"] = os.path.join(_TMP, "downloads")
os.environ.setdefault("MYTHOS_API_URL", "http://localhost:4000")

import uvicorn
from mythos_sdk import MythosSession, require_launch_token
from playwright.sync_api import sync_playwright

import pluck.routes.download as dl_route
import pluck.routes.session as sess_route
from pluck import jobs as _jobs
from pluck.app import app

OUT = os.path.join(os.path.dirname(__file__), "..", "screenshots")


async def _b(uid): return 15
async def _c(jti, credits, reason=None): pass
dl_route.wallet_balance = _b; sess_route.wallet_balance = _b; dl_route.report_usage = _c
app.dependency_overrides[require_launch_token] = lambda: MythosSession(
    userId="demo", email="x@y.z", displayName="Demo", listingId="L", sessionJti="j")
_jobs.start_background(recover=False)

config = uvicorn.Config(app, host="127.0.0.1", port=8013, log_level="warning")
server = uvicorn.Server(config); server.install_signal_handlers = lambda: None
threading.Thread(target=server.run, daemon=True).start()
while not server.started:
    time.sleep(0.2)

CLIP = {"x": 0, "y": 0, "width": 1562, "height": 92}


def main():
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--no-sandbox"])
        pg = b.new_context(viewport={"width": 1562, "height": 400}, device_scale_factor=2).new_page()
        pg.goto("http://127.0.0.1:8013/dashboard", wait_until="load")
        pg.wait_for_timeout(500)

        pg.screenshot(path=f"{OUT}/search-dark-blur.png", clip=CLIP)
        pg.focus("#url")
        pg.wait_for_timeout(200)
        pg.screenshot(path=f"{OUT}/search-dark-focus.png", clip=CLIP)
        pg.fill("#url", "https://www.youtube.com/watch?v=aqz-KE-bpKQ")
        pg.wait_for_timeout(150)
        pg.screenshot(path=f"{OUT}/search-dark-text.png", clip=CLIP)

        pg.evaluate("document.documentElement.setAttribute('data-theme','light')")
        pg.wait_for_timeout(150)
        pg.screenshot(path=f"{OUT}/search-light-focus.png", clip=CLIP)
        b.close()
    print("DONE")


if __name__ == "__main__":
    main()
