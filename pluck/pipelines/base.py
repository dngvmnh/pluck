"""Shared pipeline plumbing: job context, ffmpeg helpers, trim, subtitle sidecars."""
import subprocess
import time
import zipfile
from pathlib import Path

import yt_dlp

from .. import db
from ..config import DL_DIR, FFMPEG
from ..models import DownloadReq
from ..ytdlp import parse_hms, ydl_base


class CancelledError(Exception):
    """Raised inside a pipeline when the job was cancelled by the user."""


class JobCtx:
    """Per-job context handed to every pipeline. Wraps DB updates + cancellation."""

    def __init__(self, job_id: str, req: DownloadReq):
        self.job_id = job_id
        self.req = req
        self.job_dir = DL_DIR / job_id
        self.job_dir.mkdir(parents=True, exist_ok=True)
        self._last_write = 0.0

    # ---- state -----------------------------------------------------------
    def update(self, **fields) -> None:
        db.update_job(self.job_id, **fields)

    def cancelled(self) -> bool:
        j = db.get_job(self.job_id)
        return bool(j) and j.get("status") == "cancelled"

    def check_cancelled(self) -> None:
        if self.cancelled():
            raise CancelledError()

    def ydl_progress_hook(self):
        """yt-dlp progress hook that throttles DB writes to ~4/s."""
        def hook(d):
            if self.cancelled():
                raise CancelledError()
            if d["status"] == "downloading":
                now = time.time()
                if now - self._last_write < 0.25:
                    return
                self._last_write = now
                total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
                done = d.get("downloaded_bytes") or 0
                self.update(status="downloading",
                            progress=round(done / total * 100, 1) if total else None,
                            speed=(d.get("_speed_str") or "").strip(),
                            eta=(d.get("_eta_str") or "").strip(),
                            total_bytes=total)
            elif d["status"] == "finished":
                self.update(status="processing")
        return hook


# ---- file helpers --------------------------------------------------------
def media_files(job_dir: Path, exclude=(".part", ".zip")) -> list[Path]:
    return [p for p in job_dir.iterdir()
            if p.is_file() and not p.name.endswith(exclude)]


def largest_file(job_dir: Path) -> Path:
    files = media_files(job_dir)
    if not files:
        raise RuntimeError("no output file produced")
    return max(files, key=lambda p: p.stat().st_size)


def zip_files(paths: list[Path], zip_path: Path) -> Path:
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_STORED) as z:
        for p in sorted(paths):
            z.write(p, p.name)
    return zip_path


def run_ffmpeg(args: list[str], timeout: int = 600) -> subprocess.CompletedProcess:
    return subprocess.run([FFMPEG, "-y", "-loglevel", "error", *args],
                          capture_output=True, timeout=timeout)


# ---- trim (download-then-cut; network range-download segfaults with static ffmpeg) ----
def trim_if_requested(out: Path, req: DownloadReq) -> Path:
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
    if ext == ".mp3":
        args = [*seek, "-i", str(out), "-i", str(out),
                "-map", "0:a:0", "-c:a", "libmp3lame", "-b:a", "192k",
                "-map", "1:v:0?", "-c:v", "mjpeg", "-disposition:v", "attached_pic",
                "-id3v2_version", "3", str(clip)]
    elif ext in (".m4a", ".aac", ".opus", ".flac", ".ogg", ".wav"):
        args = [*seek, "-i", str(out), "-map", "0:a:0", "-c:a", "aac", "-b:a", "192k", str(clip)]
    else:  # video: stream copy is fine
        args = [*seek, "-i", str(out), "-c", "copy", str(clip)]
    try:
        r = run_ffmpeg(args, timeout=180)
        if r.returncode == 0 and clip.exists() and clip.stat().st_size > 0:
            out.unlink(missing_ok=True)
            return clip
    except Exception:
        pass
    return out


def download_source(ctx: "JobCtx", audio_only: bool = False, height_cap: int | None = None) -> Path:
    """Download a single source file (no post-processing) for pipelines that
    transform a downloaded media file (gif/convert/chapters/remaster/transcribe/stems).
    Returns the largest produced file. Honours trim for the source where relevant.
    """
    req = ctx.req
    if audio_only:
        fmt = "ba/b"
    elif height_cap:
        fmt = f"bv*[height<={height_cap}]+ba/b[height<={height_cap}]/b"
    else:
        from ..ytdlp import format_selector
        fmt, _ = format_selector(req.choice if req.choice not in ("audio-m4a", "audio-mp3") else "best")
    opts = {**ydl_base(), "noplaylist": True, "format": fmt,
            "outtmpl": str(ctx.job_dir / "src.%(ext)s"),
            "progress_hooks": [ctx.ydl_progress_hook()]}
    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.download([req.url.strip()])
    ctx.check_cancelled()
    return largest_file(ctx.job_dir)


def fetch_subs(url: str, job_dir: Path) -> list[Path]:
    """Best-effort English .srt sidecars (separate pass so a subtitle 429 never aborts audio)."""
    opts = {**ydl_base(), "skip_download": True, "writesubtitles": True, "writeautomaticsub": True,
            "subtitleslangs": ["en", "en-US", "en-GB"], "ignoreerrors": True,
            "outtmpl": str(job_dir / "%(title).60B.%(ext)s")}
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([url])
    except Exception:
        pass
    srts = []
    for vtt in sorted(job_dir.glob("*.vtt")):
        srt = vtt.with_suffix(".srt")
        try:
            r = run_ffmpeg(["-i", str(vtt), str(srt)], timeout=60)
            if r.returncode == 0 and srt.exists():
                vtt.unlink(missing_ok=True)
                srts.append(srt)
        except Exception:
            pass
    return srts
