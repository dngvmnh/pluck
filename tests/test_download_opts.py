"""build_opts: the paid Music processing must be gated on req.music, and Audio mode
without Music must produce plain audio (not video)."""
from pathlib import Path

from pluck.models import DownloadReq, OutputMode
from pluck.pipelines.download import build_opts


def _opts(**kw):
    return build_opts(DownloadReq(url="u", **kw), Path("/tmp"), lambda d: None)


def _pp_keys(opts):
    return {p["key"] for p in opts.get("postprocessors", [])}


def test_audio_without_music_is_plain_audio():
    o = _opts(output=OutputMode.AUDIO, choice="best", music=False)
    assert o["format"] == "ba[ext=m4a]/ba/b"          # audio, NOT video (bv*+ba)
    assert "EmbedThumbnail" not in _pp_keys(o)         # no paid music tagging
    assert "writethumbnail" not in o


def test_audio_with_music_does_full_tagging():
    o = _opts(output=OutputMode.AUDIO, choice="best", music=True)
    assert o["format"] == "ba/b"
    assert {"FFmpegExtractAudio", "EmbedThumbnail", "FFmpegMetadata"} <= _pp_keys(o)
    assert o.get("writethumbnail") is True


def test_video_is_unaffected():
    o = _opts(output=OutputMode.VIDEO, choice="best")
    assert o["format"] == "bv*+ba/b"
    assert "EmbedThumbnail" not in _pp_keys(o)
