"""Split a video by its chapters into separate files, delivered as a .zip."""
import re
from pathlib import Path

import yt_dlp

from ..ytdlp import ydl_base
from .base import JobCtx, download_source, run_ffmpeg, zip_files


def _safe(name: str) -> str:
    return re.sub(r"[^\w\- ]+", "_", name).strip()[:60] or "chapter"


def _get_chapters(url: str) -> list[dict]:
    with yt_dlp.YoutubeDL({**ydl_base(), "skip_download": True}) as ydl:
        info = ydl.extract_info(url, download=False)
    return info.get("chapters") or []


def split_chapters(src: Path, chapters: list[dict], out_dir: Path) -> list[Path]:
    parts: list[Path] = []
    ext = src.suffix
    for i, ch in enumerate(chapters):
        start, end = ch.get("start_time"), ch.get("end_time")
        title = _safe(ch.get("title") or f"chapter-{i + 1}")
        part = out_dir / f"{i + 1:02d}-{title}{ext}"
        seek = []
        if start is not None:
            seek += ["-ss", str(start)]
        if end is not None:
            seek += ["-to", str(end)]
        r = run_ffmpeg([*seek, "-i", str(src), "-c", "copy", str(part)], timeout=300)
        if r.returncode == 0 and part.exists() and part.stat().st_size > 0:
            parts.append(part)
    if not parts:
        raise RuntimeError("chapter split produced no files")
    return parts


def run(ctx: JobCtx) -> Path:
    url = ctx.req.url.strip()
    chapters = _get_chapters(url)
    if not chapters:
        raise RuntimeError("no chapters")
    src = download_source(ctx, height_cap=1080)
    ctx.update(status="processing")
    parts = split_chapters(src, chapters, ctx.job_dir)
    src.unlink(missing_ok=True)
    zip_path = ctx.job_dir / f"{src.stem}-chapters.zip"
    return zip_files(parts, zip_path)
