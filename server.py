"""Pluck — a YouTube-styled front-end over yt-dlp.

Backend: FastAPI. Fetches metadata and downloads content you're authorized to grab
(your own uploads, public / Creative-Commons, platform-permitted). It does NOT
circumvent DRM, logins/paywalls, or anti-bot — yt-dlp doesn't either.
"""
import os
import threading
import uuid
from pathlib import Path

# Make the bundled ffmpeg + deno (JS runtime for full YouTube extraction) discoverable.
os.environ["PATH"] = os.path.expanduser("~/.deno/bin") + os.pathsep + os.environ.get("PATH", "")

# Pluck is a Mythos Producer — configure the SDK BEFORE importing it.
os.environ.setdefault("MYTHOS_API_URL", "http://localhost:4000")
os.environ.setdefault("MYTHOS_LISTING_ID", "11111111-1111-1111-1111-111111111111")
MYTHOS_API = os.environ["MYTHOS_API_URL"]
CREDITS_PER_DOWNLOAD = int(os.environ.get("CREDITS_PER_DOWNLOAD", 2))

import httpx
import imageio_ffmpeg
import yt_dlp
from dataclasses import asdict
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.middleware.sessions import SessionMiddleware

from mythos_sdk import (require_launch_token, report_usage, handshake_router,
                        InsufficientFundsError, MythosSession)

HERE = Path(__file__).parent
DL_DIR = HERE / "downloads"
DL_DIR.mkdir(exist_ok=True)
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

app = FastAPI(title="Pluck")
app.add_middleware(SessionMiddleware, secret_key="pluck-mythos-demo")
app.include_router(handshake_router)  # GET /.well-known/mythos-handshake (publish-time check)
JOBS: dict[str, dict] = {}
STD_HEIGHTS = [144, 240, 360, 480, 720, 1080, 1440, 2160]


# ---- Mythos auth helpers (the AUTH gate) ----------------------------------
def consumer(request: Request) -> dict:
    m = request.session.get("mythos")
    if not m:
        raise HTTPException(401, "Launch Pluck from Mythos first")
    return m


async def wallet_balance(user_id: str):
    try:
        async with httpx.AsyncClient() as c:
            r = await c.get(f"{MYTHOS_API}/api/wallet/{user_id}")
            return r.json().get("balance") if r.status_code == 200 else None
    except Exception:
        return None


def _fmt_duration(secs) -> str:
    if not secs:
        return ""
    secs = int(secs)
    h, m, s = secs // 3600, (secs % 3600) // 60, secs % 60
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def _ydl_base() -> dict:
    return {"quiet": True, "no_warnings": True, "noplaylist": True, "ffmpeg_location": FFMPEG}


def build_qualities(info: dict) -> list[dict]:
    heights = sorted({f.get("height") for f in info.get("formats", []) if f.get("height")})
    maxh = max(heights) if heights else 0
    qs = [{"id": "best", "label": "Best available", "sub": "video + audio", "kind": "video"}]
    for h in sorted((h for h in STD_HEIGHTS if h <= maxh), reverse=True):
        tag = "4K" if h == 2160 else "1440p" if h == 1440 else f"{h}p"
        qs.append({"id": str(h), "label": tag, "sub": "mp4", "kind": "video"})
    qs.append({"id": "audio-m4a", "label": "Audio only", "sub": "m4a", "kind": "audio"})
    qs.append({"id": "audio-mp3", "label": "Audio only", "sub": "mp3", "kind": "audio"})
    return qs


