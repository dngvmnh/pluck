"""Central configuration: env vars, paths, constants.

Importing this module configures the Mythos SDK env BEFORE the SDK is imported
anywhere else, exactly as the old single-file server.py did at module top.
"""
import os
from pathlib import Path

# Make the bundled ffmpeg + deno (JS runtime for full YouTube extraction) discoverable.
os.environ["PATH"] = os.path.expanduser("~/.deno/bin") + os.pathsep + os.environ.get("PATH", "")

# Pluck is a Mythos Producer — configure the SDK BEFORE importing it.
os.environ.setdefault("MYTHOS_API_URL", "http://localhost:4000")
os.environ.setdefault("MYTHOS_LISTING_ID", "11111111-1111-1111-1111-111111111111")

import shutil  # noqa: E402

# ---- paths ----------------------------------------------------------------
HERE = Path(__file__).parent          # .../pluck (the package)
ROOT = HERE.parent                    # repo root (where static/ + downloads/ live)
STATIC_DIR = ROOT / "static"
DL_DIR = Path(os.environ.get("PLUCK_DL_DIR", str(ROOT / "downloads")))
DL_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = Path(os.environ.get("PLUCK_DB", str(ROOT / "pluck.db")))

def _resolve_ffmpeg() -> str:
    """Prefer a system ffmpeg — its directory also has ffprobe, which several yt-dlp
    postprocessors (duration probe, metadata, merge) require. Fall back to the bundled
    imageio-ffmpeg (ffmpeg-only) when no system ffmpeg is on PATH."""
    if os.environ.get("FFMPEG_PATH"):
        return os.environ["FFMPEG_PATH"]
    sys_ffmpeg = shutil.which("ffmpeg")
    if sys_ffmpeg:
        return sys_ffmpeg
    import imageio_ffmpeg  # optional: only needed when there's no system ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


FFMPEG = _resolve_ffmpeg()

# ---- Mythos ----------------------------------------------------------------
MYTHOS_API = os.environ["MYTHOS_API_URL"]
IS_DEV = os.environ.get("MYTHOS_ENV", "development") != "production"

_DEV_SECRET = "pluck-dev-secret-change-in-prod"
SESSION_SECRET = os.environ.get("SESSION_SECRET", _DEV_SECRET)
# Fail closed: a known/default signing key in production lets anyone forge a session
# cookie and bypass the Mythos auth gate. Require a real secret when not in dev.
if not IS_DEV and SESSION_SECRET == _DEV_SECRET:
    raise RuntimeError(
        "SESSION_SECRET must be set to a strong random value in production "
        "(MYTHOS_ENV=production). Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\"")

# ---- job engine ------------------------------------------------------------
MAX_WORKERS = int(os.environ.get("PLUCK_MAX_WORKERS", 8))
JOB_TTL = int(os.environ.get("PLUCK_JOB_TTL", 86400))   # seconds before job + files are reaped
PLAYLIST_CAP = int(os.environ.get("PLAYLIST_CAP", 10))

# ---- download tuning -------------------------------------------------------
FRAG_CONCURRENCY = int(os.environ.get("PLUCK_FRAGMENTS", 8))
INFO_TTL = 300                          # seconds to trust a cached /api/info result
STD_HEIGHTS = [144, 240, 360, 480, 720, 1080, 1440, 2160, 4320]

# ---- ML (optional) ---------------------------------------------------------
WHISPER_MODEL = os.environ.get("PLUCK_WHISPER_MODEL", "base")
DEMUCS_MODEL = os.environ.get("PLUCK_DEMUCS_MODEL", "htdemucs")
