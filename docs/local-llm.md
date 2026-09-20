# Translation engine: two models on the owner's Mac

The app does not call a hosted AI API any more. Translation runs on
`llama.cpp`, speech recognition on `whisper.cpp`, and both processes live on the
owner's Mac rather than on the server. This file is the map: what runs where,
which ports connect them, and what to look at when the widget says the model is
unavailable.

## Topology

The Mac dials the VPS itself. No port is exposed to the internet, no TLS, no
auth layer: both ends bind to loopback and the tunnel joins them.

| Mac (127.0.0.1) | VPS (127.0.0.1) | What it is |
| --- | --- | --- |
| `1234` | `18812` | `llama-server` — translation (Qwen3.5-9B, Q6_K) |
| `1238` | `18818` | `whisper-server` — speech recognition (large-v3-turbo) |
| `8701` | `8701` | OCR sidecar, on the server itself (`services/ocr`) |

The tunnel is the same resilient reverse-SSH wrapper the CloudlyRu chat uses:
`~/work/jevel.ai/agents/run-dsh-tunnel.sh`, kept alive by launchd
(`com.agent.dsh-reverse-tunnel`). Every forwarded port must be listed twice in
that script — once in the `-R` arguments and once in the grep list it uses to
clear stale listeners on the VPS. A port that is missing from the grep keeps a
dead listener alive that blocks the next bind, and launchd restarts the tunnel
in a loop.

Ports 1234/1238 on the Mac are watched by launchd agents
(`com.agent.llm`, `com.agent.whisper`), so a crashed engine comes back on its
own. `pmset` keeps the Mac from sleeping — a sleeping Mac looks exactly like a
broken model.

## The two engines

**Translation** — `llama-server` with one model, four slots, 32768 tokens of
context per slot:

```bash
llama-server -m ~/models/Qwen3.5-9B-Q6_K.gguf --alias qwen/qwen3.5-9b \
  --host 127.0.0.1 --port 1234 --jinja -ngl 999 -c 32768 --flash-attn on \
  --cache-type-k q8_0 --cache-type-v q8_0 \
  --chat-template-kwargs '{"enable_thinking":false}'
```

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
| `LLM_BASE_URL` | `http://127.0.0.1:1234` | `http://127.0.0.1:18812` | translation engine |
| `LLM_MODEL` | `qwen/qwen3.5-9b` | same | model id as the engine reports it |
| `LLM_CTX` | `32768` | `32768` | must equal the server's `-c` |
| `LLM_CHUNK_CHARS` | unset | unset | characters per engine call; the default is derived from `LLM_CTX` |
| `LLM_REASONING` | `none` | `none` | `reasoning_effort`; `none` keeps a reasoning model from answering with nothing but thinking |
| `LLM_TEMPLATE_KWARGS` | `{"enable_thinking":false}` | same | same switch, for engines that take it in the chat template |
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
curl -s http://127.0.0.1:1238/health

# On the VPS: did the tunnel bind its ports?
ss -ltn | grep -E "18812|18818"
curl -s http://127.0.0.1:18812/v1/models | head -c 200
```

What the widget says when something is wrong:

| Message | Meaning |
| --- | --- |
| `model_unavailable` | nothing is listening on `LLM_BASE_URL` (engine down, Mac asleep, tunnel dropped) |
| `model_timeout` | the engine accepted the request and stopped answering |
| `stt_unavailable` / `stt_timeout` | same for `whisper-server` |
| `source_required` | the topic has no source language — a thread from before auto-detect was removed; picking a language in the widget fixes it |

The route logs carry the engine's own complaint (`[translate] model failed http:
model answered 400: ...`), which is where a context-window problem or an
unparseable schema shows up.

## What this costs

Nothing per request, and that is the point: the translation engine is the
owner's hardware. The plan quotas (`lib/plans.ts`) survived the move because
they no longer price a bill — they are what keeps one visitor from occupying
four slots that the whole site shares.

Two consequences worth knowing: a long text is slower than a hosted API by an
order of magnitude (a 2000-character message is ~25 seconds, and the widget
streams it out as it is generated), and **the Mac is a single point of failure
for the whole product** — if it is off, translation stops. That trade was made
deliberately.
