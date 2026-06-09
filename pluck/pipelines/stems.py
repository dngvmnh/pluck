"""Stem separation via Demucs -> vocals/drums/bass/other, delivered as a .zip (optional dependency).

Lazy-imports demucs so the core app runs without torch installed.
"""
import subprocess
import sys
from pathlib import Path

from ..config import DEMUCS_MODEL
from .base import JobCtx, download_source, trim_if_requested, zip_files


def separate_stems(src: Path, out_dir: Path) -> list[Path]:
    try:
        import demucs.separate  # noqa: F401
    except Exception as e:  # ImportError or a broken torch/torchaudio install
        raise RuntimeError(
            "Stem separation unavailable — Demucs not installed/working. "
            "Run: pip install -r requirements-ml.txt") from e

    # demucs writes to <out_dir>/<model>/<track>/{vocals,drums,bass,other}.wav
    cmd = [sys.executable, "-m", "demucs", "-n", DEMUCS_MODEL,
           "--out", str(out_dir), str(src)]
    r = subprocess.run(cmd, capture_output=True, timeout=3600)
    if r.returncode != 0:
        err = r.stderr.decode("utf-8", "ignore")
        if "torchcodec" in err.lower() or "TorchCodec" in err:
            raise RuntimeError(
                "Stem separation needs 'torchcodec' to decode audio (torchaudio>=2.1). "
                "Install it: pip install torchcodec  (see requirements-ml.txt)")
        raise RuntimeError("Demucs failed: " + err.strip().splitlines()[-1][:160] if err.strip()
                           else "Demucs failed (no output)")
    stems = sorted(out_dir.glob(f"{DEMUCS_MODEL}/**/*.wav"))
    if not stems:
        raise RuntimeError("demucs produced no stems")
    return stems


def run(ctx: JobCtx) -> Path:
    src = download_source(ctx, audio_only=True)
    src = trim_if_requested(src, ctx.req)
    ctx.update(status="processing")
    stems = separate_stems(src, ctx.job_dir)
    return zip_files(stems, ctx.job_dir / (src.stem + "-stems.zip"))
