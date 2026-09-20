// Token accounting for the local model's context window.
//
// The engine is llama.cpp on the owner's Mac (see docs/local-llm.md), and its
// window — not the plan's character quota — is the hard limit on one engine
// call. Every number below is derived from that window instead of being
// hand-tuned against a hosted API, so raising `-c`/`LLM_CTX` moves the whole
// budget with it.
//
// Why estimate tokens from characters instead of counting them: the app has no
// tokenizer for the served model, and a real one would have to be kept in sync
// with whatever GGUF is loaded. `CHARS_PER_TOKEN = 2` is deliberately
// pessimistic on both scripts the product sees most — Cyrillic runs ~2.5
// characters per token and Latin ~4 — so the estimate is never smaller than
// the truth and the window is never overrun.

/** Context window of ONE llama.cpp slot, in tokens. Must match the server's
 *  `-c`/`--ctx-size`: llama.cpp splits its total window between its `-np`
 *  slots, and one request occupies one slot, so this is the per-slot value. */
const LLM_CTX = positiveInt(process.env.LLM_CTX, 32768);

/** Characters per token, rounded down — see the header comment. */
const CHARS_PER_TOKEN = 2;

/** Tokens held back for the system prompt, the pair instruction and the
 *  RECENT TURNS block (~1200 tokens ≈ 2400 characters of context). */
const PROMPT_RESERVE_TOKENS = 1200;

/** Slack for the model adding a sentence of its own: the prompt forbids it,
 *  but a window overrun is a 400 from llama.cpp and a lost request, so a
 *  little room is cheaper than trust. */
const SLACK_TOKENS = 256;

/** How much longer the answer may get than the input, in tokens. Translating
 *  English into Russian grows the token count by ~1.6 (Latin packs ~4
 *  characters per token, Cyrillic ~2.5), and the model occasionally expands a
 *  terse phrase into a full sentence; 2.2 covers both. */
const OUTPUT_GROWTH = 2.2;

/** Characters of the RECENT TURNS block resent with every request. It is not
 *  charged to anyone's quota, but it does occupy the window and the prefill
 *  time, so it is capped and the newest turns are the ones kept. */
export const CONTEXT_MAX_CHARS = 2000;

/** Longest single engine call, in characters of source text. Input plus its
 *  worst-case output plus the prompt must fit the window:
 *  (32768 − 1200 − 256) / 3.2 ≈ 9785 tokens ≈ 19570 characters. */
const MAX_INPUT_CHARS = Math.floor(
  ((LLM_CTX - PROMPT_RESERVE_TOKENS - SLACK_TOKENS) / (1 + OUTPUT_GROWTH)) * CHARS_PER_TOKEN,
);

/** Size of one engine call when a longer text is split, in characters. Half
 *  the window-derived maximum: a smaller call finishes (and starts streaming)
 *  sooner, and the prefill of a full-window call would take a minute on its
 *  own. Overridable with LLM_CHUNK_CHARS, never above MAX_INPUT_CHARS. */
export const CHUNK_CHARS = Math.min(positiveInt(process.env.LLM_CHUNK_CHARS, 8000), MAX_INPUT_CHARS);

/**
 * Tokens the given amount of text is expected to occupy, rounded up.
 *
 * The estimate is a bound, not a measurement: callers use it to decide what
 * fits in the window, so over-counting costs a little unused room while
 * under-counting costs a failed request.
 */
function estimateTokens(chars: number): number {
  return Math.ceil(Math.max(0, chars) / CHARS_PER_TOKEN);
}

/**
 * Output budget for one engine call, in tokens.
 *
 * Takes the larger of "enough for a translation this long" and the room the
 * window has left after the prompt and the input — the one value that must
 * never exceed the slot, since llama.cpp answers a too-large request with a
 * 400 rather than truncating.
 */
export function maxOutputTokens(inputChars: number): number {
  const wanted = Math.ceil(estimateTokens(inputChars) * OUTPUT_GROWTH) + SLACK_TOKENS;
  const available = LLM_CTX - PROMPT_RESERVE_TOKENS - estimateTokens(inputChars) - SLACK_TOKENS;
  return Math.max(64, Math.min(wanted, available));
}

/**
 * Splits `text` into pieces no longer than `limit` characters, cutting at
 * paragraph, line, sentence or word boundaries in that order of preference.
 *
 * Each piece is returned as the exact slice of the original, trailing
 * whitespace included, so translating the pieces independently and joining
 * the answers with "" reproduces the source layout — the caller only has to
 * put back the whitespace the model stripped at the end of an answer.
 */
export function splitIntoChunks(text: string, limit: number = CHUNK_CHARS): string[] {
  if (text.length <= limit) return text.length > 0 ? [text] : [];

  const chunks: string[] = [];
  let current = "";
  for (const unit of units(text)) {
    // A single unit over the budget (a wall of text with no paragraph or line
    // breaks) is cut by sentence, then hard.
    if (unit.length > limit) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      chunks.push(...hardSplit(unit, limit));
      continue;
    }
    if (current.length + unit.length > limit) {
      chunks.push(current);
      current = "";
    }
    current += unit;
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Paragraph-sized units of `text`, each with the whitespace that followed it.
 *
 * Two-level split on purpose: blank lines separate paragraphs, and any single
 * newlines inside one stay inside its unit so a list or a code block is never
 * cut in the middle by the greedy packer above.
 */
function* units(text: string): Generator<string> {
  const parts = text.split(/(\n{2,})/);
  for (let i = 0; i < parts.length; i += 2) {
    const piece = parts[i];
    const after = parts[i + 1] ?? "";
    if (piece.length > 0 || after.length > 0) yield piece + after;
  }
}

/** Last-resort splitter: whole sentences while they fit, then a hard cut at
 *  `limit`, preferring a space so words stay intact. */
function hardSplit(text: string, limit: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    const cut = Math.max(
      window.lastIndexOf(". "),
      window.lastIndexOf("! "),
      window.lastIndexOf("? "),
      window.lastIndexOf("\n"),
      window.lastIndexOf(" "),
    );
    const at = cut > limit / 2 ? cut + 1 : limit;
    out.push(rest.slice(0, at));
    rest = rest.slice(at);
  }
  if (rest) out.push(rest);
  return out;
}

/** Reads a positive integer from the environment, falling back when the value
 *  is missing, empty, non-numeric or nonsensical. */
function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}