def format_selector(choice: str):
    """Return (format_string, postprocessors) for a quality choice."""
    if choice == "best":
        return "bv*+ba/b", None
    if choice == "audio-m4a":
        return "ba[ext=m4a]/ba/b", None
    if choice == "audio-mp3":
        return "ba/b", [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"}]
    h = int(choice)
    return f"bv*[height<={h}]+ba/b[height<={h}]/b", None


class InfoReq(BaseModel):
    url: str


class DownloadReq(BaseModel):
    url: str
    choice: str = "best"


@app.post("/api/info")
def api_info(req: InfoReq, request: Request):
    consumer(request)  # AUTH gate
    url = (req.url or "").strip()
    if not url:
        raise HTTPException(400, "Paste a video URL.")
    try:
        with yt_dlp.YoutubeDL(_ydl_base()) as ydl:
            info = ydl.extract_info(url, download=False)
        if info.get("_type") == "playlist" and info.get("entries"):
            info = info["entries"][0]
    except Exception as e:
        raise HTTPException(422, f"Couldn't read that link: {str(e).splitlines()[-1][:200]}")
    return {
        "title": info.get("title") or "Untitled",
        "uploader": info.get("uploader") or info.get("channel") or info.get("extractor_key") or "",
        "duration": info.get("duration"),
        "duration_str": _fmt_duration(info.get("duration")),
        "thumbnail": info.get("thumbnail"),
        "webpage_url": info.get("webpage_url") or url,
        "extractor": info.get("extractor_key") or info.get("extractor") or "",
        "view_count": info.get("view_count"),
        "qualities": build_qualities(info),
    }


def _run_job(job_id: str, url: str, choice: str):
    job = JOBS[job_id]
    fmt, pps = format_selector(choice)
    job_dir = DL_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    def hook(d):
        if d["status"] == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            done = d.get("downloaded_bytes") or 0
            job.update(status="downloading",
                       progress=round(done / total * 100, 1) if total else None,
                       speed=d.get("_speed_str", "").strip(),
                       eta=d.get("_eta_str", "").strip(),
                       total_bytes=total)
        elif d["status"] == "finished":
            job["status"] = "processing"  # merge / post-process

    opts = {**_ydl_base(),
            "format": fmt,
            "outtmpl": str(job_dir / "%(title).80B.%(ext)s"),
            "progress_hooks": [hook]}
    if pps:
        opts["postprocessors"] = pps
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([url])
        files = [p for p in job_dir.iterdir() if p.is_file() and not p.name.endswith(".part")]
        if not files:
            raise RuntimeError("no output file produced")
        out = max(files, key=lambda p: p.stat().st_size)
        job.update(status="done", progress=100, filename=out.name,
                   filepath=str(out), size=out.stat().st_size)
    except Exception as e:
        job.update(status="error", error=str(e).splitlines()[-1][:200])


@app.post("/api/download")
async def api_download(req: DownloadReq, request: Request):
    m = consumer(request)  # AUTH gate
    # PAYMENT: debit the Consumer's Mythos wallet for this download.
    try:
        await report_usage(m["sessionJti"], credits=CREDITS_PER_DOWNLOAD, reason="video-download")
    except InsufficientFundsError:
        raise HTTPException(402, "Out of Mythos credits — top up to keep downloading")
    job_id = uuid.uuid4().hex[:12]
    JOBS[job_id] = {"id": job_id, "status": "queued", "progress": 0,
                    "choice": req.choice, "url": req.url}
    threading.Thread(target=_run_job, args=(job_id, req.url.strip(), req.choice), daemon=True).start()
    return {"job_id": job_id, "balance": await wallet_balance(m["userId"])}


@app.get("/api/jobs/{job_id}")
def api_job(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "unknown job")
    return {k: v for k, v in job.items() if k != "filepath"}


@app.get("/api/file/{job_id}")
def api_file(job_id: str):
    job = JOBS.get(job_id)
    if not job or job.get("status") != "done" or not job.get("filepath"):
        raise HTTPException(404, "file not ready")
    return FileResponse(job["filepath"], filename=job["filename"], media_type="application/octet-stream")


NOT_LAUNCHED_HTML = """<!doctype html><meta charset="utf-8"><title>Pluck</title>
<style>body{background:#0f0f0f;color:#f1f1f1;font-family:system-ui,sans-serif;display:flex;
min-height:100vh;align-items:center;justify-content:center;text-align:center;margin:0}
a{display:inline-block;background:#1aa64a;color:#fff;padding:12px 22px;border-radius:24px;
text-decoration:none;font-weight:700;margin-top:14px}.m{color:#aaa}</style>
<div><img src="/static/pluck-logo.png" width="96" style="border-radius:20px"><h1>Pluck</h1>
<p class="m">This app is metered through Mythos. Launch it from the Mythos platform to get a session.</p>
<a href="{api}/">→ Go to the Mock Mythos launcher</a></div>"""


# ---- AUTH: exchange the single-use launch token, then keep our own session -
@app.get("/dashboard")
async def dashboard(request: Request, session: MythosSession = Depends(require_launch_token)):
    request.session["mythos"] = asdict(session)
    return RedirectResponse("/", status_code=303)


@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    if not request.session.get("mythos"):
        return HTMLResponse(NOT_LAUNCHED_HTML.replace("{api}", MYTHOS_API))
    return (HERE / "static" / "index.html").read_text(encoding="utf-8")


@app.get("/api/session")
async def api_session(request: Request):
    m = consumer(request)
    return {"user": m["displayName"], "balance": await wallet_balance(m["userId"]),
            "cost": CREDITS_PER_DOWNLOAD}


@app.post("/api/topup")
async def api_topup(request: Request):
    m = consumer(request)
    async with httpx.AsyncClient() as c:
        await c.post(f"{MYTHOS_API}/api/wallet/topup", json={"userId": m["userId"], "amount": 10})
    return {"balance": await wallet_balance(m["userId"])}


app.mount("/static", StaticFiles(directory=HERE / "static"), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))
