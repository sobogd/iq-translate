export type PlanId = "STARTER" | "PRO" | "ULTIMATE";

export type Plan = {
  id: PlanId;
  name: string;
  priceMonthly: number; // USD
  charsPerMonth: number; // text-translation quota, characters
  minutesPerMonth: number; // voice (speech-to-text) quota, minutes
  imagesPerMonth: number; // photo translation quota, images
  maxCharsPerRequest: number;
  popular?: boolean;
};

// Quotas are unchanged by the move off the hosted API: they were sized off
// Gemini 3.5 Flash-Lite unit costs (text in $0.30/M tok, out $2.50/M tok,
// audio in $1.00/M tok @ 32 tok/s — ~$1.3 per 1M translated characters,
// ~$0.0025 per STT minute) so that a fully drained plan costs <= 1/3 of its
// price. Translation now runs on the owner's own machine and speech
// recognition with it, so those quotas no longer price a bill — they are what
// keeps one visitor from taking the whole engine, which has four slots for
// everybody (see docs/local-llm.md). A dictated message is still charged
// twice, both legs inside /api/translate-voice: its seconds for the STT, then
// its characters for the translation of the resulting transcript.
//
// Three things the naive per-request estimate misses, all bounded in code
// rather than left open-ended:
//   - the reply is not charged at all, so an input that makes the model emit
//     as much as it can is pure wall-clock loss (maxOutputTokens in
//     lib/llm-limits.ts caps it);
//   - the recent-turns context is resent with every request and is not
//     charged either (CONTEXT_MAX_CHARS caps it);
//   - a request longer than one engine call is split, so the minutes a PRO
//     request can occupy the engine grow with its character count
//     (CHUNK_CHARS in lib/llm-limits.ts sets the step).
//
// Image translation is billed per PHOTO, not per character (the OCR leg is
// self-hosted and near-free; see services/ocr). The per-image ceiling is
// enforced in /api/translate-image by refusing to send more than
// MAX_IMAGE_TEXT_CHARS to the model — one image can then never occupy the
// engine for longer than that text takes, whatever a screenshot contains.
export const PLANS: Record<PlanId, Plan> = {
  STARTER: {
    id: "STARTER",
    name: "Starter",
    priceMonthly: 9.9,
    charsPerMonth: 1_500_000,
    minutesPerMonth: 250,
    imagesPerMonth: 400,
    maxCharsPerRequest: 30000,
  },
  PRO: {
    id: "PRO",
    name: "Pro",
    priceMonthly: 19.9,
    charsPerMonth: 3_000_000,
    minutesPerMonth: 600,
    imagesPerMonth: 700,
    maxCharsPerRequest: 100000,
    popular: true,
  },
  ULTIMATE: {
    id: "ULTIMATE",
    name: "Ultimate",
    priceMonthly: 49.9,
    charsPerMonth: 8_000_000,
    minutesPerMonth: 1500,
    imagesPerMonth: 1500,
    maxCharsPerRequest: 150000,
  },
};

export const PLAN_ORDER: PlanId[] = ["STARTER", "PRO", "ULTIMATE"];

/** Size ranking used to tell an upgrade from a downgrade (0 = no plan).
 *  A change of plan grants the new allowance outright only when it is an
 *  upgrade; granting it on every change turned PRO -> STARTER -> PRO in the
 *  billing portal into a repeatable free quota refill. */
export function planRank(plan: PlanId | "FREE" | string): number {
  const index = PLAN_ORDER.indexOf(plan as PlanId);
  return index === -1 ? 0 : index + 1;
}

// The free tier is the product without a subscription — anonymous fingerprint
// or signed-in account alike. Lifetime (not renewing) trial pool, kept small
// enough that a visitor cannot tie up the engine for long: lots of short
// messages is the pattern the pool allows, and each one pays the ~100-token
// fixed prompt overhead (lib/translate.ts's instruction text) on top of its
// own content, which is what the character count alone does not show.
export const FREE_TRIAL = {
  chars: 500,
  seconds: 30,
  images: 10,
  maxCharsPerRequest: 500,
};

// The same lifetime pool for a signed-in account that has never subscribed.
// Deliberately larger than the anonymous one: signing in with Google is the
// conversion step worth rewarding, and a Google account is a far higher bar
// to farm than a rotated User-Agent (which is all it takes to mint a fresh
// anonymous fingerprint — see computeFingerprint in lib/auth.ts).
// These MUST match the column defaults of the Account model in
// prisma/schema.prisma, which is where a new account actually gets them.
export const FREE_ACCOUNT = {
  chars: 4000,
  seconds: 120,
  // Photos stay at the anonymous count: OCR is free but a single dense image
  // still costs more than 500 chars of text, so the same ~$0.02/person budget
  // allows no more photos than the anonymous pool does.
  images: 10,
};

// Refill period for an active subscription when Stripe has not told us when
// the paid period actually ends. The real value comes from the subscription
// item's current_period_end, so this is only the fallback; a flat 30 days
// drifts against a calendar month and hands out ~12.2 refills per 12
// payments a year.
export const FALLBACK_PERIOD_MS = 30 * 86_400_000;
