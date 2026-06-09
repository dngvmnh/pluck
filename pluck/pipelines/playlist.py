"""Bulk playlist download + smart filter (min-minutes / title keyword) -> .zip."""
import re
from pathlib import Path

import yt_dlp

from ..config import PLAYLIST_CAP
from ..models import DownloadReq
from ..ytdlp import ydl_base
from .base import JobCtx, media_files, zip_files


def _match_filter(req: DownloadReq):
    mf = []
    if req.min_minutes:
        mf.append(f"duration > {float(req.min_minutes) * 60}")
    if req.keyword:
        mf.append(f"title ~= '(?i){re.escape(req.keyword)}'")
    if not mf:
        return None
    from yt_dlp.utils import match_filter_func
    return match_filter_func(" & ".join(mf))


def run(ctx: JobCtx) -> Path:
    req = ctx.req
    done = {"n": 0}

    def hook(d):
        if ctx.cancelled():
            from .base import CancelledError
            raise CancelledError()
        if d["status"] == "downloading":
            ctx.update(status="downloading", speed=(d.get("_speed_str") or "").strip(),
                       label=((d.get("info_dict") or {}).get("title") or "")[:70],
                       items_done=done["n"])
        elif d["status"] == "finished":
            done["n"] += 1
            ctx.update(items_done=done["n"], status="processing")

    opts = {**ydl_base(), "noplaylist": False, "ignoreerrors": True, "playlistend": PLAYLIST_CAP,
            "outtmpl": str(ctx.job_dir / "%(playlist_index)03d-%(title).60B.%(ext)s"),
            "format": "bv*[height<=720]+ba/b[height<=720]/b", "progress_hooks": [hook]}
    mf = _match_filter(req)
    if mf:
        opts["match_filter"] = mf

    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.download([req.url.strip()])
    ctx.check_cancelled()

    media = media_files(ctx.job_dir)
    if not media:
        raise RuntimeError("no videos matched / downloaded")
    ctx.update(items_done=len(media))
    zip_path = zip_files(media, ctx.job_dir / "playlist.zip")
    # rename for a nicer download filename
    nice = ctx.job_dir / f"{(req.keyword or 'playlist')}-{len(media)}-videos.zip"
    try:
        zip_path.rename(nice)
        return nice
    except OSError:
        return zip_path
