# Mythos as a distribution layer

Pluck is a normal web app. **Mythos** is the layer that brings it customers, signs them in, and bills
them — so Pluck never builds accounts, logins, or payments.

## The three roles
| Role | Who | Responsibility |
|------|-----|----------------|
| **Consumer** | the end user | discovers apps on Mythos, holds a Mythos **credit wallet** |
| **Mythos** | the platform | distribution (marketplace) + **identity** (launch tokens) + **billing** (wallet) |
| **Producer** | your app (Pluck) | does the actual work; verifies the launch token and reports usage |

```
 Consumer ──opens app on──▶  Mythos  ──redirects with ?lt=<launch token>──▶  Producer (Pluck)
   ▲  holds credits          (auth + wallet)                                  verify token  → AUTH
   └──────────────── credits debited ◀── reportUsage() ◀──────────────────── meter actions → PAYMENT
```

## What Mythos gives a Producer
- **Distribution** — you're listed in the Mythos marketplace; Consumers launch you with one click.
- **Auth, for free** — each launch carries a short-lived **RS256 launch token** (`?lt=`). You verify it
  with the SDK; you never store passwords or run a login.
- **Metered billing, for free** — you call `reportUsage()` per action and Mythos debits the Consumer's
  wallet. No Stripe, no invoices, no balance tracking on your side.
- **Single-use & anti-replay** — the SDK consumes each launch token exactly once (a platform invariant).

## What the Producer still owns
- The product itself (Pluck: fetch + download video via yt-dlp).
- Its own **session** after the one-time token exchange (a cookie), because launch tokens are single-use.
- Deciding **what costs credits** and how many (Pluck: 2 credits per download).

## The launch → consume → meter flow
1. Consumer clicks "Open Pluck" in Mythos → Mythos mints a launch token and redirects to
   `https://pluck.app/dashboard?lt=<token>`.
2. Pluck's SDK **verifies** the token (RS256 via Mythos' JWKS) and **consumes** it (single-use). Pluck
   stores the session in its own cookie. → **authentication**.
3. Each download calls `reportUsage(jti, credits=2, reason="video-download")` → Mythos debits the
   Consumer's wallet; if empty, the SDK raises `InsufficientFundsError`. → **payment**.

See [`mythos-integration.md`](./mythos-integration.md) for the exact code, and the repo root `README.md`
for how to run the whole thing locally against a mock Mythos backend.
