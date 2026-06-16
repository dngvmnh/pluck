# Pluck (Node)

An exact functional port of the Python Pluck app to **Node.js + Express**, integrated with the
official **Mythos Node SDK** (`@mythos/sdk`, vendored at `../vendor/packages/node`). Same API
contract, same frontend (its own copy of `static/`), same SQLite job model, same pricing —
so the two servers are interchangeable.

```
node/
  src/
    config.js          env + paths + fail-closed SESSION_SECRET     (= pluck/config.py)
    models.js          OutputMode / JobStatus / request parsing      (= pluck/models.py)
    db.js              SQLite via node:sqlite, WAL, cancel-guard     (= pluck/db.py)
    jobs.js            bounded-concurrency queue, dedup, reaper      (= pluck/jobs.py)
    pricing.js         single-source pricing + costFor               (= pluck/pricing.py)
    capabilities.js    honest feature detection (full dep chains)    (= pluck/capabilities.py)
    ytdlp.js           yt-dlp CLI arg builders + /api/info extract   (= pluck/ytdlp.py)
    mythos.js          consumer() session gate + wallet calls        (= pluck/mythos.py)
    pipelines/         download, gif, convert, chapters, remaster,
                       transcribe, stems, playlist                   (= pluck/pipelines/)
    routes/            pages, session, info, download, jobs          (= pluck/routes/)
    app.js             Express factory + Mythos SDK wiring           (= pluck/app.py)
    server.js          entrypoint                                    (= server.py)
  static/              the frontend (copy of ../static)
  tests/               node:test port of the pytest suite + a full
                       Mythos-SDK e2e against a mock Mythos backend
```

## Differences from the Python app (by design)

| Topic | Python | Node |
|---|---|---|
| yt-dlp | imported as a library | `yt-dlp` CLI subprocess (`PLUCK_YTDLP`) |
| ffmpeg | `imageio-ffmpeg` bundled binary | `ffmpeg-static` bundled binary (`FFMPEG_PATH`) |
| ML features | in-process `faster_whisper` / `demucs` | shells out to `PLUCK_PYTHON` (default `python`); hidden + 400 when the dep chain isn't importable there |
| Mythos SDK | vendored Python SDK | vendored **Node** SDK — which validates `iss` and **fails closed** when `/consume` errors (the Python SDK's middleware fails open on non-409 errors) |
| Concurrency | ThreadPoolExecutor | semaphore over async pipelines (children are real processes) |

Everything else — routes, status codes, error shapes (`{detail}`), pricing, dedup/cache keys,
ownership 404s, cookie session, `Cache-Control: no-cache` static — matches the Python app.

## Run

```bash
# 1) mock Mythos backend (same one the Python app uses)
(cd ../../Mythos/mythos-sdk-demo/mock-mythos-backend && npm install && npm start)   # :4000

# 2) Pluck (Node)
npm install
npm start                      # :8000  (PORT=8001 to run beside the Python app)
# open http://localhost:4000  ->  "Open Pluck"  (mints a launch token, redirects in)
```

Requires Node ≥ 22.5 (`node:sqlite`) and `yt-dlp` on PATH (or `PLUCK_YTDLP=...`).

Optional ML features: point `PLUCK_PYTHON` at a Python that has `requirements-ml.txt`
installed (faster-whisper + ctranslate2 for transcripts; demucs + torch + torchaudio +
torchcodec for stems). The UI hides what's missing.

## Test

```bash
npm test        # 66 tests: unit + ffmpeg pipelines + full Mythos launch/consume/meter e2e
```

The integration suite (`tests/integration-mythos.test.js`) spins up a **mock Mythos backend**
(JWKS + `/consume` + `/meter` + wallet) and proves, against the real SDK:

- launch-token exchange → cookie session → app shell
- replayed token → 401 (single-use consume)
- token minted by a different issuer → 401 (`iss` validation)
- `/consume` backend error → **503, no session** (fail-closed)
- a download charges exactly once through `reportUsage`

## Point at a real Mythos backend (e.g. staging)

Nothing is hard-coded to the mock — it's all env. To run against staging:

```bash
MYTHOS_API_URL=https://staging-be.mythos.work \
MYTHOS_LISTING_ID=<your-pluck-listing-uuid-on-staging> \
PORT=8000 npm start
```

- `MYTHOS_ISSUER` defaults to `mythos` (what the platform mints), so you don't set it.
- The SDK fetches signing keys from the platform's **per-listing** endpoint
  `GET /api/listings/:listingId/jwks` (unwrapping its `{success,data}` envelope) — not the
  empty global `/.well-known/jwks.json`. So `MYTHOS_LISTING_ID` **must** be the real
  listing UUID assigned when Pluck is registered on that Mythos instance (a fake id is
  rejected as "not a valid UUID v4").
- Launch from that Mythos instance's marketplace (not the mock's `/open/pluck`); the listing's
  configured launch URL must point at this server's `/dashboard` (e.g. `http://localhost:8000/dashboard`
  for local testing).
- Wallet-balance display needs the platform's wallet endpoint; if it isn't exposed to producers
  the balance simply shows blank (downloads still meter normally).

## Env

Same variables as the Python app: `PORT`, `MYTHOS_API_URL`, `MYTHOS_LISTING_ID`, `MYTHOS_ISSUER`, `MYTHOS_ENV`,
`SESSION_SECRET` (**required** when `MYTHOS_ENV=production`), `CREDITS_PER_DOWNLOAD`,
`PLUCK_DB`, `PLUCK_DL_DIR`, `PLUCK_MAX_WORKERS`, `PLUCK_JOB_TTL`, `PLAYLIST_CAP`,
`PLUCK_FRAGMENTS`, `PLUCK_WHISPER_MODEL`, `PLUCK_DEMUCS_MODEL` — plus Node-specific
`PLUCK_YTDLP`, `PLUCK_PYTHON`, `FFMPEG_PATH`.
