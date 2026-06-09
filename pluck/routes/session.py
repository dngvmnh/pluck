"""Session / wallet / pricing / capabilities."""
from fastapi import APIRouter, Request

from ..capabilities import capabilities
from ..mythos import consumer, wallet_balance, wallet_topup
from ..pricing import PRICING

router = APIRouter()


@router.get("/api/session")
async def api_session(request: Request):
    m = consumer(request)
    return {"user": m["displayName"], "email": m.get("email"),
            "balance": await wallet_balance(m["userId"]), "cost": PRICING["base"]}


@router.post("/api/topup")
async def api_topup(request: Request):
    m = consumer(request)
    return {"balance": await wallet_topup(m["userId"], 10)}


@router.get("/api/pricing")
def api_pricing():
    """Single source of truth for the client's live cost estimate."""
    return {"pricing": PRICING}


@router.get("/api/capabilities")
def api_capabilities():
    """Which optional features are installed (UI hides the rest)."""
    return capabilities()
