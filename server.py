"""Pluck — a YouTube-styled front-end over yt-dlp, metered through Mythos.

Backend: FastAPI. Fetches metadata and downloads content you're authorized to grab
(your own uploads, public / Creative-Commons, platform-permitted). It does NOT
circumvent DRM, logins/paywalls, geoblocks, age-gates, or anti-bot.
"""
import os
import re
import shutil
import subprocess
import threading
import time
import uuid
import zipfile
from pathlib import Path

# Make the bundled ffmpeg + deno (JS runtime for full YouTube extraction) discoverable.
os.environ["PATH"] = os.path.expanduser("~/.deno/bin") + os.pathsep + os.environ.get("PATH", "")

# Pluck is a Mythos Producer — configure the SDK BEFORE importing it.
os.environ.setdefault("MYTHOS_API_URL", "http://localhost:4000")
os.environ.setdefault("MYTHOS_LISTING_ID", "11111111-1111-1111-1111-111111111111")
MYTHOS_API = os.environ["MYTHOS_API_URL"]
CREDITS_PER_DOWNLOAD = int(os.environ.get("CREDITS_PER_DOWNLOAD", 2))
PLAYLIST_CAP = int(os.environ.get("PLAYLIST_CAP", 10))

import httpx
import imageio_ffmpeg
import yt_dlp
from dataclasses import asdict
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from starlette.middleware.sessions import SessionMiddleware

from mythos_sdk import (require_launch_token, report_usage, handshake_router,
                        InsufficientFundsError, MythosSession)

HERE = Path(__file__).parent
DL_DIR = HERE / "downloads"
DL_DIR.mkdir(exist_ok=True)
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

limiter = Limiter(key_func=get_remote_address)
app = FastAPI(title="Pluck")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SessionMiddleware, secret_key=os.environ.get("SESSION_SECRET", "pluck-dev-secret-change-in-prod"))
app.include_router(handshake_router)  # GET /.well-known/mythos-handshake (publish-time check)
JOBS: dict[str, dict] = {}
JOBS_LOCK = threading.Lock()
_INFLIGHT: set[str] = set()  # dl_key values for in-progress downloads

from concurrent.futures import ThreadPoolExecutor
_POOL = ThreadPoolExecutor(max_workers=int(os.environ.get("PLUCK_MAX_WORKERS", 8)))
JOB_TTL = int(os.environ.get("PLUCK_JOB_TTL", 86400))  # seconds before job + files are reaped


def _reap_old_jobs():
    """Background thread: delete jobs + files older than JOB_TTL."""
    while True:
        time.sleep(3600)
        cutoff = time.time() - JOB_TTL
        with JOBS_LOCK:
            stale = [jid for jid, j in JOBS.items() if j.get("created_at", 0) < cutoff]
        for jid in stale:
            shutil.rmtree(DL_DIR / jid, ignore_errors=True)
            with JOBS_LOCK:
                JOBS.pop(jid, None)


threading.Thread(target=_reap_old_jobs, daemon=True).start()
STD_HEIGHTS = [144, 240, 360, 480, 720, 1080, 1440, 2160, 4320]

# ---- speed: faster downloader (if installed) + cache metadata / finished files ----
ARIA2C = shutil.which("aria2c")           # 16-connection downloader, used automatically if present
FRAG_CONCURRENCY = int(os.environ.get("PLUCK_FRAGMENTS", 8))
INFO_TTL = 300                            # seconds to trust a cached /api/info result
INFO_CACHE: dict[str, tuple[float, dict]] = {}
FILE_CACHE: dict[str, dict] = {}          # url+options -> finished file, for instant re-download


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
    base = {"quiet": True, "no_warnings": True, "noplaylist": True, "ffmpeg_location": FFMPEG,
            "concurrent_fragment_downloads": FRAG_CONCURRENCY,  # parallel DASH/HLS fragments
            "http_chunk_size": 10 * 1024 * 1024}                # sidesteps per-connection throttling
    if ARIA2C:                                                  # multi-connection downloader if installed
        base["external_downloader"] = "aria2c"
        base["external_downloader_args"] = {"aria2c": ["-x16", "-s16", "-k1M", "--max-tries=5"]}
    return base


