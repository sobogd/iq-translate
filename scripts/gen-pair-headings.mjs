// Rewrites the four spotlight headings on every language-pair page so each one
// carries a real search modifier instead of generic marketing copy.
//
// Why: the pair pages target "<translator> from X to Y", a head term whose SERP
// is owned by Google Translate and DeepL and answered by Google's own inline
// widget. The winnable queries are the modified ones — voice, conversation,
// online/no-install, text — and those words were nowhere in the page's H2s.
// It doubles as differentiation: the headings were near-identical across pairs
// within a locale, which is what pushed the similarity measurement to 0.8+.
//
// Only `spotlights[i].heading` is touched. The sub and bullets under it stay,
// so the new heading has to keep describing the block it sits on.
//
// Usage: node scripts/gen-pair-headings.mjs [locale...]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
// The generation engine is the same local llama.cpp the app translates with
// (see docs/local-llm.md) — a batch script has no reason to hold a cloud key.
const BASE_URL = (process.env.LLM_BASE_URL ?? "http://127.0.0.1:1234").replace(/\/+$/, "");
const MODEL = process.env.LLM_MODEL ?? "qwen/qwen3.5-9b";
// The engine has four slots, and every worker occupies one for the whole
// request, so more workers than slots would only queue inside llama.cpp.
const CONCURRENCY = 4;
// A heading batch is short; the ceiling is for the slot, not the text.
const MAX_TOKENS = 512;

