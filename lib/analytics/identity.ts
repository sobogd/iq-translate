import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE, hashSessionToken, parseCookie } from "@/lib/auth";
import type { HeaderReader } from "./ingest";

// Who is behind an ingest call, and which conversation they had open.
//
// This is attribution, not authorisation: a bad cookie can only mis-attribute
// the caller's own events, never expose anything. Exclusion decisions are
// therefore taken on the DB-resolved email, never on a client-writable value.
//
// Ported from iq-rest (apps/dashboard-api/src/analytics-v2/identity.service.ts),
// minus the admin-impersonation branch (this app has no impersonation).

const TOKEN_TTL_MS = 5 * 60_000;
const TOPIC_TTL_MS = 5 * 60_000;
const MAX_ENTRIES = 5_000;

export interface VisitIdentity {
  /** null = anonymous. */
  email: string | null;
  /** True when the call must be discarded entirely (internal account). */
  skip: boolean;
}

interface CacheEntry<T> {
  value: T;
  exp: number;
}

const tokens = new Map<string, CacheEntry<string | null>>();
const topics = new Map<string, CacheEntry<boolean>>();

function get<T>(map: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const hit = map.get(key);
  if (!hit) return undefined;
  if (hit.exp <= Date.now()) {
    map.delete(key);
    return undefined;
  }
  return hit.value;
}

function put<T>(map: Map<string, CacheEntry<T>>, key: string, value: T, ttl: number): void {
  // Plain size cap — the maps hold at most a few thousand short strings and a
  // stale drop only costs one extra query.
  if (map.size >= MAX_ENTRIES) map.clear();
  map.set(key, { value, exp: Date.now() + ttl });
}

function emailList(raw: string | undefined, fallback: string): Set<string> {
  return new Set(
    (raw || fallback)
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Accounts whose own traffic must never be recorded. Empty by default —
 *  was "support@iq-rest.com" — every account, including internal ones, is
 *  now tracked unless ANALYTICS_EXCLUDE_EMAILS is explicitly set. */
function excludedEmails(): Set<string> {
  return emailList(process.env.ANALYTICS_EXCLUDE_EMAILS, "");
}

/** Accounts allowed to open the admin traffic screens. */
export function isAnalyticsAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return emailList(process.env.ANALYTICS_ADMIN_EMAILS, "support@iq-rest.com").has(
    email.trim().toLowerCase(),
  );
}

/** Email behind a raw session token, memoised. Mirrors lib/auth.ts's own
 *  verification (hashed token + expiry), without its per-request DB hit. */
async function emailForToken(token: string): Promise<string | null> {
  const tokenHash = hashSessionToken(token);
  const cached = get(tokens, tokenHash);
  if (cached !== undefined) return cached;

  const row = await prisma.session.findUnique({ where: { tokenHash } });
  const email = row && (row.expiresAt === null || row.expiresAt.getTime() > Date.now()) ? row.email : null;
  put(tokens, tokenHash, email, TOKEN_TTL_MS);
  return email;
}

/** Drop a token from the memo the moment its session is destroyed — otherwise
 *  a signed-out visitor keeps being attributed to the account for up to
 *  TOKEN_TTL_MS. Attribution only, but it is one line. */
export function forgetToken(token: string): void {
  tokens.delete(hashSessionToken(token));
}

/** Resolve once per ingest batch, never per event. */
export async function resolveIdentity(h: HeaderReader): Promise<VisitIdentity> {
  const token = parseCookie(h.get("cookie"), SESSION_COOKIE);
  if (!token) return { email: null, skip: false };

  const email = await emailForToken(token);
  if (!email) return { email: null, skip: false };
  if (excludedEmails().has(email.toLowerCase())) return { email: null, skip: true };
  return { email, skip: false };
}

/** Stamp an event with a topic only when the caller actually owns it — the id
 *  arrives from the client, so an unowned one is dropped rather than trusted.
 *  Anonymous visitors have no topics at all. */
export async function resolveTopicId(email: string | null, topicId: string | null): Promise<string | null> {
  if (!email || !topicId) return null;
  const key = `${email}|${topicId}`;
  const cached = get(topics, key);
  if (cached !== undefined) return cached ? topicId : null;

  const row = await prisma.conversation.findFirst({
    where: { id: topicId, ownerKey: email },
    select: { id: true },
  });
  put(topics, key, row !== null, TOPIC_TTL_MS);
  return row ? topicId : null;
}
