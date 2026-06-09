"""Pluck — a YouTube-styled front-end over yt-dlp, metered through Mythos.

Importing the package configures the Mythos SDK env (via .config) before anything
else, then exposes the FastAPI `app`.
"""
from . import config  # noqa: F401  — sets Mythos env BEFORE mythos_sdk is imported
from .app import app

__all__ = ["app"]
