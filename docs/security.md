# Security & abuse model

Who can spend our money, what stops them, and where each rule lives. Written
after the 2026-09-03 audit, rewritten when the service became free, anonymous
and account-optional; keep it in step with the code.

## Identities

A request is one of two things (`lib/auth.ts`, `resolveIdentity`):

| kind | ownerKey | rateKey | how it is proven |
| --- | --- | --- | --- |
| account | the verified email | same | opaque session token, sha256-hashed in `sessions` |
| anonymous | `an:<id>` | same | random 128-bit cookie minted by `proxy.ts` |

`ownerKey` decides what you can read and delete — it owns `conversations` and
their `translations`. It is always either a verified email or a random cookie
value, never anything derived from the request. There is deliberately **no
fingerprint fallback**: a caller with no id cookie owns nothing and gets a 401;
reloading the page mints a fresh cookie through `proxy.ts`.

Before the service became free, anonymous callers also had a separate
`quotaKey` — `sha256(ip | user-agent | accept-language)` — so clearing cookies
did not buy a second free trial. That is gone with the quotas: there is nothing
left to ration, and the stored fingerprint was the least defensible piece of
personal data the app held. `computeFingerprint` survives only inside
`lib/turnstile.ts`, where it is used transiently to bind a pass cookie and is
never written down.

Sessions expire after 400 days (`SESSION_TTL_MS`); the cookie is refreshed on
every request, so an account in daily use never notices.

## Sign-in and history merge

Email OTP, Google and Apple all end in the same place: a row in `sessions` and
the session cookie. `establishSession` (OTP, Apple) and the Google callback
then call `mergeAnonymousHistory` (`lib/merge-conversations.ts`): the anonymous
history of the browser that signed in is re-keyed to the email, and a language
pair the account already had is merged turn-by-turn so nothing is split or
lost. The merge is best-effort — a failure logs and the sign-in still succeeds.

## Abuse protection

Everything is free and unmetered, so the only two walls left are:

1. **Rate** — `lib/rate-limit.ts`, keyed on `identity.rateKey`. Bounds how
   often, never how much. Without it, one caller could hold all four of the
   engine's slots open; there is no quota behind it any more.
2. **Turnstile** — `lib/turnstile.ts`. Anonymous callers only; a signed-in
   account is already a verified identity. One solve buys a 30-minute pass
   cookie, HMAC-bound to the request fingerprint with a key *derived* from
   `TS_SECRET`, never `TS_SECRET` itself. The siteverify answer is only
   believed if `success` **and** the reported hostname is ours.

Token accounting is bounded in `lib/llm-limits.ts`, not by a plan:
`maxOutputTokens` caps the reply (the input is attacker-supplied, so "write as
much as you can" is a valid instruction to hide in it) and `CONTEXT_MAX_CHARS`
caps the recent-turns block resent on every request. Those limits come from the
local model's context window, not from a customer's balance.

Audio is measured from the WAV container, never from the byte count
(`lib/wav.ts`), and the mime type handed to the speech engine is ours, not the
uploader's: a small Opus file declaring itself `audio/ogg` used to be charged
three seconds while carrying ten minutes of speech. (The seconds were a quota
unit then; the container-vs-bytes rule still matters because it decides how much
audio we hand the engine.)

## Retention

There is no account deletion flow required to bound the data: `maybePrune`
(`lib/maintenance.ts`) deletes translations older than **one year** and any
conversation left empty by that, and expired sessions. It rides along with the
history-read endpoint rather than needing a cron.

## Trust boundaries

- `X-Forwarded-Host` is **not** set by nginx, so it is caller-controlled.
  `getOrigin()` only honours it when it names this site or a dev host;
  everything else falls back to `SITE_URL`. It feeds the OAuth `redirect_uri`.
- `cf-ipcountry` and friends **are** overwritten by nginx (`proxy_set_header`),
  so they cannot be spoofed.
- Every API error is an opaque code; the client maps it to translated copy and
  falls back to `errors.generic`. Raw exception messages stay in the server log.
- Cross-site writes are refused in `proxy.ts` when the browser sends an
  `Origin` that is not ours. Sign in with Apple's `form_post` callback is the
  one exempt path (CSRF is covered by the oauth state cookie).
- Conversation and translation rows are only ever reachable by the `ownerKey`
  that created them; the `/api/conversation/[id]` handlers re-check it on every
  request.

## Known gaps

- **No Content-Security-Policy.** The page loads Turnstile and redirects into
  Google/Apple sign-in; a wrong policy breaks those silently. Needs its own
  pass with the full origin list.
- **The limiter is in-process memory.** Correct for one pm2 process, which is
  what runs today; a cluster deployment needs a shared store.
- `/api/e` accepts events from anyone, so admin traffic numbers can be padded.
  Nothing reads back and nothing is exposed by it.
