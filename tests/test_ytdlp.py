"""Pure yt-dlp helper functions."""
from pluck.ytdlp import build_qualities, fmt_duration, format_selector, parse_hms


def test_parse_hms():
    assert parse_hms("90") == 90
    assert parse_hms("1:30") == 90
    assert parse_hms("1:02:03") == 3723
    assert parse_hms("") is None
    assert parse_hms(None) is None
    assert parse_hms("abc") is None


def test_fmt_duration():
    assert fmt_duration(0) == ""
    assert fmt_duration(65) == "1:05"
    assert fmt_duration(3725) == "1:02:05"


def test_format_selector():
    assert format_selector("best") == ("bv*+ba/b", None)
    fmt, pps = format_selector("audio-mp3")
    assert pps and pps[0]["preferredcodec"] == "mp3"
    fmt, _ = format_selector("1080")
    assert "height<=1080" in fmt


def test_build_qualities():
    info = {"formats": [{"height": 720}, {"height": 1080}, {"height": 2160}]}
    qs = build_qualities(info)
    ids = [q["id"] for q in qs]
    assert ids[0] == "best"
    assert "2160" in ids and "1080" in ids and "720" in ids
    assert "audio-m4a" in ids and "audio-mp3" in ids
    # 8K not offered when source maxes at 2160
    assert "4320" not in ids
    # 4K labelled
    assert any(q["id"] == "2160" and q["label"] == "4K" for q in qs)
