// Fixed-window limiter shared by the endpoints that occupy the translation
// engine.
//
// Everything is free and unmetered, so this is the only wall against one caller
// holding hundreds of model calls open at once — and the engine has four slots
// for the whole site. It bounds how OFTEN, never how much.
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
  // Opening a pair's history row is cheap, but it is still a write.
  topic: { burst: 5, burstMs: 10_000, sustained: 40, sustainedMs: 3_600_000 },
  // One solve per 30-minute pass in normal use.
  turnstile: { burst: 5, burstMs: 10_000, sustained: 40, sustainedMs: 600_000 },
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
