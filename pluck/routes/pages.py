"""HTML pages: the app shell, the Mythos launch exchange, and the not-launched gate."""
from dataclasses import asdict

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from mythos_sdk import MythosSession, require_launch_token

from ..config import IS_DEV, MYTHOS_API, STATIC_DIR

router = APIRouter()

_NOT_LAUNCHED = """<!doctype html><meta charset="utf-8"><title>Pluck</title>
<style>body{{background:#0f0f0f;color:#f1f1f1;font-family:system-ui,sans-serif;display:flex;
min-height:100vh;align-items:center;justify-content:center;text-align:center;margin:0}}
a{{display:inline-block;background:#1aa64a;color:#fff;padding:12px 22px;border-radius:24px;
text-decoration:none;font-weight:700;margin-top:14px}}.m{{color:#aaa}}</style>
<div><img src="/static/pluck-logo.png" width="96" style="border-radius:20px"><h1>Pluck</h1>
<p class="m">This app is metered through Mythos. Launch it from the Mythos platform to get a session.</p>
{dev_link}</div>"""


def _not_launched_html() -> str:
    dev_link = (f'<a href="{MYTHOS_API}/">→ Go to the Mock Mythos launcher</a>' if IS_DEV
                else '<p class="m">Open this app from the Mythos marketplace.</p>')
    return _NOT_LAUNCHED.format(dev_link=dev_link)


@router.get("/dashboard")
async def dashboard(request: Request, session: MythosSession = Depends(require_launch_token)):
    """AUTH: exchange the single-use launch token, then keep our own cookie session."""
    request.session["mythos"] = asdict(session)
    return RedirectResponse("/", status_code=303)


@router.get("/", response_class=HTMLResponse)
def index(request: Request):
    if not request.session.get("mythos"):
        return HTMLResponse(_not_launched_html())
    return (STATIC_DIR / "index.html").read_text(encoding="utf-8")
