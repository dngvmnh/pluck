"""Pluck entrypoint shim.

The implementation now lives in the `pluck/` package (see pluck/app.py). This shim
keeps `uvicorn server:app` and `python server.py` working unchanged.
"""
import os

from pluck import app  # noqa: F401  (re-exported for `uvicorn server:app`)

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))
