"""Detect optional features (heavy ML deps) so the UI can hide what isn't installed
and routes can reject unavailable modes with a clean 400 instead of a 500.

A feature is only "available" when its WHOLE runtime dependency chain is importable —
not just its top-level package. e.g. Demucs imports fine but fails at runtime with
"TorchCodec is required for load_with_torchcodec" unless `torchcodec` is also present,
so we require torchcodec too. This keeps the capability honest: a feature reported as
available will actually run, so we never charge for a job that's structurally doomed.
"""
import importlib.util
import shutil
from functools import lru_cache

from .config import FFMPEG


def _has_module(name: str) -> bool:
    try:
        return importlib.util.find_spec(name) is not None
    except Exception:
        return False


def _whisper_ok() -> bool:
    # faster-whisper runs on the ctranslate2 backend.
    return _has_module("faster_whisper") and _has_module("ctranslate2")


def _demucs_ok() -> bool:
    # Demucs needs torch + torchaudio; torchaudio>=2.1 decodes audio via torchcodec,
    # so without torchcodec, separation fails at runtime. Require the full chain.
    return all(_has_module(m) for m in ("demucs", "torch", "torchaudio", "torchcodec"))


@lru_cache(maxsize=1)
def capabilities() -> dict[str, bool]:
    return {
        "ffmpeg": bool(FFMPEG),
        "aria2c": shutil.which("aria2c") is not None,
        "whisper": _whisper_ok(),
        "demucs": _demucs_ok(),
    }


def has(feature: str) -> bool:
    return capabilities().get(feature, False)