def build_qualities(info: dict) -> list[dict]:
    heights = sorted({f.get("height") for f in info.get("formats", []) if f.get("height")})
    maxh = max(heights) if heights else 0
    qs = [{"id": "best", "label": "Best available", "sub": "video + audio", "kind": "video"}]
    for h in sorted((h for h in STD_HEIGHTS if h <= maxh), reverse=True):
        tag = "8K" if h == 4320 else "4K" if h == 2160 else "1440p" if h == 1440 else f"{h}p"
        qs.append({"id": str(h), "label": tag, "sub": "mp4", "kind": "video"})
    qs.append({"id": "audio-m4a", "label": "Audio only", "sub": "m4a", "kind": "audio"})
    qs.append({"id": "audio-mp3", "label": "Audio only", "sub": "mp3", "kind": "audio"})
    return qs


def format_selector(choice: str):
    if choice == "best":
        return "bv*+ba/b", None
    if choice == "audio-m4a":
        return "ba[ext=m4a]/ba/b", None
    if choice == "audio-mp3":
        return "ba/b", [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"}]
    h = int(choice)
    return f"bv*[height<={h}]+ba/b[height<={h}]/b", None


def parse_hms(s):
    """'90' / '1:30' / '01:02:03' -> seconds (float), or None."""
    if not s:
        return None
    try:
        nums = [float(p) for p in str(s).strip().split(":")]
    except ValueError:
        return None
    sec = 0.0
    for n in nums:
        sec = sec * 60 + n
    return sec


class InfoReq(BaseModel):
    url: str


class DownloadReq(BaseModel):
    url: str
    choice: str = "best"
    start: str | None = None        # trim
    end: str | None = None
    subs: bool = False              # download + embed subtitles
    music: bool = False             # audio + ID3 tags + album art + loudness normalize
    sponsorblock: bool = False      # cut sponsor/intro/outro segments
    playlist: bool = False          # bulk download a playlist/channel
    min_minutes: float | None = None  # smart filter: only videos longer than N minutes
    keyword: str | None = None        # smart filter: title contains keyword


def cost_for(req: "DownloadReq") -> tuple[int, str]:
    """Credits + reason for a single download, from the chosen premium options."""
    credits, reasons = CREDITS_PER_DOWNLOAD, ["download"]
    if parse_hms(req.start) is not None or parse_hms(req.end) is not None:
        credits += 1; reasons.append("trim")
    if req.choice == "2160":
        credits += 2; reasons.append("4k")
    elif req.choice == "4320":
        credits += 4; reasons.append("8k")
    if req.subs:
        credits += 1; reasons.append("subtitles")
    if req.music:
        credits += 1; reasons.append("music")
    if req.sponsorblock:
        credits += 1; reasons.append("sponsorblock")
    return credits, "+".join(reasons)


def _dl_key(req: "DownloadReq") -> str:
    """Stable cache key for a single download — same url+options means the same file."""
    return "|".join(str(x) for x in (req.url.strip(), req.choice, req.music, req.subs,
                                     req.sponsorblock, parse_hms(req.start), parse_hms(req.end)))


def _cache_info(url: str, data: dict) -> dict:
    INFO_CACHE[url] = (time.time(), data)
    return data


@app.post("/api/info")
@limiter.limit("30/minute")
def api_info(req: InfoReq, request: Request):
    consumer(request)  # AUTH gate
    url = (req.url or "").strip()
    if not url:
        raise HTTPException(400, "Paste a video URL.")
    cached = INFO_CACHE.get(url)                      # instant repeat lookups
    if cached and time.time() - cached[0] < INFO_TTL:
        return cached[1]
    try:
        with yt_dlp.YoutubeDL({**_ydl_base(), "noplaylist": False, "extract_flat": "in_playlist"}) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as e:
        raise HTTPException(422, f"Couldn't read that link: {str(e).splitlines()[-1][:200]}")

    if info.get("_type") == "playlist":
        entries = [e for e in (info.get("entries") or []) if e]
        thumb = None
        if entries:
            thumb = (entries[0].get("thumbnails") or [{}])[-1].get("url")
        return _cache_info(url, {
            "is_playlist": True,
            "title": info.get("title") or "Playlist",
            "uploader": info.get("uploader") or info.get("channel") or "",
            "count": info.get("playlist_count") or len(entries),
            "cap": PLAYLIST_CAP,
            "webpage_url": info.get("webpage_url") or url,
            "thumbnail": thumb,
            "items": [{"title": e.get("title") or "—", "duration_str": _fmt_duration(e.get("duration"))}
                      for e in entries[:8]],
        })
    return _cache_info(url, {
        "is_playlist": False,
        "title": info.get("title") or "Untitled",
        "uploader": info.get("uploader") or info.get("channel") or info.get("extractor_key") or "",
        "duration": info.get("duration"),
        "duration_str": _fmt_duration(info.get("duration")),
        "thumbnail": info.get("thumbnail"),
        "webpage_url": info.get("webpage_url") or url,
        "extractor": info.get("extractor_key") or info.get("extractor") or "",
        "view_count": info.get("view_count"),
        "qualities": build_qualities(info),
    })


def build_download_opts(req: "DownloadReq", job_dir: Path, hook) -> dict:
    opts = {**_ydl_base(), "noplaylist": True,
            "outtmpl": str(job_dir / "%(title).80B.%(ext)s"), "progress_hooks": [hook]}
    pps = []
    if req.music:                                            # MP3 + ID3 tags + JPEG album art + loudness
        opts["format"] = "ba/b"
        opts["writethumbnail"] = True
        opts["postprocessor_args"] = {"extractaudio": ["-af", "loudnorm=I=-16:TP=-1.5:LRA=11"]}
        pps += [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"},
                {"key": "FFmpegMetadata"},
                {"key": "FFmpegThumbnailsConvertor", "format": "jpg"},  # PNG cover breaks many players
                {"key": "EmbedThumbnail"}]
    else:
        fmt, fpps = format_selector(req.choice)
        opts["format"] = fmt
        if fpps:
            pps += fpps
        if req.subs:                                         # subtitles -> srt -> embedded
            opts.update(writesubtitles=True, writeautomaticsub=True, subtitleslangs=["en", "en-US", "en-GB"])
            pps += [{"key": "FFmpegSubtitlesConvertor", "format": "srt"}, {"key": "FFmpegEmbedSubtitle"}]
    if req.sponsorblock:                                     # cut sponsor/intro/outro
        opts["sponsorblock_remove"] = ["sponsor", "intro", "outro", "selfpromo", "interaction", "preview"]
    if pps:
        opts["postprocessors"] = pps
    return opts


def _trim_if_requested(out: Path, req: "DownloadReq") -> Path:
    """Trim start–end locally (stream copy). yt-dlp's network range-download segfaults
    with the bundled static ffmpeg, so we download then cut — reliable, costs bandwidth."""
    s, e = parse_hms(req.start), parse_hms(req.end)
    if s is None and e is None:
        return out
    clip = out.with_name(out.stem + "-clip" + out.suffix)
    ext = out.suffix.lower()
    seek = []
    if s is not None:
        seek += ["-ss", str(s)]
    if e is not None:
        seek += ["-to", str(e)]
    base = [FFMPEG, "-y", "-loglevel", "error"]
    if ext == ".mp3":
        # input 0 (seeked) = trimmed audio; input 1 (full) = cover frame — seeking past t=0
        # drops the attached-pic art, so take it from a second, un-seeked input.
        args = base + seek + ["-i", str(out), "-i", str(out),
                              "-map", "0:a:0", "-c:a", "libmp3lame", "-b:a", "192k",
                              "-map", "1:v:0?", "-c:v", "mjpeg", "-disposition:v", "attached_pic",
                              "-id3v2_version", "3", str(clip)]
    elif ext in (".m4a", ".aac", ".opus", ".flac", ".ogg", ".wav"):
        args = base + seek + ["-i", str(out), "-map", "0:a:0", "-c:a", "aac", "-b:a", "192k", str(clip)]
    else:  # video: stream copy is fine
        args = base + seek + ["-i", str(out), "-c", "copy", str(clip)]
    try:
        r = subprocess.run(args, capture_output=True, timeout=180)
        if r.returncode == 0 and clip.exists() and clip.stat().st_size > 0:
            out.unlink(missing_ok=True)
            return clip
    except Exception:
        pass
    return out


def _fetch_subs(url: str, job_dir: Path) -> list[Path]:
    """Best-effort English .srt sidecars for music mode. Separate pass so a subtitle
    429/rate-limit never aborts the audio download. Exact langs avoid pulling
    auto-translated tracks (en-de, en-fr, ...) that trigger HTTP 429."""
    opts = {**_ydl_base(), "skip_download": True, "writesubtitles": True, "writeautomaticsub": True,
            "subtitleslangs": ["en", "en-US", "en-GB"], "ignoreerrors": True,
            "outtmpl": str(job_dir / "%(title).60B.%(ext)s")}
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([url])
    except Exception:
        pass
    srts = []
    for vtt in sorted(job_dir.glob("*.vtt")):  # YouTube serves vtt; convert locally (PP skips on skip_download)
        srt = vtt.with_suffix(".srt")
        try:
            r = subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", str(vtt), str(srt)],
                               capture_output=True, timeout=60)
            if r.returncode == 0 and srt.exists():
                vtt.unlink(missing_ok=True)
                srts.append(srt)
        except Exception:
            pass
    return srts


