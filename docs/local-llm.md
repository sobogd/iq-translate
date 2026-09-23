# Translation engine: three models on the owner's Mac

The app does not call a hosted AI API any more. Translation runs on
`llama.cpp`, speech recognition on `whisper.cpp`, and both processes live on the
owner's Mac rather than on the server. Two models answer translation — a general
one for every language, a translation-specific one where it is better — and a
third listens for the audio. This file is the map: what runs where, which ports
connect them, and what to look at when the widget says the model is
unavailable.

## Topology

The Mac dials the VPS itself. No port is exposed to the internet, no TLS, no
auth layer: both ends bind to loopback and the tunnel joins them.

| Mac (127.0.0.1) | VPS (127.0.0.1) | What it is |
| --- | --- | --- |
| `1234` | `18812` | `llama-server` — general engine (Qwen3.5-4B): chat, search, and the pairs the translation model does not cover |
| `1235` | `18822` | `llama-server` — translation engine (TranslateGemma-4B) |
| `1238` | `18818` | `whisper-server` — speech recognition (large-v3-turbo) |

The tunnel is the same resilient reverse-SSH wrapper the CloudlyRu chat uses:
`~/work/cloudlyru/agents/mac/run-tunnel.sh`, kept alive by launchd
(`com.agent.mac-tunnel`). Every forwarded port must be listed twice in
that script — once in the `-R` arguments and once in the grep list it uses to
clear stale listeners on the VPS. A port that is missing from the grep keeps a
dead listener alive that blocks the next bind, and launchd restarts the tunnel
in a loop.

Ports 1234/1235/1238 on the Mac are watched by launchd agents
(`com.agent.llm`, `com.agent.llm-mt`, `com.agent.whisper`), so a crashed engine
comes back on its own. `pmset` keeps the Mac from sleeping — a sleeping Mac
looks exactly like a broken model.

## The engines

**General** — `llama-server` with one model, four slots, 65536 tokens of
context per slot. It answers chat and search, and it is also what translates
every pair the translation model does not cover:

```bash
llama-server -m ~/models/Qwen3.5-4B-UD-Q4_K_XL.gguf --alias qwen/qwen3.5-9b \
  --host 127.0.0.1 --port 1234 --jinja -ngl 999 -c 65536 --flash-attn on \
  --cache-type-k q8_0 --cache-type-v q8_0 \
  --chat-template-kwargs '{"enable_thinking":false}'
```

The alias still says `9b` although a 4B model is loaded. That is deliberate:
the id is written into `LLM_MODEL`, into existing conversations and into the
pi harness, and renaming it in four places to match a filename is a way to
break production for cosmetics. `LLM_MODEL` in `.env`/`deploy.yml` is the only
place the id matters to this app.

**Translation** — a second `llama-server`, the translation model, its own port.
Two flags are not optional here: `--no-jinja` and a 4K window.

```bash
llama-server -m ~/models/translategemma-4b-it-Q5_K_M.gguf --alias translategemma-4b \
  --host 127.0.0.1 --port 1235 --no-jinja -ngl 999 -c 4096 --flash-attn on
```

* `--no-jinja` because TranslateGemma's own chat template demands structured
  content (`type`/`source_lang_code`/`target_lang_code`/`text`) and llama.cpp
  cannot build a parser for it — the server doesn't even start. Without jinja
  the built-in Gemma template is used, and `lib/translate.ts` reproduces the
  model's prompt word for word instead. That prompt is not a style choice: the
  model was trained on it.
* Its card promises **2K tokens of input**, ten times less than the general
  engine, which is why `MT_LIMITS` keeps one engine call around 2000 characters
  and the conversation context around 300. Long texts are simply split into
  more calls.
* No `--chat-template-kwargs`: there is no thinking to switch off, and the
  translation request is sent without `reasoning_effort`.

### Which engine answers a pair

A translation goes to the second engine only when **both** languages are ones
Google trained and evaluated TranslateGemma on — the 55-language WMT24++ set,
which is 50 codes the widget offers (`lib/translate.ts`, `MT_LANGUAGES`).
Everyone else keeps the general model.

The split is not cosmetic. `lib/languages.ts` was itself pruned by measuring
against the general model (36 languages were removed for coming back in the
wrong language), so handing those languages to a model that never saw them
would be how a widget starts answering in Thai when asked for Lao. Every SEO
locale of the site is inside the covered set, so the content pages always get
the faster engine; the tail of the picker — `ms`, `tl`, `az`, `be`, `hy`, `ka`,
`kk`, `ky`, `mk`, `mn`, `ne`, `si`, `sq`, `tk`, `uz`, `km`, `ku`, `ps`, `jv`,
`mt`, `cy`, `ga`, `gl` and the rest — stays on the general one.

An empty or missing `MT_BASE_URL` turns the routing off entirely: every request
falls back to the general engine, which is exactly the behaviour a deploy had
before the second engine existed. `deploy.yml` shipped that way first — the
engine, the tunnel and the prompt were already in place while every pair still
went to the general model — and the routing was turned on afterwards by giving
`MT_BASE_URL` its address in the same file, as a deploy of its own.

* `-c` is the number the app has to know: `LLM_CTX` in `.env`/`deploy.yml` must
  match it. Every request budget in `lib/llm-limits.ts` (chunk size, output
  ceiling, the practical input cap) is derived from that number, and a mismatch
  shows up as rejected requests rather than as a wrong answer.
