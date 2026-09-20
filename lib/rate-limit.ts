// Fixed-window limiter shared by the endpoints that cost money to serve.
//
// Quotas bound how MUCH a visitor can translate; they bound nothing about how
// fast or how many at a time, so the free 500-character pool could be spent as
// 500 one-character requests, each paying the fixed prompt overhead again, and
// nothing stopped an account from holding hundreds of model calls open at
// once — and the engine has four slots for the whole site. This is the missing
// "how often" half.
//
// In memory on purpose: the app runs as a single pm2 process (see
// nginx/translator.conf — one upstream on :8200). A cluster deployment would
// need a shared store; there is a single sweep and no dependency here instead.

interface Window {
  count: number;
  resetAt: number;
}

export interface Rule {
  /** Short spike allowance. */
  burst: number;
  burstMs: number;
  /** Longer-run allowance. */
  sustained: number;
  sustainedMs: number;
}

export const RULES = {
  // A person types one message at a time; the burst covers a retry plus the
  // voice leg landing next to a text one.
  translate: { burst: 5, burstMs: 10_000, sustained: 60, sustainedMs: 300_000 },
  // Topics are free to create and were unlimited — the cheapest way to grow
  // the database from the outside.
  topic: { burst: 5, burstMs: 10_000, sustained: 40, sustainedMs: 3_600_000 },
  // One solve per 30-minute pass in normal use.
  turnstile: { burst: 5, burstMs: 10_000, sustained: 40, sustainedMs: 600_000 },
  // Several Stripe API round trips per call.
  checkout: { burst: 3, burstMs: 10_000, sustained: 20, sustainedMs: 3_600_000 },
  // The header polls this every 10s per open tab; a few tabs are normal.
  quota: { burst: 8, burstMs: 5_000, sustained: 200, sustainedMs: 600_000 },
  // Same shape as the iq-rest throttle on the analytics ingest route.
  ingest: { burst: 10, burstMs: 1_000, sustained: 200, sustainedMs: 60_000 },
} satisfies Record<string, Rule>;

export type RuleName = keyof typeof RULES;

const windows = new Map<string, Window>();
/** Sweep threshold — the map only ever holds live windows plus whatever expired
 *  since the last write, and the sweep is O(size) at most once per 1000 hits. */
const SWEEP_EVERY = 1000;
let writes = 0;

function hit(key: string, limit: number, windowMs: number, now: number): boolean {
  const w = windows.get(key);
  if (!w || w.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  w.count += 1;
  return w.count <= limit;
}

function sweep(now: number): void {
  if (++writes < SWEEP_EVERY) return;
  writes = 0;
  for (const [key, w] of windows) if (w.resetAt <= now) windows.delete(key);
}

/** False when `client` is over either window of `rule`. Both windows are
 *  always counted, so being over one does not hide usage from the other. */
export function allowRequest(rule: RuleName, client: string, now = Date.now()): boolean {
  const r = RULES[rule];
  sweep(now);
  const burst = hit(`${rule}:b|${client}`, r.burst, r.burstMs, now);
  const sustained = hit(`${rule}:s|${client}`, r.sustained, r.sustainedMs, now);
  return burst && sustained;
}
