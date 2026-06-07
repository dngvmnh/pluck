# Pluck

A clean, **YouTube-styled** front-end over [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) — paste a link,
pick a quality, download. FastAPI backend, vanilla JS front-end, dark YouTube look.

![home](./screenshots/pluck-02-authenticated.png)

## Mythos Producer mode (metered auth + payment)
Pluck is also wired to the **Mythos SDK** (`mythos-sdk`), making it a working
**Mythos Producer**: a Consumer launches it from Mythos (launch-token **auth**), and each download spends
credits from their Mythos wallet (**payment** via `report_usage`). Config is in `server.py`
(`MYTHOS_API_URL`, `MYTHOS_LISTING_ID`, `CREDITS_PER_DOWNLOAD`).

Run the metered demo (needs the mock Mythos backend):
```bash
(cd ../Mythos/mythos-sdk-demo/mock-mythos-backend && npm install && npm start)   # :4000
python server.py                                                                  # :8000
# open http://localhost:4000  ->  "Open Pluck"  (mints a launch token, redirects in)
```

Verify auth & payment:
| Check | Expected |
|---|---|
| open `:8000` directly (no launch) | "Launch from Mythos" — denied |
| launch via `:4000/open/pluck` | authenticated (`/api/session` → user + balance) |
| re-open the same `?lt=` token | 401 — single-use (`/consume` 409) |
| tampered / expired token | 401 |
| download a video | wallet debited (mock logs `meter … -2 (video-download)`) |
| download with too few credits | 402 "Out of credits" → **Top up** |

![authed](./screenshots/pluck-02-authenticated.png)

## Scope (please read)
Pluck downloads content you're **authorized** to download — your own uploads, public /
Creative-Commons, or platform-permitted videos — across the 1000+ sites yt-dlp supports.
It does **not** circumvent DRM, logins/paywalls, or anti-bot protection (yt-dlp doesn't either, and
circumventing DRM specifically runs into DMCA §1201). DRM-protected / paywalled streams won't work.

## How it works
- **Metadata:** `yt-dlp` `extract_info` → title, channel, duration, thumbnail, and a curated quality ladder.
- **Download:** a background job runs yt-dlp with the chosen format; separate video+audio streams are
  merged by **ffmpeg** (bundled via `imageio-ffmpeg`, no system install needed).
- **Full YouTube formats** use a JS runtime (`deno`, installed to `~/.deno`).
- Progress is polled from `GET /api/jobs/{id}`; the finished file is served by `GET /api/file/{id}`.

## Premium features (metered via Mythos)
Each premium option adds Mythos credits (insufficient → 402 → Top up), exposed via the **Advanced ▾**
panel + a **playlist** view with a live credit cost. Full tiered plan: [`docs/roadmap.md`](./docs/roadmap.md).

| Feature | What it does | + credits |
|---|---|---|
| Trim | download just `start–end` (a clip) | +1 |
| 4K / 8K | guaranteed hi-res multiplexing | +2 / +4 |
| Subtitles | `.srt` written + embedded | +1 |
| Music mode | MP3 + ID3 tags + album art + loudness | +1 |
| SponsorBlock | cut sponsor / intro / outro segments | +1 |
| Bulk playlist + filter | playlist/channel → filter (min-mins / keyword) → `.zip` | 2 / video |
| Multi-threaded speed | parallel fragments | free |

| Advanced options | Bulk playlist + filter |
|---|---|
| ![adv](./screenshots/pluck-adv-options.png) | ![playlist](./screenshots/pluck-playlist.png) |

## Run (standalone — no Mythos)
```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
# one-time, for full YouTube format extraction:
curl -fsSL https://deno.land/install.sh | sh -s -- -y
python -m uvicorn server:app --host 127.0.0.1 --port 8000 --reload
```
Open `http://localhost:8000`. Without Mythos running, the auth gate is unenforced — useful for
rapid UI iteration. For the full auth + payment flow, use the Mythos mock below.

## Local development with Mythos mock (full auth + payment)

Pluck's auth and payment only activate when a mock Mythos backend issues the launch token.
Run both services, then **enter via Mythos** — not by opening Pluck directly.

**Terminal 1 — mock Mythos (port 4000)**
```bash
cd Mythos/mythos-sdk-demo/mock-mythos-backend
npm install            # first time only
node server.mjs
# → Mock Mythos listening on http://localhost:4000
```

**Terminal 2 — Pluck (port 8000)**
```bash
cd pluck
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pip install -e vendor/packages/python   # vendored Mythos Python SDK (not on PyPI yet)
python -m uvicorn server:app --host 127.0.0.1 --port 8000 --reload
```

**Browser — enter via Mythos**
```
http://localhost:4000/open/pluck
```
Mythos mints a single-use RS256 launch token and redirects to
`http://localhost:8000/dashboard?lt=<jwt>`. You land on the Pluck dashboard as
**Linus Pauling** (`linus@consumer.example`) with **10 credits**.

> Opening `localhost:8000` directly (no `?lt=`) shows "Launch from Mythos" and all API calls
> return **401** — the auth gate is working correctly.

### Verify auth & payment
| Check | Expected |
|---|---|
| `GET /api/session` before launch | 401 |
| After `localhost:4000/open/pluck` | `{"user":"Linus Pauling","balance":10,...}` |
| Re-use same `?lt=` token | 401 — single-use (`/consume` 409 on replay) |
| Tampered / expired token | 401 |
| Download (2 cr base) | balance decrements, mock logs `meter … -2` |
| Trim + music + subs (5 cr extra) | 402 once balance exhausted |
| Click **Top up +10** | balance restored |

### Fault injection (mock-backend test endpoints)
```bash
# Rotate JWKS signing keys — SDK must re-fetch and still verify
curl -X POST http://localhost:4000/__keys/add

# Mint a custom token (expired, wrong aud, etc.) — Pluck must reject it
curl -X POST http://localhost:4000/__mint \
  -H "Content-Type: application/json" \
  -d '{"sub":"user-pluck-001","expOffsetSec":-1}'
# paste the returned token as ?lt=<token> → expect 401

# Top up wallet directly
curl -X POST http://localhost:4000/api/wallet/topup \
  -H "Content-Type: application/json" \
  -d '{"userId":"user-pluck-001","amount":20}'

# Check wallet balance
curl http://localhost:4000/api/wallet/user-pluck-001
```

## API
| Endpoint | Purpose |
|----------|---------|
| `POST /api/info {url}` | metadata + available qualities |
| `POST /api/download {url, choice, start, end, subs, music, sponsorblock, playlist, min_minutes, keyword}` | start a single or playlist job → `{job_id, charged}` |
| `GET /api/jobs/{id}` | job status / progress / speed / filename |
| `GET /api/file/{id}` | download the finished file |

`choice` is `best`, a height (`2160`…`144`), `audio-m4a`, or `audio-mp3`.

## Screenshots
| Result (watch-page) | Download + progress |
|---|---|
| ![result](./screenshots/pluck-03-result.png) | ![download](./screenshots/pluck-04-insufficient.png) |
