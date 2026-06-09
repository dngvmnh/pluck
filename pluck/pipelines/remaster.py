"""Audio remaster / denoise: ffmpeg afftdn + dynaudnorm (+ gentle band-pass).

Used both as the REMASTER output mode and as a `remaster` modifier on audio downloads.
"""
from pathlib import Path

from .base import JobCtx, download_source, run_ffmpeg, trim_if_requested

# Spectral denoise -> loudness normalize -> trim rumble/hiss.
FILTER = "afftdn=nf=-25,dynaudnorm=f=150:g=15,highpass=f=80,lowpass=f=15000"


def remaster_audio(src: Path) -> Path:
    out = src.with_name(src.stem + "-remastered.mp3")
    r = run_ffmpeg(["-i", str(src), "-vn", "-af", FILTER,
                    "-c:a", "libmp3lame", "-b:a", "192k", str(out)], timeout=600)
    if r.returncode == 0 and out.exists() and out.stat().st_size > 0:
        if src != out:
            src.unlink(missing_ok=True)
        return out
    raise RuntimeError("remaster failed: " + (r.stderr.decode("utf-8", "ignore").strip()[-200:] or "ffmpeg error"))


def run(ctx: JobCtx) -> Path:
    src = download_source(ctx, audio_only=True)
    ctx.update(status="processing")
    src = trim_if_requested(src, ctx.req)
    return remaster_audio(src)
