"""Render the redesigned Pluck UI in Chromium and save screenshots.

Runs the real app in-process (mocking only Mythos auth/wallet) so we can establish
a session without the launch flow, then drives the page with Playwright.
"""
import os
import tempfile
import threading
import time

_TMP = tempfile.mkdtemp(prefix="pluck-shots-")
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
os.makedirs(OUT, exist_ok=True)


async def _balance(uid):
    return 42
async def _charge(jti, credits, reason=None):
    pass
dl_route.wallet_balance = _balance
sess_route.wallet_balance = _balance
dl_route.report_usage = _charge
app.dependency_overrides[require_launch_token] = lambda: MythosSession(
    userId="demo", email="linus@consumer.example", displayName="Linus Pauling",
    listingId="L", sessionJti="jti")

_jobs.start_background(recover=False)

config = uvicorn.Config(app, host="127.0.0.1", port=8011, log_level="warning")
server = uvicorn.Server(config)
server.install_signal_handlers = lambda: None
threading.Thread(target=server.run, daemon=True).start()
while not server.started:
    time.sleep(0.2)

APP = "http://127.0.0.1:8011"
BBB = '.ex[data-url*="aqz-KE-bpKQ"]'


def main():
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--no-sandbox"])
        page = b.new_context(viewport={"width": 1100, "height": 950}).new_page()

        page.goto(f"{APP}/dashboard", wait_until="load")  # sets session, redirects to /
        page.wait_for_timeout(800)
        page.screenshot(path=f"{OUT}/redesign-01-home.png", full_page=True)
        print("saved home")

        page.click(BBB)
        page.wait_for_selector("#result:not(.hidden)", timeout=60000)
        page.wait_for_timeout(1200)
        page.screenshot(path=f"{OUT}/redesign-02-result.png", full_page=True)
        print("saved result (video mode + output selector)")

        # GIF mode shows the gif pane + options
        page.click('.mode-chip[data-mode="gif"]')
        page.click("#adv > summary")
        page.wait_for_timeout(400)
        page.screenshot(path=f"{OUT}/redesign-03-gif-mode.png", full_page=True)
        print("saved gif mode")

        # Convert mode
        page.click('.mode-chip[data-mode="convert"]')
        page.wait_for_timeout(300)
        page.screenshot(path=f"{OUT}/redesign-04-convert-mode.png", full_page=True)
        print("saved convert mode")

        # Settings tab + light theme
        page.click('.tab[data-tab="settings"]')
        page.wait_for_timeout(300)
        page.select_option("#setTheme", "light")
        page.wait_for_timeout(400)
        page.screenshot(path=f"{OUT}/redesign-05-settings-light.png", full_page=True)
        print("saved settings (light theme)")

        # Library tab (light theme persists)
        page.click('.tab[data-tab="library"]')
        page.wait_for_timeout(400)
        page.screenshot(path=f"{OUT}/redesign-06-library-light.png", full_page=True)
        print("saved library")

        b.close()
    print("DONE")


if __name__ == "__main__":
    main()
