# Security & abuse model

Who can spend our money, what stops them, and where each rule lives. Written
after the 2026-09-03 audit; keep it in step with the code.

## Identities

A request is one of three things (`lib/auth.ts`, `resolveIdentity`):

| kind | ownerKey | quotaKey | how it is proven |
| --- | --- | --- | --- |
| account | the Google email | same | opaque session token, sha256-hashed in `sessions` |
| anonymous | `an:<id>` | `fp:<hash>` | random 128-bit cookie minted by `proxy.ts` |
| anonymous, cookies blocked | `fp:<hash>` | `fp:<hash>` | request fingerprint only |

`ownerKey` and `quotaKey` are deliberately different things:

- **ownerKey** decides what you can read and delete. It must not collide, so it
  is a random cookie value.
- **quotaKey** decides which free pool you spend from. It must be hard to
  rotate, so it is `sha256(ip | user-agent | accept-language)` — clearing
  cookies does not buy a second free trial.

They used to be one value (the fingerprint), which meant two people behind one
NAT running the same browser shared each other's conversations.

Sessions expire after 400 days (`SESSION_TTL_MS`); the cookie is refreshed on
every request, so an account in daily use never notices.

## Spending limits

Three independent walls, in the order a request meets them:

1. **Rate** — `lib/rate-limit.ts`, keyed on `quotaKey`. Quotas say how much,
   never how fast; without this the free 500 characters could be spent as 500
   separate model calls, each re-paying the fixed prompt overhead and each
   occupying one of the engine's four slots.
2. **Turnstile** — `lib/turnstile.ts`. Anonymous callers only. One solve buys a
   30-minute pass cookie, HMAC-bound to the request fingerprint with a key
   *derived* from `TS_SECRET`, never `TS_SECRET` itself. The siteverify answer
   is only believed if `success` **and** the reported hostname is ours.
3. **Quota** — `lib/credits.ts`. Atomic conditional decrement, so two
   concurrent requests can never both pass zero. Charged before the model call,
   refunded (`refundChars` / `refundSeconds`) on every path that fails after.

What the quota does *not* charge for is bounded in `lib/llm-limits.ts`
instead: `maxOutputTokens` caps the reply (the input is attacker-supplied, so
"write as much as you can" is a valid instruction to hide in it) and
`CONTEXT_MAX_CHARS` caps the recent-turns block that is resent every request.
The same module keeps a single request inside the model's context window — one
over-long prompt is a rejected request, not a slow one.

Audio is measured from the WAV container, never from the byte count
(`lib/wav.ts`), and the mime type handed to the speech engine is ours, not the
uploader's: a small Opus file declaring itself `audio/ogg` used to be charged
three seconds while carrying ten minutes of speech.

## Billing

`plan` on an account means nothing on its own — `entitledPlan()` requires
`subscriptionStatus === "ACTIVE"`, so a subscription in `past_due` or `unpaid`
stops refilling immediately instead of collecting a fresh month until Stripe
gives up on it.

The webhook (`app/api/stripe/webhook/route.ts`) holds three rules worth knowing:

- **The plan comes from the Price's metadata**, not the subscription's. A
  subscription's metadata is written once at checkout and is not updated when
  the customer switches plan in the billing portal.
- **One grant per (plan, paid period)**, tracked by `grantedPlan` /
  `grantedPeriodEnd`. Granting on every plan change made PRO → STARTER → PRO a
  repeatable free refill, since Stripe credits the downgrade back.
- **The `stripe_events` row is a lock taken before the work and released if the
  work fails.** Written afterwards, a crashed handler marked the event as done
  and Stripe's retry silently no-op'd — a paid plan lost for good.

Cancelling zeroes the balances: the free tier never refills, so it never
overwrote them either, and one paid month of ULTIMATE stayed spendable forever.

Checkout refuses to start a second subscription for a customer who already has
a live one and sends them to the billing portal instead.

## Trust boundaries

- `X-Forwarded-Host` is **not** set by nginx, so it is caller-controlled.
  `getOrigin()` only honours it when it names this site or a dev host;
  everything else falls back to `SITE_URL`. It feeds the OAuth `redirect_uri`
  and Stripe's return URLs.
- `cf-ipcountry` and friends **are** overwritten by nginx (`proxy_set_header`),
  so they cannot be spoofed.
- Every API error is an opaque code; the client maps it to translated copy and
  falls back to `errors.generic`. Raw exception messages stay in the server log.
- Cross-site writes are refused in `proxy.ts` when the browser sends an
  `Origin` that is not ours. Callers that send no `Origin` (Stripe's webhook)
  authenticate by signature instead.

## Known gaps

- **No Content-Security-Policy.** The page loads Turnstile and redirects into
  Stripe; a wrong policy breaks checkout silently. Needs its own pass with the
  full origin list.
- **The limiter is in-process memory.** Correct for one pm2 process, which is
  what runs today; a cluster deployment needs a shared store.
- `/api/e` accepts events from anyone, so admin traffic numbers can be padded.
  Nothing reads back and nothing is exposed by it.
