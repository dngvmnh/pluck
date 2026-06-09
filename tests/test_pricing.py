"""Pricing is the single source of truth — verify each option + combinations."""
from pluck.models import DownloadReq, OutputMode
from pluck.pricing import PRICING, cost_for

BASE = PRICING["base"]


def C(**kw):
    return cost_for(DownloadReq(url="u", **kw))


def test_base_download():
    assert C() == (BASE, "download")


def test_trim_adds_one():
    credits, reason = C(start="0:05", end="0:10")
    assert credits == BASE + PRICING["trim"]
    assert "trim" in reason


def test_4k_and_8k():
    assert C(choice="2160")[0] == BASE + PRICING["4k"]
    assert C(choice="4320")[0] == BASE + PRICING["8k"]


def test_audio_modifiers():
    assert C(subs=True)[0] == BASE + PRICING["subtitles"]
    assert C(sponsorblock=True)[0] == BASE + PRICING["sponsorblock"]
    assert C(music=True)[0] == BASE + PRICING["music"]


def test_output_modes():
    assert C(output=OutputMode.GIF)[0] == BASE + PRICING["gif"]
    assert C(output=OutputMode.CONVERT, convert_to="mp3")[0] == BASE + PRICING["convert"]
    assert C(output=OutputMode.CHAPTERS)[0] == BASE + PRICING["chapters"]
    assert C(output=OutputMode.REMASTER)[0] == BASE + PRICING["remaster"]
    assert C(output=OutputMode.TRANSCRIPT)[0] == BASE + PRICING["transcribe"]
    assert C(output=OutputMode.STEMS)[0] == BASE + PRICING["stems"]


def test_combination():
    credits, reason = C(choice="2160", subs=True, sponsorblock=True, start="1:00", end="2:00")
    assert credits == BASE + PRICING["4k"] + PRICING["subtitles"] + PRICING["sponsorblock"] + PRICING["trim"]
    for tag in ("download", "4k", "subtitles", "sponsorblock", "trim"):
        assert tag in reason


def test_gif_with_trim():
    credits, _ = C(output=OutputMode.GIF, start="0:00", end="0:05")
    assert credits == BASE + PRICING["gif"] + PRICING["trim"]


def test_convert_does_not_charge_unapplied_modifiers():
    # the convert pipeline never applies subs/sponsorblock, so they must not be billed
    credits, reason = C(output=OutputMode.CONVERT, convert_to="mp3", subs=True, sponsorblock=True)
    assert credits == BASE + PRICING["convert"]
    assert "subtitles" not in reason and "sponsorblock" not in reason


def test_chapters_does_not_charge_sponsorblock():
    credits, reason = C(output=OutputMode.CHAPTERS, sponsorblock=True)
    assert credits == BASE + PRICING["chapters"]
    assert "sponsorblock" not in reason
