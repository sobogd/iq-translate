// Chat client for the local model.
//
// Speaks only the standard OpenAI-compatible protocol (`POST
// /v1/chat/completions`) and deliberately does not care what serves it —
// llama.cpp today, LM Studio or Ollama tomorrow. The transport lives here and
// nothing above this file knows the model's name, its host or how the stream
// is framed.
//
// Configuration (all optional except the address, see docs/local-llm.md):
//   LLM_BASE_URL         the GENERAL engine: chat, search, and the language
//                        pairs the translation model does not cover. On the Mac
//                        it is http://127.0.0.1:1234, on the VPS the same
//                        engine arrives over the owner's reverse-SSH tunnel as
//                        http://127.0.0.1:18812
//   LLM_MODEL            model id as the engine reports it
//   MT_BASE_URL          the TRANSLATION engine (TranslateGemma), same tunnel
//                        idea: http://127.0.0.1:1235 locally, .1:18822 on the
//                        VPS. Empty or unset turns the whole routing off and
//                        every call goes to the general engine — so a deploy
//                        that has not been given this address keeps working
//   MT_MODEL             model id of the translation engine
//   LLM_API_KEY          only for engines that require one; usually empty
//   LLM_REASONING        `reasoning_effort` sent when set; `none` keeps a
//                        reasoning model from spending the whole answer on
//                        thinking and returning no text at all. Only the
//                        general engine gets it: the translation model is not
//                        a reasoning model and has nothing to switch off
//   LLM_TEMPLATE_KWARGS  extra chat-template fields as a JSON object, e.g.
//                        {"enable_thinking": false} for Qwen on llama.cpp;
//                        MT_TEMPLATE_KWARGS is the same for the translation
//                        engine, whose template takes no such switch
//   LLM_TIMEOUT_MS       ceiling for one whole answer
//   LLM_IDLE_TIMEOUT_MS  ceiling for the gap between two stream chunks

/** Which of the two configured engines a call goes to. Translation picks by
 *  language pair (see lib/translate.ts); everything else uses the default. */
export type LlmEngine = "default" | "mt";

/** Message of a chat request, in the shape the protocol uses. */
export type LlmMessage = { role: "system" | "user"; content: string };

/** How a call failed, for callers that must react differently: an aborted
 *  request is the visitor leaving and must not be logged as an outage. */
export type LlmErrorCode = "unavailable" | "timeout" | "aborted" | "http";

/** Engine failure with a message meant for logs. Routes answer clients with
 *  their own opaque codes, so nothing here is user-facing copy. */
