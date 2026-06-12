/** Express application factory. Mirrors pluck/app.py.
 *
 * Mythos integration (Node SDK):
 *  - handshakeRoute()        -> GET /.well-known/mythos-handshake (publish-time check)
 *  - requireLaunchToken()    -> /dashboard launch exchange (verify iss/aud/exp, consume
 *                               single-use jti; fails CLOSED if /consume errors)
 *  - reportUsage()           -> charged from the download route
 * The session itself lives in our own signed cookie (launch tokens are single-use).
 */
import cookieSession from "cookie-session";
import express from "express";
import sdk from "@mythos/sdk";

import { SESSION_SECRET, STATIC_DIR } from "./config.js";
import * as capabilities from "./capabilities.js";
import * as db from "./db.js";
import * as jobsMod from "./jobs.js";
import { consumer, walletBalance, walletTopup } from "./mythos.js";
import { createRouter as downloadRouter } from "./routes/download.js";
import { errorMiddleware } from "./routes/helpers.js";
import { createRouter as infoRouter } from "./routes/info.js";
import { createRouter as jobsRouter } from "./routes/jobs.js";
import { createRouter as pagesRouter } from "./routes/pages.js";
import { createRouter as sessionRouter } from "./routes/session.js";

const { requireLaunchToken, reportUsage, handshakeRoute, InsufficientFundsError } = sdk;

export function createApp(overrides = {}) {
  const deps = {
    consumer,
    walletBalance,
    walletTopup,
    reportUsage,
    InsufficientFundsError,
    jobs: jobsMod,
    db,
    has: capabilities.has,
    launchGate: requireLaunchToken(),
    ...overrides,
  };

  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "1mb" }));

  // our own cookie session (required by the Mythos launch-token exchange)
  app.use(cookieSession({
    name: "session",
    secret: SESSION_SECRET,
    httpOnly: true,
    sameSite: "lax",
    maxAge: 14 * 24 * 3600 * 1000,
  }));

  // Mythos handshake (publish-time check): GET /.well-known/mythos-handshake
  app.get("/.well-known/mythos-handshake", handshakeRoute());

  app.use(pagesRouter(deps));
  app.use(sessionRouter(deps));
  app.use(infoRouter(deps));
  app.use(downloadRouter(deps));
  app.use(jobsRouter(deps));

  // Serve static assets with `Cache-Control: no-cache` so browsers always revalidate
  // (via ETag/Last-Modified) and never get stuck on a stale stylesheet/JS module after
  // an edit. Still efficient — unchanged files return a cheap 304.
  app.use("/static", express.static(STATIC_DIR, {
    etag: true,
    lastModified: true,
    cacheControl: false,
    setHeaders: (res) => res.setHeader("Cache-Control", "no-cache"),
  }));

  app.use(errorMiddleware);
  return app;
}
