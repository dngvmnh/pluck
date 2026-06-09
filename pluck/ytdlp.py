"""yt-dlp helpers: option builders, quality ladder, metadata extraction, caches.

Pure-ish functions moved verbatim from the old server.py so behavior is unchanged.
"""
import shutil
import time

import yt_dlp

from .config import FFMPEG, FRAG_CONCURRENCY, INFO_TTL, PLAYLIST_CAP, STD_HEIGHTS

# 16-connection downloader, used automatically if present on PATH.
ARIA2C = shutil.which("aria2c")

# in-process caches (durable record lives in the DB; these are just fast paths)
INFO_CACHE: dict[str, tuple[float, dict]] = {}
CHANNEL_AVATAR_CACHE: dict[str, str | None] = {}


def parse_hms(s) -> float | None:
    """'90' / '1:30' / '01:02:03' -> seconds (float), or None."""
    if not s:
        return None
    try:
        nums = [float(p) for p in str(s).strip().split(":")]
    except ValueError:
        return None
    sec = 0.0
    for n in nums:
        sec = sec * 60 + n
    return sec


def fmt_duration(secs) -> str:
    if not secs:
        return ""
    secs = int(secs)
    h, m, s = secs // 3600, (secs % 3600) // 60, secs % 60
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def ydl_base() -> dict:
    base = {"quiet": True, "no_warnings": True, "noplaylist": True, "ffmpeg_location": FFMPEG,
            "concurrent_fragment_downloads": FRAG_CONCURRENCY,  # parallel DASH/HLS fragments
            "http_chunk_size": 10 * 1024 * 1024}                # sidesteps per-connection throttling
    if ARIA2C:                                                  # multi-connection downloader if installed
        base["external_downloader"] = "aria2c"
        base["external_downloader_args"] = {"aria2c": ["-x16", "-s16", "-k1M", "--max-tries=5"]}
    return base


def build_qualities(info: dict) -> list[dict]:
    heights = sorted({f.get("height") for f in info.get("formats", []) if f.get("height")})
    maxh = max(heights) if heights else 0
    qs = [{"id": "best", "label": "Best available", "sub": "video + audio", "kind": "video"}]
    for h in sorted((h for h in STD_HEIGHTS if h <= maxh), reverse=True):
        tag = "8K" if h == 4320 else "4K" if h == 2160 else "1440p" if h == 1440 else f"{h}p"
        qs.append({"id": str(h), "label": tag, "sub": "mp4", "kind": "video"})
    qs.append({"id": "audio-m4a", "label": "Audio only", "sub": "m4a", "kind": "audio"})
    qs.append({"id": "audio-mp3", "label": "Audio only", "sub": "mp3", "kind": "audio"})
    return qs


def format_selector(choice: str):
    if choice == "best":
        return "bv*+ba/b", None
    if choice == "audio-m4a":
        return "ba[ext=m4a]/ba/b", None
    if choice == "audio-mp3":
        return "ba/b", [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"}]
    h = int(choice)
    return f"bv*[height<={h}]+ba/b[height<={h}]/b", None


def get_channel_avatar(info: dict) -> str | None:
    """Return channel/uploader avatar URL. Tries yt-dlp fields first; for YouTube,
    fetches the channel page once per channel_id (result cached forever)."""
    for key in ("uploader_thumbnail", "channel_thumbnail", "avatar_url", "uploader_avatar"):
        v = info.get(key)
        if v and isinstance(v, str) and v.startswith("http"):
            return v

    channel_id = info.get("channel_id") or info.get("uploader_id")
    if not channel_id:
        return None
    if channel_id in CHANNEL_AVATAR_CACHE:
        return CHANNEL_AVATAR_CACHE[channel_id]

    channel_url = info.get("channel_url") or info.get("uploader_url")
    if not channel_url:
        CHANNEL_AVATAR_CACHE[channel_id] = None
        return None

    try:
        opts = {"quiet": True, "no_warnings": True, "extract_flat": True, "ffmpeg_location": FFMPEG}
        with yt_dlp.YoutubeDL(opts) as ydl:
            ch = ydl.extract_info(channel_url, download=False)
        thumbs = (ch or {}).get("thumbnails") or []
        # YouTube returns avatar (small) + banner (large) in thumbnails list.
        # Pick the largest square-ish thumbnail under 800 px wide (= avatar, not banner).
        avatar_thumbs = [t for t in thumbs if (t.get("width") or 9999) <= 800
                         and abs((t.get("width") or 1) - (t.get("height") or 1)) < 50]
        url = (max(avatar_thumbs, key=lambda t: t.get("width") or 0).get("url")
               if avatar_thumbs else (thumbs[0].get("url") if thumbs else None))
        CHANNEL_AVATAR_CACHE[channel_id] = url
        return url
    except Exception:
        CHANNEL_AVATAR_CACHE[channel_id] = None
        return None


def _cache_info(url: str, data: dict) -> dict:
    INFO_CACHE[url] = (time.time(), data)
    return data


def cached_info(url: str) -> dict | None:
    hit = INFO_CACHE.get(url)
    if hit and time.time() - hit[0] < INFO_TTL:
        return hit[1]
    return None


def extract_info(url: str) -> dict:
    """Fetch metadata and shape it for /api/info. Raises ValueError on a bad link.

    Returns the same dicts the old api_info endpoint returned (playlist or single),
    and caches the result for INFO_TTL seconds.
    """
    hit = cached_info(url)
    if hit is not None:
        return hit
    try:
        with yt_dlp.YoutubeDL({**ydl_base(), "noplaylist": False, "extract_flat": "in_playlist"}) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as e:
        raise ValueError(str(e).splitlines()[-1][:200])

    if info.get("_type") == "playlist":
        entries = [e for e in (info.get("entries") or []) if e]
        thumb = info.get("thumbnail")
        if not thumb and entries:
            thumb = ((entries[0].get("thumbnails") or [{}])[-1].get("url") or entries[0].get("thumbnail"))
        return _cache_info(url, {
            "is_playlist": True,
            "title": info.get("title") or "Playlist",
            "uploader": info.get("uploader") or info.get("channel") or "",
            "count": info.get("playlist_count") or len(entries),
            "cap": PLAYLIST_CAP,
            "webpage_url": info.get("webpage_url") or url,
            "thumbnail": thumb,
            "items": [{"title": e.get("title") or f"Track {i + 1}",
                       "duration": e.get("duration"),
                       "duration_str": fmt_duration(e.get("duration"))}
                      for i, e in enumerate(entries[:8])],
        })

    channel_avatar = get_channel_avatar(info)
    chapters = [{"title": c.get("title") or f"Chapter {i + 1}",
                 "start": c.get("start_time"), "end": c.get("end_time")}
                for i, c in enumerate(info.get("chapters") or [])]
    return _cache_info(url, {
        "is_playlist": False,
        "title": info.get("title") or "Untitled",
        "uploader": info.get("uploader") or info.get("channel") or info.get("extractor_key") or "",
        "channel_avatar": channel_avatar,
        "duration": info.get("duration"),
        "duration_str": fmt_duration(info.get("duration")),
        "thumbnail": info.get("thumbnail"),
        "webpage_url": info.get("webpage_url") or url,
        "extractor": info.get("extractor_key") or info.get("extractor") or "",
        "view_count": info.get("view_count"),
        "chapters": chapters,
        "has_chapters": bool(chapters),
        "qualities": build_qualities(info),
    })
