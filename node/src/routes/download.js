/** POST /api/download — charge Mythos, then enqueue a job.
 *
 * Handles single downloads (any output mode), multi-URL fan-out, and bulk playlists.
 * Mirrors pluck/routes/download.py.
 */
import { randomUUID } from "node:crypto";

import { Router } from "express";

import { PLAYLIST_CAP } from "../config.js";
import { CONVERT_TARGETS, ML_MODES, OutputMode, parseDownloadReq } from "../models.js";
import { HttpError } from "../mythos.js";
import { PRICING, costFor } from "../pricing.js";
import { cachedInfo, dumpJson, ydlBaseArgs } from "../ytdlp.js";
import { wrap } from "./helpers.js";

const ML_CAP = { [OutputMode.TRANSCRIPT]: "whisper", [OutputMode.STEMS]: "demucs" };

function newId() {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

function title_(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Best-effort title/thumb/label for the Library, from cached /api/info if present. */
function describe(req) {
  const info = cachedInfo(req.url.trim()) || {};
  const title = info.title || req.url.trim();
  const thumb = info.thumbnail ?? null;
  const bits = [req.output !== OutputMode.VIDEO ? req.output : req.choice];
  if (req.convert_to) bits.push(`→${req.convert_to}`);
  for (const [flag, name] of [[req.music, "music"], [req.subs, "subs"],
    [req.sponsorblock, "no-sponsor"], [req.remaster, "remaster"],
    [Boolean(req.start || req.end), "clip"]]) {
    if (flag) bits.push(name);
  }
  return [title, thumb, bits.filter(Boolean).join(" · ")];
}

export function createRouter(deps) {
  const { consumer, walletBalance, reportUsage, InsufficientFundsError, jobs, db, has } = deps;
  const router = Router();

  /** Reject structurally-invalid requests BEFORE charging (no charge-without-work). */
  function validate(req) {
    if (ML_MODES.has(req.output) && !has(ML_CAP[req.output])) {
      throw new HttpError(400, `${title_(req.output)} is not available on this server`);
    }
    if (req.output === OutputMode.CONVERT) {
      const target = (req.convert_to || "").toLowerCase().replace(/^\.+/, "");
      if (!CONVERT_TARGETS.has(target)) {
        throw new HttpError(400, `Unsupported convert target: '${req.convert_to}'`);
      }
    }
  }

  async function startSingle(m, req) {
    validate(req);
    const [credits, reason] = costFor(req);
    const key = jobs.dlKey(req);

    const existing = db.findInflight(key);
    try {
      await reportUsage(m.sessionJti, { credits, reason });
    } catch (e) {
      if (e instanceof InsufficientFundsError) {
        throw new HttpError(402, `This download needs ${credits} credits — top up`);
      }
      throw e;
    }

    if (existing) { // identical request already running — reuse it (still a paid action)
      return { job_id: existing.id, charged: credits };
    }

    const [title, thumb, label] = describe(req);
    const baseRow = {
      id: newId(), user_id: m.userId, kind: "single",
      output: req.output, title, thumb, label,
      params: req, dl_key: key, charged: credits,
      created_at: Date.now() / 1000,
    };

    const cached = jobs.cachedResult(key);
    if (cached) { // identical request -> serve the existing file instantly
      db.createJob({ ...baseRow, status: "done", progress: 100, ...cached });
      return { job_id: baseRow.id, charged: credits };
    }

    db.createJob({ ...baseRow, status: "queued", progress: 0 });
    jobs.submit(baseRow.id, req, false, key);
    return { job_id: baseRow.id, charged: credits };
  }

  async function startPlaylist(m, req) {
    const kw = (req.keyword || "").toLowerCase();

    const match = (e) => {
      if (req.min_minutes && (e.duration || 0) <= Number(req.min_minutes) * 60) return false;
      if (kw && !(e.title || "").toLowerCase().includes(kw)) return false;
      return true;
    };

    let n = PLAYLIST_CAP;
    const pdata = cachedInfo(req.url.trim());
    if (pdata) {
      const entries = pdata.items || [];
      if (entries.length && (kw || req.min_minutes)) {
        n = entries.filter(match).length || 1;
      } else if (pdata.count) {
        n = Math.min(pdata.count, PLAYLIST_CAP);
      }
    } else {
      try {
        const infoArgs = ydlBaseArgs().filter((a) => a !== "--no-playlist");
        const pinfo = await dumpJson(req.url.trim(),
          [...infoArgs, "--yes-playlist", "--flat-playlist", "--playlist-end", String(PLAYLIST_CAP)]);
        const entries = (pinfo.entries || []).filter(Boolean).slice(0, PLAYLIST_CAP);
        n = (kw || req.min_minutes) ? entries.filter(match).length : entries.length;
      } catch {
        n = PLAYLIST_CAP;
      }
    }
    n = Math.max(1, n);

    const credits = PRICING.base * n;
    const reason = `playlist-${n}`;
    try {
      await reportUsage(m.sessionJti, { credits, reason });
    } catch (e) {
      if (e instanceof InsufficientFundsError) {
        throw new HttpError(402, `This batch (up to ${n} videos) needs ${credits} credits — top up`);
      }
      throw e;
    }

    const [title, thumb] = describe(req);
    const jobId = newId();
    db.createJob({
      id: jobId, user_id: m.userId, kind: "playlist",
      output: "playlist", status: "queued", progress: 0,
      items_total: n, title, thumb,
      label: `batch · ${n} videos`, params: req,
      charged: credits, created_at: Date.now() / 1000,
    });
    jobs.submit(jobId, req, true);
    return { job_id: jobId, charged: credits };
  }

  router.post("/api/download", wrap(async (httpReq, res) => {
    const m = consumer(httpReq); // AUTH gate
    const req = parseDownloadReq(httpReq.body);

    // multi-URL fan-out: one independent (charged) job per URL
    if (req.urls) {
      const urls = req.urls.map((u) => u.trim()).filter(Boolean);
      if (!urls.length) throw new HttpError(400, "No URLs provided");
      const results = [];
      for (const u of urls) {
        const sub = { ...req, url: u, urls: null };
        try {
          results.push({ url: u, ...(await startSingle(m, sub)) });
        } catch (e) {
          if (e instanceof HttpError) {
            results.push({ url: u, error: e.detail, status: e.status });
          } else {
            throw e;
          }
        }
      }
      return res.json({ jobs: results, balance: await walletBalance(m.userId) });
    }

    const result = req.playlist ? await startPlaylist(m, req) : await startSingle(m, req);
    result.balance = await walletBalance(m.userId);
    res.json(result);
  }));

  return router;
}
