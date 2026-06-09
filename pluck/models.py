"""Request models + job enums."""
from enum import Enum

from pydantic import BaseModel


class OutputMode(str, Enum):
    VIDEO = "video"          # standard video download (quality ladder)
    AUDIO = "audio"          # audio-only / music mode
    GIF = "gif"              # clip window -> animated GIF
    CONVERT = "convert"      # remux / transcode to convert_to
    CHAPTERS = "chapters"    # split by chapters -> zip
    REMASTER = "remaster"    # audio denoise / loudness cleanup
    TRANSCRIPT = "transcript"  # Whisper -> .srt + .txt  (optional dep)
    STEMS = "stems"          # Demucs -> vocals/drums/bass/other zip  (optional dep)
    PLAYLIST = "playlist"    # bulk playlist (set implicitly when playlist=True)


class JobStatus(str, Enum):
    QUEUED = "queued"
    DOWNLOADING = "downloading"
    PROCESSING = "processing"
    DONE = "done"
    ERROR = "error"
    CANCELLED = "cancelled"
    INTERRUPTED = "interrupted"   # server restarted mid-job


# Output modes that need an optional heavy ML dependency.
ML_MODES = {OutputMode.TRANSCRIPT, OutputMode.STEMS}

# Allow-list of convert targets (container/codec) -> ffmpeg expectations.
CONVERT_TARGETS = {"mp4", "mkv", "webm", "mp3", "m4a", "opus", "wav", "flac"}


class InfoReq(BaseModel):
    url: str


class DownloadReq(BaseModel):
    url: str = ""
    urls: list[str] | None = None       # multi-URL fan-out (one job each)
    choice: str = "best"                # quality id
    output: OutputMode = OutputMode.VIDEO
    convert_to: str | None = None       # for output=convert
    gif_fps: int = 12                   # for output=gif
    gif_width: int = 480                # for output=gif
    start: str | None = None            # trim
    end: str | None = None
    subs: bool = False                  # download + embed subtitles
    music: bool = False                 # audio + ID3 tags + album art + loudness (legacy flag => AUDIO)
    sponsorblock: bool = False          # cut sponsor/intro/outro segments
    remaster: bool = False              # audio denoise/normalize (modifier on audio/remaster)
    playlist: bool = False              # bulk download a playlist/channel
    min_minutes: float | None = None    # smart filter: only videos longer than N minutes
    keyword: str | None = None          # smart filter: title contains keyword
