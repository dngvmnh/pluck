# Pluck premium roadmap

Pluck is a **Mythos Producer**, so premium features monetize for free: each action calls
`report_usage(jti, credits, reason)` and Mythos debits the Consumer's wallet (insufficient → 402 → Top
up). Heavier features just cost more credits. Ordered easy → hard.

## Monetization (credits via Mythos)
| Action | `reason` | credits |
|---|---|---|
| Standard download | `download` | 2 |
| + Trim to clip | `trim` | +1 |
| 4K / 8K | `4k` / `8k` | +2 / +4 |
| Subtitles | `subtitles` | +1 |
| Music mode | `music` | +1 |
| SponsorBlock | `sponsorblock` | +1 |
| Clip → GIF | `gif` | +3 |
| Format convert | `convert` | +1 |
| Chapter split | `chapters` | +2 |
| Audio remaster | `remaster` | +2 |
| AI transcript (Whisper) | `transcribe` | +8 |
| Stems (Demucs) | `stems` | +15 |
| Playlist (per matched video) | `playlist-N` | 2 each |
| Multi-URL (per link) | `download` ×N | 2 each |

`/api/download` sums the chosen options into the credit charge — the single source of truth is
`cost_for()` / `PRICING` in `pluck/pricing.py`, also served at `GET /api/pricing` for the live client estimate.

## Tier 0 — ✅ shipped (yt-dlp / ffmpeg native)
- **Trim on download** — start/end → clip (downloads then cuts locally with stream copy).
- **Multi-threaded speed** — `concurrent_fragment_downloads=8` (also speeds 4K/8K).
- **4K / 8K** — full ladder; ffmpeg multiplexing.
- **Subtitles** — `.srt` written + embedded (when the source has them).
- **Music mode** — MP3 + ID3 tags + embedded album art + loudness normalize.
- **SponsorBlock** — cut sponsor / intro / outro / self-promo segments.
- **Bulk playlist + smart filter** — paste a playlist/channel; filter by min-minutes / title keyword;
  downloads the batch (capped) and delivers a `.zip`.

All exposed via an **output-mode** selector + an **Options** panel + a **playlist** view, with a live credit cost.

## Tier 1 — ✅ shipped
- **Clip → GIF** — palettegen/paletteuse two-pass, configurable fps/width, 30s cap (`pipelines/gif.py`).
- **Format convert** — remux (stream-copy) or transcode to mp4/mkv/webm/mp3/m4a/opus/wav/flac (`pipelines/convert.py`).
- **Chapter split** — split by the video's chapters → `.zip` (`pipelines/chapters.py`).
- **Audio remaster / denoise** — ffmpeg `afftdn` + `dynaudnorm` + band-pass (`pipelines/remaster.py`).
- **Multi-URL grab** — paste many links → one charged job each (`routes/download.py` fan-out).
- **Persistent jobs + Library** — SQLite-backed history that survives restarts (`db.py`, `jobs.py`).

### Tier 1 — optional (heavy deps; install `requirements-ml.txt`)
- **AI transcription** — `faster-whisper` (base, CPU int8) → `.srt` + `.txt` (`pipelines/transcribe.py`). Capability-gated.
- **Stem separation** — `demucs` → vocals / drums / bass / other → `.zip` (`pipelines/stems.py`). Capability-gated.

## Tier 2 — paid infrastructure (planned, not built)
- **Auto-subscriptions / feed auto-download** — APScheduler/Celery worker + persistent DB
  (subscriptions, seen video IDs); downloads new uploads headless into the user's cloud.
- **Cloud delivery (Drive / Dropbox / S3)** — per-provider OAuth + paid storage + signed links.
- **Scale** — GPU nodes for Whisper/Demucs; high-throughput multi-region workers; CDN.

## Won't build — circumvention (out of scope)
Residential-proxy IP-block evasion, **geoblock bypass**, and **age-restriction / login bypass**. These
defeat access controls (geo / age / auth / anti-bot) — DMCA §1201 / CFAA / ToS territory. Pluck only
processes content the Consumer can already reach.