def _run_job(job_id: str, req: "DownloadReq"):
    job = JOBS[job_id]
    job_dir = DL_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    def hook(d):
        if d["status"] == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            done = d.get("downloaded_bytes") or 0
            job.update(status="downloading",
                       progress=round(done / total * 100, 1) if total else None,
                       speed=d.get("_speed_str", "").strip(), eta=d.get("_eta_str", "").strip(),
                       total_bytes=total)
        elif d["status"] == "finished":
            job["status"] = "processing"

    try:
        if job.get("status") == "cancelled":
            return
        with yt_dlp.YoutubeDL(build_download_opts(req, job_dir, hook)) as ydl:
            ydl.download([req.url.strip()])
        files = [p for p in job_dir.iterdir() if p.is_file() and not p.name.endswith(".part")]
        if not files:
            raise RuntimeError("no output file produced")
        out = max(files, key=lambda p: p.stat().st_size)
        out = _trim_if_requested(out, req)
        if req.music and req.subs:  # mp3 can't carry subtitles — ship the .srt sidecar(s) in a zip
            srts = _fetch_subs(req.url.strip(), job_dir)
            if srts:
                zip_path = job_dir / (out.stem + ".zip")
                with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_STORED) as z:
                    z.write(out, out.name)
                    for s in srts:
                        z.write(s, s.name)
                out = zip_path
        job.update(status="done", progress=100, filename=out.name, filepath=str(out), size=out.stat().st_size)
        if job.get("_key"):  # remember this result so an identical request returns instantly
            FILE_CACHE[job["_key"]] = {"filepath": str(out), "filename": out.name, "size": out.stat().st_size}
    except Exception as e:
        job.update(status="error", error=str(e).splitlines()[-1][:200])
    finally:
        with JOBS_LOCK:
            _INFLIGHT.discard(job.get("_key", ""))


