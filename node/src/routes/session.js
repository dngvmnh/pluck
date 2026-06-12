/** Session / wallet / pricing / capabilities. Mirrors pluck/routes/session.py. */
import { Router } from "express";

import { capabilities } from "../capabilities.js";
import { PRICING } from "../pricing.js";
import { wrap } from "./helpers.js";

export function createRouter(deps) {
  const { consumer, walletBalance, walletTopup } = deps;
  const router = Router();

  router.get("/api/session", wrap(async (req, res) => {
    const m = consumer(req);
    res.json({
      user: m.displayName,
      email: m.email ?? null,
      balance: await walletBalance(m.userId),
      cost: PRICING.base,
    });
  }));

  router.post("/api/topup", wrap(async (req, res) => {
    const m = consumer(req);
    res.json({ balance: await walletTopup(m.userId, 10) });
  }));

  /** Single source of truth for the client's live cost estimate. */
  router.get("/api/pricing", (_req, res) => {
    res.json({ pricing: PRICING });
  });

  /** Which optional features are installed (UI hides the rest). */
  router.get("/api/capabilities", (_req, res) => {
    res.json(capabilities());
  });

  return router;
}
