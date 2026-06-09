"""AI transcription via faster-whisper -> .srt + .txt (optional dependency).

Lazy-imports faster_whisper so the core app runs without it. The download route
rejects this mode with 400 when the capability is absent; this is the backstop.
"""
from pathlib import Path

from ..config import WHISPER_MODEL
from .base import JobCtx, download_source, trim_if_requested, zip_files


def _fmt_ts(seconds: float) -> str:
    ms = int(round(seconds * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def transcribe_file(src: Path) -> list[Path]:
    try:
        from faster_whisper import WhisperModel
    except Exception as e:  # ImportError, or a broken ctranslate2/av backend
        raise RuntimeError(
            "Transcription unavailable — Whisper backend not installed/working. "
            "Run: pip install -r requirements-ml.txt") from e

    try:
        model = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")
        segments, _info = model.transcribe(str(src))
    except Exception as e:
        raise RuntimeError(f"Transcription failed: {str(e).splitlines()[-1][:160]}") from e

    srt = src.with_suffix(".srt")
    txt = src.with_suffix(".txt")
    with srt.open("w", encoding="utf-8") as fsrt, txt.open("w", encoding="utf-8") as ftxt:
        for i, seg in enumerate(segments, 1):
            text = seg.text.strip()
            fsrt.write(f"{i}\n{_fmt_ts(seg.start)} --> {_fmt_ts(seg.end)}\n{text}\n\n")
            ftxt.write(text + "\n")
    return [srt, txt]


def run(ctx: JobCtx) -> Path:
    src = download_source(ctx, audio_only=True)
    src = trim_if_requested(src, ctx.req)
    ctx.update(status="processing")
    outs = transcribe_file(src)
    src.unlink(missing_ok=True)
    return zip_files(outs, ctx.job_dir / (outs[0].stem + "-transcript.zip"))