def _run_playlist_job(job_id: str, req: "DownloadReq"):
    job = JOBS[job_id]
    job_dir = DL_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    done = {"n": 0}

    def hook(d):
        if d["status"] == "downloading":
            job.update(status="downloading", speed=d.get("_speed_str", "").strip(),
                       current=((d.get("info_dict") or {}).get("title") or "")[:70], items_done=done["n"])
        elif d["status"] == "finished":
            done["n"] += 1
            job.update(items_done=done["n"], status="processing")

    opts = {**_ydl_base(), "noplaylist": False, "ignoreerrors": True, "playlistend": PLAYLIST_CAP,
            "outtmpl": str(job_dir / "%(playlist_index)03d-%(title).60B.%(ext)s"),
            "format": "bv*[height<=720]+ba/b[height<=720]/b", "progress_hooks": [hook]}
    mf = []
    if req.min_minutes:
        mf.append(f"duration > {float(req.min_minutes) * 60}")
    if req.keyword:
        mf.append(f"title ~= '(?i){re.escape(req.keyword)}'")
    if mf:
        from yt_dlp.utils import match_filter_func
        opts["match_filter"] = match_filter_func(" & ".join(mf))
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([req.url.strip()])
        media = [p for p in job_dir.iterdir()
                 if p.is_file() and not p.name.endswith((".part", ".zip"))]
        if not media:
            raise RuntimeError("no videos matched / downloaded")
        zip_path = job_dir / "playlist.zip"
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_STORED) as z:
            for p in sorted(media):
                z.write(p, p.name)
        job.update(status="done", progress=100, items_done=len(media),
                   filename=f"{(req.keyword or 'playlist')}-{len(media)}-videos.zip",
                   filepath=str(zip_path), size=zip_path.stat().st_size)
    except Exception as e:
        job.update(status="error", error=str(e).splitlines()[-1][:200])


