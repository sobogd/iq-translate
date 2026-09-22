# Analytics (cookieless)

This app no longer stores analytics itself. It resolves who is asking and
relays the event batch to **iq-metrix**, a standalone ingest service (separate
repo, not part of this app) that owns hashing, visit resolution and storage.
Nothing is stored on the visitor's device either way, so the site still needs
no cookie banner — that claim is made in the privacy policy
(`app/_landing/legal-content.ts`, sections 2, 5, 6 and 10).

The pipeline used to do the hashing/visit-resolution locally (salted device
hash, `sessions_new`/`events_new` tables, an admin UI). That version is gone;
see git history on this file and on `lib/analytics/*` for how it worked. The
physical `analytics_salt` / `sessions_new` / `events_new` tables are still on
the database as a safety net (Prisma just stopped tracking them — no
migration dropped them), but nothing here writes to them anymore.

## How it works now

1. The client (`lib/analytics.ts`, unchanged) batches `page`/`action`/`name`
   events and POSTs them to `/api/e` as `text/plain` (CORS-simple, so
   `navigator.sendBeacon` can carry it during page teardown).
2. `app/api/e/route.ts` validates the batch, runs the hard bot/UA filter, and
   resolves identity via `lib/analytics/identity.ts` (unchanged — this is the
   one piece iq-metrix cannot do itself, since it has no access to this app's
   sessions/email).
3. The route builds a payload (site, raw ip/ua/headers, email, meta, events)
   and forwards it to iq-metrix over `lib/analytics/ingest.ts`.
4. iq-metrix responds with `{ tok? }`; the route passes that straight back as
   `{ v: tok }`, the shape the client already expects, so its token-caching
   keeps working unchanged.

`lib/analytics/server-event.ts` (`trackServerEvent`) follows the same path for
the one event the client cannot fire truthfully — Google sign-in/registration,
recorded from `app/api/auth/google/callback/route.ts` after the token
exchange.

## Forwarding + spool (`lib/analytics/ingest.ts`)

- One POST to `http://127.0.0.1:8205/ingest` (iq-metrix, same box) per batch,
  with header `X-Ingest-Key` set to `INGEST_SHARED_SECRET`, bounded by a
  **250ms timeout**.
- On failure or timeout the payload is appended as one NDJSON line to
  `var/spool/analytics-events.ndjson` and the route still answers the client
  with a clean 200 (no `tok` — the client just re-resolves fresh next batch,
  which is not an error). The request is never failed by an iq-metrix outage.
- A `setInterval` registered once at module load (every 10s — safe because
  this is a long-running pm2 process, not serverless) drains the spool:
  re-POSTs each pending line, keeps only the ones that still fail. Capped at
  500 lines/tick so one slow drain cannot block the next, and at 20MB total —
  past that it logs a warning and starts dropping instead of growing forever.

## Raw request signals

`lib/analytics/ingest.ts` reads exactly what the old `request-facts.ts` used
to, but forwards it instead of hashing it:

- `ip` — first hop of `x-forwarded-for`, falling back to `x-real-ip`.
- `ua` — the raw `user-agent` header.
- `headers` — `accept-language` plus the geo headers nginx's `ngx_http_geoip2`
  module injects in prod: `cf-ipcountry` / `cf-region` / `cf-ipcity`
  (Cloudflare's header names, kept identical to iq-rest's so the code matches
  across both — see `nginx/translator.conf`). Locally there is no nginx, so
  geo is simply absent.

## Event shape

`page` / `action` / `name` — short English labels, free-form, validated
server-side against a tight character set before forwarding. **Names must not
vary by language**, or one funnel becomes thirty: locale-stable route keys and
language codes, never a translated label. `locale` rides along per event.

`meta.topicId` is the batch's active conversation: the last event carrying a
`tid` (validated as owned by the caller via `identity.ts#resolveTopicId`),
i.e. whatever conversation is open right now. `meta.from`/`ref`/`theme` come
from the batch's `ctx`, validated the same way the old pipeline did.

Pages: `Home`, `Pair`, `Pricing`, `Legal`, `Auth` (server-side only).

## Sections

The scroll tracker names each scroll after the section the page settled on. A
section is any element with `data-section` — set it through `<Band section="…">`
(`app/_landing/shell.tsx`) and give the token a label in `lib/track-sections.ts`,
otherwise the timeline reads like a database dump.

## Env

| Variable | Effect |
| --- | --- |
| `INGEST_SHARED_SECRET` | `X-Ingest-Key` sent with every forward to iq-metrix |
| `ANALYTICS_ADMIN_EMAILS` | No admin UI reads this any more (the local admin screens were deleted with the old quota pipeline); `isAnalyticsAdmin` still reads it from the analytics identity module |
| `ANALYTICS_EXCLUDE_EMAILS` | Accounts whose traffic is never forwarded (default `support@iq-rest.com`) |
| `NEXT_PUBLIC_ANALYTICS_DEV` | `1` makes the client send from `next dev` instead of logging to the console |

`ANALYTICS_TOKEN_SECRET` is no longer read anywhere in this app (it signed the
old local visit-continuation token) — safe to drop once nothing else expects
it.

## Admin UI

Deleted along with the local pipeline: `app/_landing/AdminTraffic.tsx`,
`app/_landing/traffic-shared.ts`, `app/api/admin/sessions*`,
`lib/analytics/admin-guard.ts`. Whatever traffic-browsing surface comes next
lives in iq-metrix, not here.
