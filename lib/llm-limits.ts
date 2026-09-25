// Token accounting for the local models' context windows.
//
// One engine serves everything now (see docs/local-llm.md): 35B or 27B via
// oMLX. TranslateGemma-4B was retired — a single larger model handles all
// language pairs and chat/search from the same port.
//
// Why estimate tokens from characters instead of counting them: the app has no
// tokenizer for the served model, and a real one would have to be kept in sync
// with whatever GGUF is loaded. `CHARS_PER_TOKEN = 2` is deliberately
// pessimistic on both scripts the product sees most — Cyrillic runs ~2.5
// characters per token and Latin ~4 — so the estimate is never smaller than
// the truth and the window is never overrun.

/** Budget of the one engine: what fits in a single call, and how much
 *  conversation context may ride along with it. */
export type EngineLimits = {
  /** Characters of the RECENT TURNS block resent with every request. It is not
   *  charged to anyone's quota, but it does occupy the window and the prefill
   *  time, so it is capped and the newest turns are the ones kept. */
  readonly contextChars: number;
  /** Source text of one engine call, split at paragraph/sentence/word
   *  boundaries — never longer than this engine's window allows. */
  splitIntoChunks(text: string): string[];
  /** Output budget for one engine call, in tokens. */
  maxOutputTokens(inputChars: number): number;
};

/** Characters per token, rounded down — see the header comment. */
const CHARS_PER_TOKEN = 2;

/** Slack for the model adding a sentence of its own: the prompt forbids it,
 *  but a window overrun is a 400 from llama.cpp and a lost request, so a
 *  little room is cheaper than trust. */
const SLACK_TOKENS = 256;

/** Numbers one engine falls back to when the environment says nothing. */
type Defaults = {
  /** Context window of ONE llama.cpp slot, in tokens. Must match the server's
   *  `-c`/`--ctx-size`: llama.cpp splits its total window between its `-np`
   *  slots, and one request occupies one slot, so this is the per-slot value. */
  ctx: number;
  /** Tokens held back for the prompt itself — instructions, the pair and the
   *  RECENT TURNS block. The general engine's prompt is a page of rules; the
   *  translation engine's is one paragraph, and its window is small enough
   *  that the reserve has to shrink with it. */
  reserveTokens: number;
  /** How much longer the answer may get than the input, in tokens. Translating
   *  English into Russian grows the token count by ~1.6 (Latin packs ~4
   *  characters per token, Cyrillic ~2.5), and the model occasionally expands
   *  a terse phrase into a full sentence; 2.2 covers both. */
  growth: number;
  /** Size of one engine call when a longer text is split, in characters. */
  chunkChars: number;
  contextChars: number;
};

/**
 * Budget of one engine, read from `<prefix>CTX`, `<prefix>CHUNK_CHARS`,
 * `<prefix>CONTEXT_CHARS`, `<prefix>PROMPT_RESERVE_TOKENS` and
 * `<prefix>OUTPUT_GROWTH`.
 *
 * The prefix is how the same arithmetic serves both engines without a second
 * copy of it: `LLM_` for the general model, `MT_` for the translation one.
 */
function buildLimits(prefix: string, defaults: Defaults): EngineLimits {
  const ctx = positiveInt(process.env[`${prefix}CTX`], defaults.ctx);
  const reserve = positiveInt(process.env[`${prefix}PROMPT_RESERVE_TOKENS`], defaults.reserveTokens);
  const growth = positiveNumber(process.env[`${prefix}OUTPUT_GROWTH`], defaults.growth);

  // Longest single call, in characters of source text: input plus its
  // worst-case output plus the prompt must fit the window.
  const maxInputChars = Math.floor(
    ((ctx - reserve - SLACK_TOKENS) / (1 + growth)) * CHARS_PER_TOKEN,
  );
  const chunkChars = Math.min(
    positiveInt(process.env[`${prefix}CHUNK_CHARS`], defaults.chunkChars),
    Math.max(maxInputChars, 1),
  );

  /**
   * Output budget for one call, in tokens.
   *
   * Takes the larger of "enough for a translation this long" and the room the
   * window has left after the prompt and the input — the one value that must
   * never exceed the slot, since llama.cpp answers a too-large request with a
   * 400 rather than truncating.
   */
  const maxOutputTokens = (inputChars: number): number => {
    const wanted = Math.ceil(estimateTokens(inputChars) * growth) + SLACK_TOKENS;
    const available = ctx - reserve - estimateTokens(inputChars) - SLACK_TOKENS;
    return Math.max(64, Math.min(wanted, available));
  };

  return {
    contextChars: positiveInt(process.env[`${prefix}CONTEXT_CHARS`], defaults.contextChars),
    splitIntoChunks: (text: string) => splitIntoChunks(text, chunkChars),
    maxOutputTokens,
  };
}

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

/** The one engine (35B/27B via oMLX) that answers chat, search and all
 *  language pairs. */
export const DEFAULT_LIMITS: EngineLimits = buildLimits("LLM_", {
  ctx: 32768,
  reserveTokens: 1200,
  growth: 2.2,
  chunkChars: 8000,
  contextChars: 2000,
});

/**
 * Splits `text` into pieces no longer than `limit` characters, cutting at
 * paragraph, line, sentence or word boundaries in that order of preference.
 *
 * Each piece is returned as the exact slice of the original, trailing
 * whitespace included, so translating the pieces independently and joining
 * the answers with "" reproduces the source layout — the caller only has to
 * put back the whitespace the model stripped at the end of an answer.
 */
function splitIntoChunks(text: string, limit: number): string[] {
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

/** Same, for the one setting that is a fraction rather than a count. */
function positiveNumber(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
