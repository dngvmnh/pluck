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
| Playlist (per matched video) | `playlist-N` | 2 each |
| AI transcript (Tier 1) | `transcribe` | +8 |
| Stems (Tier 1) | `stems` | +15 |

`/api/download` sums the chosen options into the credit charge — see `cost_for()` in `server.py`.

## Tier 0 — ✅ shipped (yt-dlp / ffmpeg native)
- **Trim on download** — start/end → clip (downloads then cuts locally with stream copy).
- **Multi-threaded speed** — `concurrent_fragment_downloads=8` (also speeds 4K/8K).
- **4K / 8K** — full ladder; ffmpeg multiplexing.
- **Subtitles** — `.srt` written + embedded (when the source has them).
- **Music mode** — MP3 + ID3 tags + embedded album art + loudness normalize.
- **SponsorBlock** — cut sponsor / intro / outro / self-promo segments.
- **Bulk playlist + smart filter** — paste a playlist/channel; filter by min-minutes / title keyword;
  downloads the batch (capped) and delivers a `.zip`.

All exposed via the **Advanced ▾** panel + a **playlist** view, with a live credit cost.

## Tier 1 — planned (free, but heavy compute / big deps)
- **AI transcription / subtitles** — `faster-whisper` (tiny/base, CPU). Slow; flag-gated; metered high.
- **Audio denoise / remaster** — ffmpeg `afftdn`, `dynaudnorm`, `highpass/lowpass`.
- **Stem separation** — `demucs` (vocals / drums / instrumental); minutes per song on CPU.
- **Format convert / clip → GIF / chapter-split / paste-many-URLs** — small ffmpeg + loop additions.

## Tier 2 — paid infrastructure (planned, not built)
- **Auto-subscriptions / feed auto-download** — APScheduler/Celery worker + persistent DB
  (subscriptions, seen video IDs); downloads new uploads headless into the user's cloud.
- **Cloud delivery (Drive / Dropbox / S3)** — per-provider OAuth + paid storage + signed links.
- **Scale** — GPU nodes for Whisper/Demucs; high-throughput multi-region workers; CDN.

## Won't build — circumvention (out of scope)
Residential-proxy IP-block evasion, **geoblock bypass**, and **age-restriction / login bypass**. These
defeat access controls (geo / age / auth / anti-bot) — DMCA §1201 / CFAA / ToS territory. Pluck only
processes content the Consumer can already reach.
