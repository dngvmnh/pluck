"""POST /api/download — charge Mythos, then enqueue a job.

Handles single downloads (any output mode), multi-URL fan-out, and bulk playlists.
"""
import time
import uuid

from fastapi import APIRouter, HTTPException, Request

from mythos_sdk import InsufficientFundsError, report_usage

from .. import db, jobs
from ..capabilities import has
from ..config import PLAYLIST_CAP
from ..models import CONVERT_TARGETS, ML_MODES, DownloadReq, OutputMode
from ..mythos import consumer, wallet_balance
from ..pricing import PRICING, cost_for
from ..ytdlp import cached_info, ydl_base

router = APIRouter()

_ML_CAP = {OutputMode.TRANSCRIPT: "whisper", OutputMode.STEMS: "demucs"}


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


def _describe(req: DownloadReq) -> tuple[str, str | None, str]:
    """Best-effort title/thumb/label for the Library, from cached /api/info if present."""
    info = cached_info(req.url.strip()) or {}
    title = info.get("title") or req.url.strip()
    thumb = info.get("thumbnail")
    bits = [req.output.value if req.output != OutputMode.VIDEO else req.choice]
    if req.convert_to:
        bits.append(f"→{req.convert_to}")
    for flag, name in ((req.music, "music"), (req.subs, "subs"),
                       (req.sponsorblock, "no-sponsor"), (req.remaster, "remaster"),
                       (bool(req.start or req.end), "clip")):
        if flag:
            bits.append(name)
    return title, thumb, " · ".join(b for b in bits if b)


def _validate(req: DownloadReq) -> None:
    """Reject structurally-invalid requests BEFORE charging (no charge-without-work)."""
    if req.output in ML_MODES and not has(_ML_CAP[req.output]):
        raise HTTPException(400, f"{req.output.value.title()} is not available on this server")
    if req.output == OutputMode.CONVERT:
        target = (req.convert_to or "").lower().lstrip(".")
        if target not in CONVERT_TARGETS:
            raise HTTPException(400, f"Unsupported convert target: {req.convert_to!r}")


async def _start_single(m: dict, req: DownloadReq) -> dict:
    _validate(req)
    credits, reason = cost_for(req)
    key = jobs.dl_key(req)

    existing = db.find_inflight(key)
    try:
        await report_usage(m["sessionJti"], credits=credits, reason=reason)
    except InsufficientFundsError:
        raise HTTPException(402, f"This download needs {credits} credits — top up")

    if existing:  # identical request already running — reuse it (still a paid action)
        return {"job_id": existing["id"], "charged": credits}

    title, thumb, label = _describe(req)
    base_row = {"id": _new_id(), "user_id": m["userId"], "kind": "single",
                "output": req.output.value, "title": title, "thumb": thumb, "label": label,
                "params": req.model_dump(mode="json"), "dl_key": key, "charged": credits,
                "created_at": time.time()}

    cached = jobs.cached_result(key)
    if cached:  # identical request -> serve the existing file instantly
        db.create_job({**base_row, "status": "done", "progress": 100, **cached})
        return {"job_id": base_row["id"], "charged": credits}

    db.create_job({**base_row, "status": "queued", "progress": 0})
    jobs.submit(base_row["id"], req, is_playlist=False, key=key)
    return {"job_id": base_row["id"], "charged": credits}


async def _start_playlist(m: dict, req: DownloadReq) -> dict:
    kw = (req.keyword or "").lower()

    def _match(e):
        if req.min_minutes and (e.get("duration") or 0) <= float(req.min_minutes) * 60:
            return False
        if kw and kw not in (e.get("title") or "").lower():
            return False
        return True

    n = PLAYLIST_CAP
    pdata = cached_info(req.url.strip())
    if pdata:
        entries = pdata.get("items") or []
        if entries and (kw or req.min_minutes):
            n = sum(1 for e in entries if _match(e)) or 1
        elif pdata.get("count"):
            n = min(pdata["count"], PLAYLIST_CAP)
    else:
        import yt_dlp
        try:
            with yt_dlp.YoutubeDL({**ydl_base(), "noplaylist": False, "extract_flat": "in_playlist",
                                   "playlistend": PLAYLIST_CAP}) as ydl:
                pinfo = ydl.extract_info(req.url.strip(), download=False)
            entries = [e for e in (pinfo.get("entries") or []) if e][:PLAYLIST_CAP]
            n = sum(1 for e in entries if _match(e)) if (kw or req.min_minutes) else len(entries)
        except Exception:
            n = PLAYLIST_CAP
    n = max(1, n)

    credits, reason = PRICING["base"] * n, f"playlist-{n}"
    try:
        await report_usage(m["sessionJti"], credits=credits, reason=reason)
    except InsufficientFundsError:
        raise HTTPException(402, f"This batch (up to {n} videos) needs {credits} credits — top up")

    title, thumb, _ = _describe(req)
    job_id = _new_id()
    db.create_job({"id": job_id, "user_id": m["userId"], "kind": "playlist",
                   "output": "playlist", "status": "queued", "progress": 0,
                   "items_total": n, "title": title, "thumb": thumb,
                   "label": f"batch · {n} videos", "params": req.model_dump(mode="json"),
                   "charged": credits, "created_at": time.time()})
    jobs.submit(job_id, req, is_playlist=True)
    return {"job_id": job_id, "charged": credits}


@router.post("/api/download")
async def api_download(req: DownloadReq, request: Request):
    m = consumer(request)  # AUTH gate

    # multi-URL fan-out: one independent (charged) job per URL
    if req.urls:
        urls = [u.strip() for u in req.urls if u and u.strip()]
        if not urls:
            raise HTTPException(400, "No URLs provided")
        results = []
        for u in urls:
            sub = req.model_copy(update={"url": u, "urls": None})
            try:
                results.append({"url": u, **(await _start_single(m, sub))})
            except HTTPException as e:
                results.append({"url": u, "error": e.detail, "status": e.status_code})
        return {"jobs": results, "balance": await wallet_balance(m["userId"])}

    if req.playlist:
        res = await _start_playlist(m, req)
    else:
        res = await _start_single(m, req)
    res["balance"] = await wallet_balance(m["userId"])
    return res
