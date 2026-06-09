"""POST /api/info — metadata + available qualities (auth-gated, rate-limited)."""
from fastapi import APIRouter, HTTPException, Request

from ..models import InfoReq
from ..mythos import consumer
from ..ratelimit import limiter
from ..ytdlp import extract_info

router = APIRouter()


@router.post("/api/info")
@limiter.limit("30/minute")
def api_info(req: InfoReq, request: Request):
    consumer(request)  # AUTH gate
    url = (req.url or "").strip()
    if not url:
        raise HTTPException(400, "Paste a video URL.")
    try:
        return extract_info(url)
    except ValueError as e:
        raise HTTPException(422, f"Couldn't read that link: {e}")
