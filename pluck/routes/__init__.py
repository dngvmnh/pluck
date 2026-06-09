"""All API + page routers."""
from . import download, info, jobs, pages, session

ROUTERS = [pages.router, session.router, info.router, download.router, jobs.router]

__all__ = ["ROUTERS"]
