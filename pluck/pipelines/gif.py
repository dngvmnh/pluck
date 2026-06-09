"""Clip window -> high-quality animated GIF (two-pass palettegen/paletteuse)."""
from pathlib import Path

from ..ytdlp import parse_hms
from .base import JobCtx, download_source, run_ffmpeg

MAX_GIF_SECONDS = 30


def make_gif(src: Path, out: Path, start: float | None, end: float | None,
             fps: int = 12, width: int = 480) -> Path:
    fps = max(1, min(int(fps or 12), 30))
    width = max(120, min(int(width or 480), 1280))
    seek = []
    if start is not None:
        seek += ["-ss", str(start)]
    if end is not None:
        dur = max(0.1, (end - (start or 0)))
        seek += ["-t", str(min(dur, MAX_GIF_SECONDS))]
    else:
        seek += ["-t", str(MAX_GIF_SECONDS)]  # cap length so GIFs stay sane
    vf = f"fps={fps},scale={width}:-1:flags=lanczos"
    palette = out.with_name(out.stem + "-palette.png")
    r1 = run_ffmpeg([*seek, "-i", str(src), "-vf", f"{vf},palettegen=stats_mode=diff", str(palette)], timeout=300)
    if r1.returncode != 0 or not palette.exists():
        raise RuntimeError("gif palettegen failed: " + r1.stderr.decode("utf-8", "ignore")[-200:])
    r2 = run_ffmpeg([*seek, "-i", str(src), "-i", str(palette),
                     "-lavfi", f"{vf}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3", str(out)], timeout=300)
    palette.unlink(missing_ok=True)
    if r2.returncode != 0 or not out.exists() or out.stat().st_size == 0:
        raise RuntimeError("gif paletteuse failed: " + r2.stderr.decode("utf-8", "ignore")[-200:])
    return out


def run(ctx: JobCtx) -> Path:
    req = ctx.req
    src = download_source(ctx, height_cap=720)  # 720p source is plenty for a GIF
    ctx.update(status="processing")
    out = ctx.job_dir / (src.stem + ".gif")
    return make_gif(src, out, parse_hms(req.start), parse_hms(req.end), req.gif_fps, req.gif_width)
