"""Credit pricing — the single source of truth (server-authoritative).

`cost_for(req)` computes the charge for one job. `/api/pricing` serves PRICING so
the frontend can show a live estimate without duplicating the numbers.
"""
import os

from .models import DownloadReq, OutputMode
from .ytdlp import parse_hms

BASE = int(os.environ.get("CREDITS_PER_DOWNLOAD", 2))

# Per-feature surcharges added on top of BASE.
PRICING = {
    "base": BASE,
    "trim": 1,
    "4k": 2,
    "8k": 4,
    "subtitles": 1,
    "music": 1,
    "sponsorblock": 1,
    "gif": 3,
    "convert": 1,
    "chapters": 2,
    "remaster": 2,
    "transcribe": 8,
    "stems": 15,
}

# Surcharge keyed by exclusive output mode.
_MODE_SURCHARGE = {
    OutputMode.GIF: ("gif", "gif"),
    OutputMode.CONVERT: ("convert", "convert"),
    OutputMode.CHAPTERS: ("chapters", "chapters"),
    OutputMode.REMASTER: ("remaster", "remaster"),
    OutputMode.TRANSCRIPT: ("transcribe", "transcribe"),
    OutputMode.STEMS: ("stems", "stems"),
}


def cost_for(req: DownloadReq) -> tuple[int, str]:
    """Credits + a '+'-joined reason string for a single (non-playlist) job."""
    credits, reasons = PRICING["base"], ["download"]

    mode = req.output
    if req.music and mode in (OutputMode.VIDEO, OutputMode.AUDIO):
        mode = OutputMode.AUDIO  # legacy music flag is an audio job

    # exclusive output-mode surcharge
    if mode in _MODE_SURCHARGE:
        key, reason = _MODE_SURCHARGE[mode]
        credits += PRICING[key]
        reasons.append(reason)
    elif mode == OutputMode.AUDIO and req.music:
        credits += PRICING["music"]
        reasons.append("music")

    # modifiers (apply where compatible with the mode)
    if parse_hms(req.start) is not None or parse_hms(req.end) is not None:
        credits += PRICING["trim"]
        reasons.append("trim")

    if mode in (OutputMode.VIDEO, OutputMode.CONVERT, OutputMode.GIF):
        if req.choice == "2160":
            credits += PRICING["4k"]
            reasons.append("4k")
        elif req.choice == "4320":
            credits += PRICING["8k"]
            reasons.append("8k")

    # subs + sponsorblock are only applied by the standard download pipeline (video/audio),
    # so only charge for them there — the convert/chapters pipelines don't honour them.
    if req.subs and mode in (OutputMode.VIDEO, OutputMode.AUDIO):
        credits += PRICING["subtitles"]
        reasons.append("subtitles")

    if req.sponsorblock and mode in (OutputMode.VIDEO, OutputMode.AUDIO):
        credits += PRICING["sponsorblock"]
        reasons.append("sponsorblock")

    # remaster as a modifier on an otherwise-audio/video job (distinct from REMASTER output mode)
    if req.remaster and mode in (OutputMode.AUDIO, OutputMode.VIDEO):
        credits += PRICING["remaster"]
        reasons.append("remaster")

    return credits, "+".join(reasons)