export class LlmError extends Error {
  constructor(
    message: string,
    readonly code: LlmErrorCode,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export type ChatOptions = {
  messages: LlmMessage[];
  /** Output ceiling in tokens; callers derive it from lib/llm-limits.ts. */
  maxTokens: number;
  temperature?: number;
  /** Engine to ask. Defaults to the general one; translation passes "mt" for
   *  the pairs its own model covers. */
  engine?: LlmEngine;
  /** Constrains the answer to this JSON Schema (llama.cpp compiles it into a
   *  grammar). Used by the photo flow, where every segment must come back
   *  keyed by its own id. */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  /** Cancels the request — a closed browser tab must free the engine slot. */
  signal?: AbortSignal;
};

/** Address of one engine, without a trailing slash so paths can be appended. */
function baseUrl(engine: LlmEngine): string {
  if (engine === "mt") return (process.env.MT_BASE_URL ?? "").trim().replace(/\/+$/, "");
  return (process.env.LLM_BASE_URL ?? "http://127.0.0.1:1234").trim().replace(/\/+$/, "");
}

/**
 * Whether the translation engine is configured at all.
 *
 * The routing in lib/translate.ts asks this before sending anything to `mt`: a
 * deployment whose environment has no MT_BASE_URL has no translation model to
 * reach, and the honest fallback is the general engine rather than a request
 * to an empty address.
 */
export function mtEngineConfigured(): boolean {
  return baseUrl("mt").length > 0;
}

/** Headers of every request; the key is sent only when one is configured. */
function headers(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const key = (process.env.LLM_API_KEY ?? "").trim();
  if (key) headers.Authorization = `Bearer ${key}`;
  return headers;
}

/** Model id to ask for. A single local engine serves one loaded model; when
 *  the id does not match, llama.cpp answers with whatever is loaded. */
function llmModelName(engine: LlmEngine): string {
  if (engine === "mt") return (process.env.MT_MODEL ?? "translategemma-4b").trim();
  return (process.env.LLM_MODEL ?? "qwen/qwen3.5-9b").trim();
}

/** Ceiling for one whole answer. Generous on purpose: a cold model has to
 *  load, and a long text is translated chunk by chunk in one request. */
function fullTimeoutMs(): number {
  return positiveInt(process.env.LLM_TIMEOUT_MS, 600_000);
}

/** Ceiling for the gap between two chunks of a stream: a stream that stalls
 *  mid-answer must fail rather than hold a slot until the full timeout. */
function idleTimeoutMs(): number {
  return positiveInt(process.env.LLM_IDLE_TIMEOUT_MS, 120_000);
}

/**
 * One complete answer, no streaming.
 *
 * Returns the assistant's text, trimmed. Throws LlmError on any failure, so
 * callers never see a raw TypeError from fetch.
 */
export async function chat(opts: ChatOptions): Promise<string> {
  const engine = opts.engine ?? "default";
  const body = buildBody(opts, false);
  const signal = withTimeout(opts.signal, fullTimeoutMs());
  let res: Response;
  try {
    res = await fetch(`${baseUrl(engine)}/v1/chat/completions`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    throw wrapNetworkError(err, engine, opts.signal);
  }
  if (!res.ok) throw await httpError(res);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return (data.choices?.[0]?.message?.content ?? "").trim();
}

/**
 * The answer as it is generated, one text chunk at a time.
 *
 * Yields only the model's visible text: `reasoning_content` of a reasoning
 * model is dropped rather than mixed into a translation. The stream ends when
 * the engine sends `[DONE]` or closes the connection; an engine that stalls
 * longer than the idle timeout throws instead of hanging on to the slot.
 */
export async function* chatStream(opts: ChatOptions): AsyncGenerator<string> {
  const engine = opts.engine ?? "default";
  const body = buildBody(opts, true);
  // Two independent ceilings on one request: the full timeout for the whole
  // answer (inside withTimeout) and the idle one for the gap between chunks,
  // which the timer below aborts. The caller's own signal rides along so a
  // closed tab frees the engine slot immediately.
  const idle = new AbortController();
  const signal = withTimeout(
    opts.signal ? AbortSignal.any([opts.signal, idle.signal]) : idle.signal,
    fullTimeoutMs(),
  );

  let res: Response;
  try {
    res = await fetch(`${baseUrl(engine)}/v1/chat/completions`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    throw wrapNetworkError(err, engine, opts.signal);
  }
  if (!res.ok || !res.body) throw await httpError(res);

  const decoder = new TextDecoder();
  // Chunk boundaries land mid-line, so an incomplete line is kept for the
  // next round instead of being parsed and dropped.
  let buffer = "";
  let timer = setTimeout(() => idle.abort(), idleTimeoutMs());
  const bump = () => {
    clearTimeout(timer);
    timer = setTimeout(() => idle.abort(), idleTimeoutMs());
  };
  try {
    for await (const bytes of res.body as unknown as AsyncIterable<Uint8Array>) {
      bump();
      buffer += decoder.decode(bytes, { stream: true });
      let index: number;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        const text = parseDelta(line);
        if (text) yield text;
      }
    }
  } catch (err) {
    // A stall is reported as an abort of the idle controller — that is a
    // timeout, not the visitor leaving, so it must not look like a cancel.
    if (idle.signal.aborted && !opts.signal?.aborted) {
      throw new LlmError(`model stalled for more than ${idleTimeoutMs()} ms`, "timeout");
    }
    throw wrapNetworkError(err, engine, opts.signal);
  } finally {
    clearTimeout(timer);
  }
}

/** Request body for both call kinds. The extra fields are sent only when the
 *  environment asks for them, because engines differ in what they accept —
 *  an unknown field is ignored by llama.cpp, but a malformed one is not
 *  worth risking on every call. */
function buildBody(opts: ChatOptions, stream: boolean): Record<string, unknown> {
  const engine = opts.engine ?? "default";
  const body: Record<string, unknown> = {
    model: llmModelName(engine),
    messages: opts.messages,
    stream,
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens,
  };
  // Reasoning is a general-engine concern only: the translation model has no
  // such switch, and sending an unknown field to it buys nothing.
  const reasoning = engine === "mt" ? "" : (process.env.LLM_REASONING ?? "none").trim();
  if (reasoning) body.reasoning_effort = reasoning;
  const kwargs = templateKwargs(engine);
  if (kwargs) body.chat_template_kwargs = kwargs;
  if (opts.jsonSchema) {
    body.response_format = {
      type: "json_schema",
      json_schema: { name: opts.jsonSchema.name, strict: true, schema: opts.jsonSchema.schema },
    };
  }
  return body;
}

/** `LLM_TEMPLATE_KWARGS` (or `MT_TEMPLATE_KWARGS`) parsed once per call. A
 *  broken value is logged and ignored: a typo in the environment must not take
 *  the whole feature down. */
function templateKwargs(engine: LlmEngine): Record<string, unknown> | null {
  const name = engine === "mt" ? "MT_TEMPLATE_KWARGS" : "LLM_TEMPLATE_KWARGS";
  const raw = (process.env[name] ?? "").trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    console.warn(`[llm] ${name} is not valid JSON — sending the request without it`);
    return null;
  }
}

/** Text of one SSE line, or "" for anything that carries none (comments,
 *  keep-alives, the terminating `[DONE]`, usage-only frames). */
function parseDelta(line: string): string {
  if (!line.startsWith("data:")) return "";
  const payload = line.slice(5).trim();
  if (!payload || payload === "[DONE]") return "";
  try {
    const parsed = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
    const content = parsed.choices?.[0]?.delta?.content;
    return typeof content === "string" ? content : "";
  } catch {
    return "";
  }
}

/** Response of a non-2xx call turned into an LlmError whose message carries
 *  the engine's own complaint, truncated — llama.cpp explains schema and
 *  context errors in prose that is worth keeping in the log. */
async function httpError(res: Response): Promise<LlmError> {
  let detail = "";
  try {
    detail = (await res.text()).slice(0, 300);
  } catch {
    /* body already gone — the status alone will have to do */
  }
  return new LlmError(`model answered ${res.status}: ${detail}`, "http");
}

/** fetch failure turn into an LlmError. The caller's own abort means the
 *  visitor left; everything else (refused connection, stalled socket) is the
 *  engine being unreachable. */
function wrapNetworkError(err: unknown, engine: LlmEngine, callerSignal?: AbortSignal): LlmError {
  if (err instanceof LlmError) return err;
  if (callerSignal?.aborted) return new LlmError("request cancelled by the caller", "aborted");
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
    return new LlmError("model did not answer in time", "timeout");
  }
  const reason = err instanceof Error ? err.message : String(err);
  return new LlmError(`model unreachable at ${baseUrl(engine)} (${reason})`, "unavailable");
}

/** The caller's signal plus our own ceiling, as one signal. A call with no
 *  signal of its own (a batch script) still gets the ceiling. */
function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  if (!signal) return AbortSignal.timeout(ms);
  return AbortSignal.any([signal, AbortSignal.timeout(ms)]);
}

/** Positive integer from the environment, with a fallback. */
function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}
