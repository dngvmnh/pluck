"""Format convert: remux (stream-copy) when possible, else transcode to convert_to."""
from pathlib import Path

from ..models import CONVERT_TARGETS
from .base import JobCtx, download_source, run_ffmpeg, trim_if_requested

AUDIO_TARGETS = {"mp3", "m4a", "opus", "wav", "flac"}

# Transcode recipes per target (audio targets re-encode audio; video targets try copy first).
_AUDIO_CODEC = {
    "mp3": ["-c:a", "libmp3lame", "-b:a", "192k"],
    "m4a": ["-c:a", "aac", "-b:a", "192k"],
    "opus": ["-c:a", "libopus", "-b:a", "160k"],
    "wav": ["-c:a", "pcm_s16le"],
    "flac": ["-c:a", "flac"],
}


def convert_file(src: Path, target: str) -> Path:
    target = (target or "").lower().lstrip(".")
    if target not in CONVERT_TARGETS:
        raise RuntimeError(f"unsupported convert target: {target!r}")
    out = src.with_name(src.stem + "-conv." + target)

    if target in AUDIO_TARGETS:
        args = ["-i", str(src), "-vn", *_AUDIO_CODEC[target], str(out)]
        r = run_ffmpeg(args, timeout=600)
    else:
        # video container: try stream copy first (fast, lossless), fall back to transcode
        r = run_ffmpeg(["-i", str(src), "-c", "copy", str(out)], timeout=600)
        if r.returncode != 0 or not out.exists() or out.stat().st_size == 0:
            vcodec = ["-c:v", "libvpx-vp9", "-c:a", "libopus"] if target == "webm" else ["-c:v", "libx264", "-c:a", "aac"]
            r = run_ffmpeg(["-i", str(src), *vcodec, str(out)], timeout=1200)

    if r.returncode == 0 and out.exists() and out.stat().st_size > 0:
        src.unlink(missing_ok=True)
        return out
    raise RuntimeError("convert failed: " + r.stderr.decode("utf-8", "ignore")[-200:])


def run(ctx: JobCtx) -> Path:
    req = ctx.req
    target = (req.convert_to or "").lower().lstrip(".")
    if target not in CONVERT_TARGETS:
        raise RuntimeError(f"unsupported convert target: {req.convert_to!r}")
    src = download_source(ctx, audio_only=target in AUDIO_TARGETS)
    ctx.update(status="processing")
    src = trim_if_requested(src, req)
    return convert_file(src, target)
