"""Mythos integration helpers: the AUTH gate + wallet reads/top-up.

Payment itself (report_usage) is called from the download route; this module owns
the session gate and wallet HTTP calls.
"""
import httpx
from fastapi import HTTPException, Request

from .config import MYTHOS_API


def consumer(request: Request) -> dict:
    """Gate every protected route on our own cookie session (launch tokens are single-use)."""
    m = request.session.get("mythos")
    if not m:
        raise HTTPException(401, "Launch Pluck from Mythos first")
    return m


async def wallet_balance(user_id: str):
    try:
        async with httpx.AsyncClient() as c:
            r = await c.get(f"{MYTHOS_API}/api/wallet/{user_id}")
            return r.json().get("balance") if r.status_code == 200 else None
    except Exception:
        return None


async def wallet_topup(user_id: str, amount: int = 10):
    async with httpx.AsyncClient() as c:
        await c.post(f"{MYTHOS_API}/api/wallet/topup", json={"userId": user_id, "amount": amount})
    return await wallet_balance(user_id)