@app.post("/api/download")
async def api_download(req: DownloadReq, request: Request):
    m = consumer(request)  # AUTH gate

    if req.playlist:  # bulk: charge per video that passes the filter (capped)
        kw = (req.keyword or "").lower()

        def _match(e):
            if req.min_minutes and (e.get("duration") or 0) <= float(req.min_minutes) * 60:
                return False
            if kw and kw not in (e.get("title") or "").lower():
                return False
            return True

        # Use cached playlist info if available — avoid a second yt-dlp network call
        n = PLAYLIST_CAP
        cached_info = INFO_CACHE.get(req.url.strip())
        if cached_info and time.time() - cached_info[0] < INFO_TTL:
            pdata = cached_info[1]
            entries = pdata.get("items") or []
            if entries and (kw or req.min_minutes):
                n = sum(1 for e in entries if _match(e)) or 1
            elif pdata.get("count"):
                n = min(pdata["count"], PLAYLIST_CAP)
        else:
            try:
                with yt_dlp.YoutubeDL({**_ydl_base(), "noplaylist": False, "extract_flat": "in_playlist",
                                       "playlistend": PLAYLIST_CAP}) as ydl:
                    pinfo = ydl.extract_info(req.url.strip(), download=False)
                entries = [e for e in (pinfo.get("entries") or []) if e][:PLAYLIST_CAP]
                n = sum(1 for e in entries if _match(e)) if (kw or req.min_minutes) else len(entries)
            except Exception:
                n = PLAYLIST_CAP
        n = max(1, n)
        credits, reason = CREDITS_PER_DOWNLOAD * n, f"playlist-{n}"
        try:
            await report_usage(m["sessionJti"], credits=credits, reason=reason)
        except InsufficientFundsError:
            raise HTTPException(402, f"This batch (up to {n} videos) needs {credits} credits — top up")
        job_id = uuid.uuid4().hex[:12]
        with JOBS_LOCK:
            JOBS[job_id] = {"id": job_id, "status": "queued", "progress": 0, "playlist": True,
                            "items_total": n, "created_at": time.time()}
        _POOL.submit(_run_playlist_job, job_id, req)
        return {"job_id": job_id, "charged": credits, "balance": await wallet_balance(m["userId"])}

    credits, reason = cost_for(req)  # single download (PAYMENT scales with options)
    key = _dl_key(req)

    # Dedup: if an identical download is already in flight, reuse the existing job
    existing_job_id = None
    with JOBS_LOCK:
        if key in _INFLIGHT:
            for j in JOBS.values():
                if j.get("_key") == key and j.get("status") not in ("done", "error", "cancelled"):
                    existing_job_id = j["id"]
                    break

    try:
        await report_usage(m["sessionJti"], credits=credits, reason=reason)
    except InsufficientFundsError:
        raise HTTPException(402, f"This download needs {credits} credits — top up")

    if existing_job_id:
        return {"job_id": existing_job_id, "charged": credits, "balance": await wallet_balance(m["userId"])}

    cached = FILE_CACHE.get(key)
    if cached and Path(cached["filepath"]).exists():  # identical request -> serve the existing file
        job_id = uuid.uuid4().hex[:12]
        with JOBS_LOCK:
            JOBS[job_id] = {"id": job_id, "status": "done", "progress": 100, "cached": True,
                            "created_at": time.time(), **cached}
        return {"job_id": job_id, "charged": credits, "balance": await wallet_balance(m["userId"])}
    job_id = uuid.uuid4().hex[:12]
    with JOBS_LOCK:
        JOBS[job_id] = {"id": job_id, "status": "queued", "progress": 0, "choice": req.choice,
                        "_key": key, "created_at": time.time()}
        _INFLIGHT.add(key)
    _POOL.submit(_run_job, job_id, req)
    return {"job_id": job_id, "charged": credits, "balance": await wallet_balance(m["userId"])}


