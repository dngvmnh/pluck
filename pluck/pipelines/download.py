"""Standard single download: video (quality ladder) or audio/music mode.

Modifiers: trim, subtitles, sponsorblock, optional audio remaster.
"""
from pathlib import Path

import yt_dlp

from ..models import DownloadReq, OutputMode
from ..ytdlp import format_selector, ydl_base
from .base import JobCtx, fetch_subs, largest_file, trim_if_requested, zip_files
from .remaster import remaster_audio


def _is_audio(req: DownloadReq) -> bool:
    return req.output == OutputMode.AUDIO or req.music or req.choice in ("audio-m4a", "audio-mp3")


def build_opts(req: DownloadReq, job_dir: Path, hook) -> dict:
    opts = {**ydl_base(), "noplaylist": True,
            "outtmpl": str(job_dir / "%(title).80B.%(ext)s"), "progress_hooks": [hook]}
    pps = []
    if req.music:
        # Paid "Music" feature: MP3 + ID3 tags + JPEG album art + loudness normalize.
        # Gated strictly on req.music so the surcharge maps to delivered output.
        opts["format"] = "ba/b"
        opts["writethumbnail"] = True
        opts["postprocessor_args"] = {"extractaudio": ["-af", "loudnorm=I=-16:TP=-1.5:LRA=11"]}
        pps += [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"},
                {"key": "FFmpegMetadata"},
                {"key": "FFmpegThumbnailsConvertor", "format": "jpg"},
                {"key": "EmbedThumbnail"}]
    else:
        if req.output == OutputMode.AUDIO and req.choice not in ("audio-mp3",):
            # Plain audio (no tagging) — Audio mode without the Music surcharge.
            opts["format"] = "ba[ext=m4a]/ba/b"
            fpps = None
        else:
            fmt, fpps = format_selector(req.choice)
            opts["format"] = fmt
        if fpps:
            pps += fpps
        if req.subs:
            opts.update(writesubtitles=True, writeautomaticsub=True,
                        subtitleslangs=["en", "en-US", "en-GB"])
            pps += [{"key": "FFmpegSubtitlesConvertor", "format": "srt"},
                    {"key": "FFmpegEmbedSubtitle"}]
    if req.sponsorblock:
        opts["sponsorblock_remove"] = ["sponsor", "intro", "outro", "selfpromo", "interaction", "preview"]
    if pps:
        opts["postprocessors"] = pps
    return opts


def run(ctx: JobCtx) -> Path:
    req = ctx.req
    url = req.url.strip()
    with yt_dlp.YoutubeDL(build_opts(req, ctx.job_dir, ctx.ydl_progress_hook())) as ydl:
        ydl.download([url])
    ctx.check_cancelled()

    out = largest_file(ctx.job_dir)
    out = trim_if_requested(out, req)

    if req.remaster and _is_audio(req):
        out = remaster_audio(out)

    # mp3 can't carry subtitles — ship the .srt sidecar(s) in a zip alongside the audio
    if req.music and req.subs:
        srts = fetch_subs(url, ctx.job_dir)
        if srts:
            out = zip_files([out, *srts], ctx.job_dir / (out.stem + ".zip"))
    return out