// .env.local is not loaded by plain node the way next does it.
function loadEnv() {
  if (process.env.LLM_BASE_URL) return;
  const file = path.join(ROOT, ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnv();

// Positional: the pair template renders exactly these four blocks in this
// order (see SPOTLIGHT_ICONS.pair in app/_landing/FeatureLanding.tsx).
const SLOTS = [
  "VOICE — speaking out loud. Must contain the voice/speech modifier the way people search it in this language (e.g. 'voice translator from X to Y', 'голосовой переводчик с X на Y').",
  "CONVERSATION — a two-way live dialogue, both sides in one thread. Must contain the conversation/dialogue modifier (e.g. 'translator for a conversation', 'переводчик для разговора').",
  "ONLINE / REACH — works in the browser with nothing to install, and covers 186 languages beyond this pair. Must contain the online / no-download modifier.",
  "TEXT — typing or pasting instead of speaking. Must contain the text-translation modifier (e.g. 'text translator', 'перевод текста').",
];

// JSON Schema the engine compiles into a grammar, so the shape of the answer
// is guaranteed and the script only has to sanity-check the contents.
const SCHEMA = {
  type: "object",
  properties: { headings: { type: "array", items: { type: "string" } } },
  required: ["headings"],
  additionalProperties: false,
};

function prompt(pair, content, langNames) {
  const blocks = content.spotlights
    .map((s, i) => `BLOCK ${i + 1}\n  slot: ${SLOTS[i]}\n  current heading: "${s.heading}"\n  text under it: "${s.sub}"`)
    .join("\n\n");
  return `You are writing SEO headings (H2) for a language-pair page of an online voice translator.

The page is written in ${langNames.page} and targets people who search in ${langNames.page}.
The page's language pair is ${langNames.from} -> ${langNames.to}.
The page's H1 is: "${content.hero.title}"

Rewrite the heading of each of the four blocks below. Rules:
- Write in ${langNames.page}. Natural, idiomatic, how a native speaker would phrase a search — not a translated English slogan.
- Each heading MUST contain the modifier its slot names, and MUST name the actual languages (${langNames.from}, ${langNames.to}) where it reads naturally. Do not force both language names into all four.
- Each heading must still honestly describe the text under it. Do not promise anything the text does not.
- 30 to 60 characters. Sentence case, no trailing period, no quotes, no emoji.
- The four headings must be clearly different from each other.

${blocks}

Return exactly 4 headings, in block order.`;
}

async function headingsFor(pair, content, langNames, attempt = 1) {
  try {
    const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: "You write SEO headings. Answer with a JSON object only." },
          { role: "user", content: prompt(pair, content, langNames) },
        ],
        temperature: 0.9,
        max_tokens: MAX_TOKENS,
        reasoning_effort: "none",
        chat_template_kwargs: { enable_thinking: false },
        response_format: { type: "json_schema", json_schema: { name: "headings", strict: true, schema: SCHEMA } },
      }),
    });
    if (!res.ok) throw new Error(`engine answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = await res.json();
    const out = JSON.parse(body.choices?.[0]?.message?.content ?? "{}").headings;
    if (!Array.isArray(out) || out.length !== 4 || out.some((h) => typeof h !== "string" || !h.trim())) {
      throw new Error(`bad shape: ${JSON.stringify(out)?.slice(0, 120)}`);
    }
    return out.map((h) => h.trim().replace(/^["']|["']$/g, "").replace(/[.]$/, ""));
  } catch (e) {
    if (attempt >= 3) throw e;
    await new Promise((r) => setTimeout(r, 800 * attempt));
    return headingsFor(pair, content, langNames, attempt + 1);
  }
}

function readPairs() {
  const src = fs.readFileSync(path.join(ROOT, "lib", "pairs.ts"), "utf8");
  const out = [];
  for (const m of src.matchAll(/\.\.\.P\("(\w+)",\s*"(\w+)",\s*\[([\s\S]*?)\]\)/g)) {
    for (const n of m[3].matchAll(/\["(\w+)",\s*"([a-z0-9-]+)"\]/g)) {
      out.push({ locale: m[1], from: m[2], to: n[1], slug: n[2] });
    }
  }
  return out;
}

// English names are only used inside the prompt, to tell the model which
// languages the page is about; they never reach the page.
const NAMES = {
  en: "English", es: "Spanish", de: "German", fr: "French", it: "Italian", pt: "Portuguese",
  nl: "Dutch", pl: "Polish", ru: "Russian", uk: "Ukrainian", sv: "Swedish", da: "Danish",
  no: "Norwegian", fi: "Finnish", cs: "Czech", el: "Greek", tr: "Turkish", ro: "Romanian",
  hu: "Hungarian", bg: "Bulgarian", hr: "Croatian", sk: "Slovak", sl: "Slovenian",
  et: "Estonian", lv: "Latvian", lt: "Lithuanian", sr: "Serbian", ca: "Catalan",
  is: "Icelandic", fa: "Persian", ar: "Arabic", ja: "Japanese", ko: "Korean", zh: "Chinese",
};

async function main() {
  const only = process.argv.slice(2);
  const pairs = readPairs().filter((p) => only.length === 0 || only.includes(p.locale));
  console.log(`${pairs.length} pair pages`);

  let done = 0;
  const failures = [];
  const queue = [...pairs];

  async function worker() {
    for (;;) {
      const pair = queue.shift();
      if (!pair) return;
      const file = path.join(ROOT, "content", "pairs", pair.locale, `${pair.slug}.json`);
      const content = JSON.parse(fs.readFileSync(file, "utf8"));
      try {
        const headings = await headingsFor(pair, content, {
          page: NAMES[pair.locale],
          from: NAMES[pair.from],
          to: NAMES[pair.to],
        });
        headings.forEach((h, i) => {
          content.spotlights[i].heading = h;
        });
        fs.writeFileSync(file, `${JSON.stringify(content, null, 2)}\n`);
      } catch (e) {
        failures.push(`${pair.locale}/${pair.slug}: ${e.message}`);
      }
      done += 1;
      if (done % 20 === 0) console.log(`  ${done}/${pairs.length}`);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`done: ${done - failures.length} rewritten, ${failures.length} failed`);
  failures.forEach((f) => console.log(`  ! ${f}`));
}

main();
