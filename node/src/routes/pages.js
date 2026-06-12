/** HTML pages: the app shell, the Mythos launch exchange, and the not-launched gate.
 * Mirrors pluck/routes/pages.py — the Mythos Node SDK's requireLaunchToken() does the
 * single-use launch-token exchange (verify + consume, failing CLOSED on consume errors).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { Router } from "express";

import { IS_DEV, MYTHOS_API, STATIC_DIR } from "../config.js";
import { wrap } from "./helpers.js";

const NOT_LAUNCHED = (devLink) => `<!doctype html><meta charset="utf-8"><title>Pluck</title>
<style>body{background:#0f0f0f;color:#f1f1f1;font-family:system-ui,sans-serif;display:flex;
min-height:100vh;align-items:center;justify-content:center;text-align:center;margin:0}
a{display:inline-block;background:#1aa64a;color:#fff;padding:12px 22px;border-radius:24px;
text-decoration:none;font-weight:700;margin-top:14px}.m{color:#aaa}</style>
<div><img src="/static/pluck-logo.png" width="96" style="border-radius:20px"><h1>Pluck</h1>
<p class="m">This app is metered through Mythos. Launch it from the Mythos platform to get a session.</p>
${devLink}</div>`;

function notLaunchedHtml() {
  const devLink = IS_DEV
    ? `<a href="${MYTHOS_API}/">→ Go to the Mock Mythos launcher</a>`
    : '<p class="m">Open this app from the Mythos marketplace.</p>';
  return NOT_LAUNCHED(devLink);
}

export function createRouter(deps) {
  const { launchGate } = deps;
  const router = Router();

  /** AUTH: exchange the single-use launch token, then keep our own cookie session. */
  router.get("/dashboard", launchGate, wrap(async (req, res) => {
    req.session.mythos = req.mythos;
    res.redirect(303, "/");
  }));

  router.get("/", (req, res) => {
    if (!req.session?.mythos) {
      return res.type("html").send(notLaunchedHtml());
    }
    res.type("html").send(readFileSync(path.join(STATIC_DIR, "index.html"), "utf-8"));
  });

  return router;
}