@app.get("/api/jobs/{job_id}")
def api_job(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "unknown job")
    return {k: v for k, v in job.items() if k != "filepath" and not k.startswith("_")}


@app.delete("/api/jobs/{job_id}")
def api_cancel_job(job_id: str, request: Request):
    consumer(request)
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "unknown job")
    if job.get("status") in ("done", "error"):
        return {"ok": True}  # already terminal, nothing to cancel
    job["status"] = "cancelled"
    job["error"] = "Cancelled by user"
    with JOBS_LOCK:
        _INFLIGHT.discard(job.get("_key", ""))
    return {"ok": True}


@app.get("/api/file/{job_id}")
def api_file(job_id: str):
    job = JOBS.get(job_id)
    if not job or job.get("status") != "done" or not job.get("filepath"):
        raise HTTPException(404, "file not ready")
    return FileResponse(job["filepath"], filename=job["filename"], media_type="application/octet-stream")


_IS_DEV = os.environ.get("MYTHOS_ENV", "development") != "production"
NOT_LAUNCHED_HTML = """<!doctype html><meta charset="utf-8"><title>Pluck</title>
<style>body{{background:#0f0f0f;color:#f1f1f1;font-family:system-ui,sans-serif;display:flex;
min-height:100vh;align-items:center;justify-content:center;text-align:center;margin:0}}
a{{display:inline-block;background:#1aa64a;color:#fff;padding:12px 22px;border-radius:24px;
text-decoration:none;font-weight:700;margin-top:14px}}.m{{color:#aaa}}</style>
<div><img src="/static/pluck-logo.png" width="96" style="border-radius:20px"><h1>Pluck</h1>
<p class="m">This app is metered through Mythos. Launch it from the Mythos platform to get a session.</p>
{dev_link}</div>"""


def _not_launched_html() -> str:
    dev_link = f'<a href="{MYTHOS_API}/">→ Go to the Mock Mythos launcher</a>' if _IS_DEV else \
               '<p class="m">Open this app from the Mythos marketplace.</p>'
    return NOT_LAUNCHED_HTML.format(dev_link=dev_link)


# ---- AUTH: exchange the single-use launch token, then keep our own session -
@app.get("/dashboard")
async def dashboard(request: Request, session: MythosSession = Depends(require_launch_token)):
    request.session["mythos"] = asdict(session)
    return RedirectResponse("/", status_code=303)


@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    if not request.session.get("mythos"):
        return HTMLResponse(_not_launched_html())
    return (HERE / "static" / "index.html").read_text(encoding="utf-8")


@app.get("/api/session")
async def api_session(request: Request):
    m = consumer(request)
    return {"user": m["displayName"], "email": m.get("email"),
            "balance": await wallet_balance(m["userId"]), "cost": CREDITS_PER_DOWNLOAD}


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