* Four slots (`-np`) is the whole site's concurrency. There is no queue in the
  app: a fifth simultaneous request waits inside llama.cpp.
* `--chat-template-kwargs` turns thinking off. The app also sends
  `chat_template_kwargs` and `reasoning_effort` per request
  (`LLM_TEMPLATE_KWARGS`, `LLM_REASONING`), so the behaviour does not depend on
  how the server was started.

**Speech** — `whisper-server`, one model, the WAV the browser already records
(16 kHz mono 16-bit — nothing is transcoded):

```bash
whisper-server -m ~/models/ggml-large-v3-turbo-q5_0.bin \
  --host 127.0.0.1 --port 1238 --convert
```

The app calls `POST /inference` with `response_format=json` and an explicit
`language` (`lib/stt.ts`). Not `/v1/audio/transcriptions`: that OpenAI-compatible
path of the newer builds does not exist in the packaged 1.9.4 server. And not
without a language: the engine obeys the hint even when it is wrong — a Russian
recording asked for as English came back as "Hello, this is the test of the
language of the Russian language". The app always knows the direction of the
conversation, so the hint is never a guess. Five minutes of speech is roughly
20–40 seconds of Metal.

## Configuration

`.env` (locally `.env.local`) and `deploy.yml` carry the addresses; the code has
defaults for everything else.

| Variable | Local | VPS | Meaning |
| --- | --- | --- | --- |
| `LLM_BASE_URL` | `http://127.0.0.1:1234` | `http://127.0.0.1:18812` | general engine: chat, search, uncovered pairs |
| `LLM_MODEL` | `qwen/qwen3.5-9b` | same | model id as the engine reports it (the id stayed after the 9B left) |
| `LLM_CTX` | `65536` | `65536` | must equal the general server's `-c` |
| `MT_BASE_URL` | `http://127.0.0.1:1235` | `http://127.0.0.1:18822` | translation engine; empty disables the routing |
| `MT_MODEL` | `translategemma-4b` | same | model id of the translation engine |
| `MT_CTX` | `4096` | `4096` | must equal the translation server's `-c` |
| `LLM_CHUNK_CHARS` | unset | unset | characters per engine call; the default is derived from that engine's `LLM_CTX`/`MT_CTX` |
| `LLM_PROMPT_RESERVE_TOKENS` | unset | unset | tokens held back for the prompt; the translation engine's default is much smaller |
| `LLM_OUTPUT_GROWTH` | unset | unset | how much longer the answer may get than the input; feeds the chunk size |
| `MT_CONTEXT_CHARS` | unset | unset | RECENT TURNS budget of the translation engine (300 by default, against 2000) |
| `LLM_REASONING` | `none` | `none` | `reasoning_effort` for the general engine; `none` keeps a reasoning model from answering with nothing but thinking |
| `LLM_TEMPLATE_KWARGS` | `{"enable_thinking":false}` | same | template switch for the general engine; `MT_TEMPLATE_KWARGS` is the same for the translation one and is unset — its model takes no such switch |
| `LLM_TIMEOUT_MS` | `600000` | same | ceiling for one whole answer |
| `LLM_IDLE_TIMEOUT_MS` | `120000` | same | ceiling for the gap between two stream chunks |
| `STT_BASE_URL` | `http://127.0.0.1:1238` | `http://127.0.0.1:18818` | speech engine |
| `STT_TIMEOUT_MS` | `240000` | same | covers the model load on a cold start |

The speech model is not configured here: `whisper-server` takes it on the
command line (`-m`) and has no per-request model field.

## Diagnostics

```bash
# On the Mac: are the engines and the tunnel alive?
launchctl list | grep -E "dsh-reverse-tunnel|agent.llm|agent.whisper"
curl -s http://127.0.0.1:1234/v1/models | head -c 200
curl -s http://127.0.0.1:1235/v1/models | head -c 200
curl -s http://127.0.0.1:1238/health

# On the VPS: did the tunnel bind its ports?
ss -ltn | grep -E "18812|18822|18818"
curl -s http://127.0.0.1:18812/v1/models | head -c 200
curl -s http://127.0.0.1:18822/v1/models | head -c 200
```

What the widget says when something is wrong:

| Message | Meaning |
| --- | --- |
| `model_unavailable` | nothing is listening on `LLM_BASE_URL` (engine down, Mac asleep, tunnel dropped) |
| `model_timeout` | the engine accepted the request and stopped answering |
| `stt_unavailable` / `stt_timeout` | same for `whisper-server` |
| `source_required` | the conversation row has no usable pair — a legacy row whose languages cannot be resolved; picking a language in the widget fixes it |

The route logs carry the engine's own complaint (`[translate] model failed http:
model answered 400: ...`), which is where a context-window problem or an
unparseable schema shows up.

## What this costs

Nothing per request, and that is the point: the translation engine is the
owner's hardware. The service is free and unmetered — there is no plan and no
quota any more; the rate limiter is what keeps one visitor from occupying four
slots that the whole site shares.

Two consequences worth knowing: a long text is slower than a hosted API by an
order of magnitude (a 2000-character message is ~25 seconds, and the widget
streams it out as it is generated), and **the Mac is a single point of failure
for the whole product** — if it is off, translation stops. That trade was made
deliberately.
