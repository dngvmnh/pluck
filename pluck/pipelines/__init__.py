"""Pipeline registry: OutputMode -> pipeline runner.

Each pipeline is `run(ctx: JobCtx) -> Path` and returns the final deliverable file.
The JobQueue (jobs.py) handles status transitions, caching and error capture.
"""
from ..models import OutputMode
from . import chapters, convert, download, gif, remaster, stems, transcribe
from .base import JobCtx, CancelledError

PIPELINES = {
    OutputMode.VIDEO: download.run,
    OutputMode.AUDIO: download.run,
    OutputMode.CONVERT: convert.run,
    OutputMode.GIF: gif.run,
    OutputMode.CHAPTERS: chapters.run,
    OutputMode.REMASTER: remaster.run,
    OutputMode.TRANSCRIPT: transcribe.run,
    OutputMode.STEMS: stems.run,
}

__all__ = ["PIPELINES", "JobCtx", "CancelledError"]
