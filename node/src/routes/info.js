/** POST /api/info — metadata + available qualities (auth-gated, rate-limited).
 * Mirrors pluck/routes/info.py. */
import { Router } from "express";
import { rateLimit } from "express-rate-limit";

import { HttpError } from "../mythos.js";
import { extractInfo } from "../ytdlp.js";
import { wrap } from "./helpers.js";

export function createRouter(deps) {
  const { consumer } = deps;
  const router = Router();

  // 30/minute per client address, like the slowapi limiter on the Python route.
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { detail: "Rate limit exceeded: 30 per 1 minute" },
  });

  router.post("/api/info", limiter, wrap(async (req, res) => {
    consumer(req); // AUTH gate
    const url = String(req.body?.url ?? "").trim();
    if (!url) throw new HttpError(400, "Paste a video URL.");
    try {
      res.json(await extractInfo(url));
    } catch (e) {
      throw new HttpError(422, `Couldn't read that link: ${e.message}`);
    }
  }));

  return router;
}
