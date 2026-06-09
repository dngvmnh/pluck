"""FastAPI application factory."""
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from starlette.middleware.sessions import SessionMiddleware

from mythos_sdk import handshake_router

from . import jobs
from .config import SESSION_SECRET, STATIC_DIR
from .ratelimit import limiter
from .routes import ROUTERS


class RevalidatingStatic(StaticFiles):
    """Serve static assets with `Cache-Control: no-cache` so browsers always revalidate
    (via ETag/Last-Modified) and never get stuck on a stale stylesheet/JS module after an edit.
    Still efficient — unchanged files return a cheap 304."""

    async def get_response(self, path, scope):
        resp = await super().get_response(path, scope)
        resp.headers["Cache-Control"] = "no-cache"
        return resp


def create_app() -> FastAPI:
    app = FastAPI(title="Pluck")

    # rate limiting
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

    # our own cookie session (required by the Mythos SDK launch-token exchange)
    app.add_middleware(SessionMiddleware, secret_key=SESSION_SECRET)

    # Mythos handshake (publish-time check): GET /.well-known/mythos-handshake
    app.include_router(handshake_router)
    for r in ROUTERS:
        app.include_router(r)

    app.mount("/static", RevalidatingStatic(directory=STATIC_DIR), name="static")

    @app.on_event("startup")
    def _startup() -> None:
        jobs.start_background(recover=True)

    return app


app = create_app()
