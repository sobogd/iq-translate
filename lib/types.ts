export type Lang = string; // ISO 639-1 code

export interface Topic {
  id: string;
  title: string | null;
  sourceLang: string | null;
  targetLang: string;
  /** Half of the pair the visitor is writing in right now, flipped by the swap
   *  button; null on rows from before that column existed (= sourceLang). */
  writeLang?: string | null;
  lastUsedAt: string;
  createdAt: string;
  translationCount?: number;
}

export interface HistoryRow {
  id: string;
  sourceLang: string;
  transcript: string;
  translation: string;
  /** Photo translation: relative URL of the composed result image. */
  imageUrl?: string | null;
  createdAt: string;
}

export interface TopicDetail extends Topic {
  translations: HistoryRow[];
}

// Remaining free/plan quota for the current visitor, as returned by
// GET /api/quota. Anonymous visitors are keyed by request fingerprint, signed-in
// ones by their account email (see lib/credits.ts).
export interface Quota {
  kind: "anonymous" | "account";
  email?: string;
  plan: string;
  planName?: string | null;
  /** Raw subscription state ("ACTIVE" | "PAST_DUE" | ...). `plan` above is the
   *  ENTITLED plan, which reads FREE while a payment is failing. */
  subscriptionStatus?: string;
  chars: number;
  seconds: number;
  /** Photo translations left (per-image quota, not characters). */
  images?: number;
  /** Opens the admin traffic screens in the account modal. Server-decided
   *  (ANALYTICS_ADMIN_EMAILS) — the endpoints re-check it, this only paints
   *  the button. */
  isAdmin?: boolean;
}
