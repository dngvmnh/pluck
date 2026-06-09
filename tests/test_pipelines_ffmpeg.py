"""ffmpeg-native pipelines, tested against a locally generated clip (no network)."""
import subprocess

import pytest

from pluck.config import FFMPEG
from pluck.pipelines.chapters import split_chapters
from pluck.pipelines.convert import convert_file
from pluck.pipelines.gif import make_gif
from pluck.pipelines.remaster import remaster_audio


def _probe_streams(path):
    """Return ffprobe-less stream info via ffmpeg -i stderr (ffprobe may be absent)."""
    r = subprocess.run([FFMPEG, "-i", str(path)], capture_output=True)
    return r.stderr.decode("utf-8", "ignore")


@pytest.fixture()
def clip(tmp_path):
    """A 5s 320x240 test video with a sine audio track."""
    out = tmp_path / "src.mp4"
    r = subprocess.run([FFMPEG, "-y", "-loglevel", "error",
                        "-f", "lavfi", "-i", "testsrc=size=320x240:rate=15:duration=5",
                        "-f", "lavfi", "-i", "sine=frequency=440:duration=5",
                        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
                        "-shortest", str(out)], capture_output=True)
    assert r.returncode == 0 and out.exists() and out.stat().st_size > 0, r.stderr.decode()
    return out


def test_make_gif(clip, tmp_path):
    out = tmp_path / "out.gif"
    make_gif(clip, out, start=0.0, end=2.0, fps=10, width=200)
    assert out.exists() and out.stat().st_size > 0
    assert "Video: gif" in _probe_streams(out)


def test_convert_to_mp3(clip, tmp_path):
    out = convert_file(clip, "mp3")
    assert out.exists() and out.suffix == ".mp3" and out.stat().st_size > 0
    assert "Audio: mp3" in _probe_streams(out)


def test_convert_to_mkv(clip, tmp_path):
    out = convert_file(clip, "mkv")
    assert out.exists() and out.suffix == ".mkv" and out.stat().st_size > 0


def test_remaster_audio(clip, tmp_path):
    out = remaster_audio(clip)
    assert out.exists() and out.suffix == ".mp3" and out.stat().st_size > 0
    assert "Audio: mp3" in _probe_streams(out)


def test_split_chapters(clip, tmp_path):
    chapters = [{"title": "intro", "start_time": 0, "end_time": 2},
                {"title": "main", "start_time": 2, "end_time": 5}]
    parts = split_chapters(clip, chapters, tmp_path)
    assert len(parts) == 2
    assert all(p.exists() and p.stat().st_size > 0 for p in parts)
    assert parts[0].name.startswith("01-") and parts[1].name.startswith("02-")
