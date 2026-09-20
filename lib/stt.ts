// Speech-to-text client: whisper.cpp on the owner's Mac.
//
// The translation model is text-only, so voice needs its own engine. This is
// the thinnest possible client for `whisper-server`: one multipart upload, one
// transcript back. Like lib/llm.ts it neither knows nor cares how the engine
// is started — locally it listens on 127.0.0.1:1238, on the VPS the same
// process arrives over the owner's reverse-SSH tunnel as 127.0.0.1:18818 (see
// docs/local-llm.md).
//
// Two details are specific to whisper.cpp and were checked against the running
// server (1.9.4): the endpoint is `/inference`, not the OpenAI-compatible
// `/v1/audio/transcriptions` of the newer builds, and the language has to be
// given — a wrong hint is obeyed rather than corrected ("это проверка" came
// back as "this is the test" when English was asked for). The app always knows
// the direction of the conversation, so the hint is never guessed here.
//
// The recorder already hands over exactly what Whisper wants — 16 kHz, mono,
// 16-bit PCM WAV (lib/wav.ts) — so nothing is transcoded here.

/** Engine failure with a message meant for logs; routes answer clients with
 *  their own opaque codes. */
export class SttError extends Error {
  constructor(
    message: string,
    readonly code: "unavailable" | "timeout" | "aborted" | "http",
  ) {
    super(message);
    this.name = "SttError";
  }
}

/** Address of the engine, without a trailing slash. */
function baseUrl(): string {
  return (process.env.STT_BASE_URL ?? "http://127.0.0.1:1238").trim().replace(/\/+$/, "");
}

/** Ceiling for one transcription. Five minutes of speech takes tens of
 *  seconds of Metal, and the first call after a cold start also loads the
 *  model into memory. */
function timeoutMs(): number {
  return positiveInt(process.env.STT_TIMEOUT_MS, 240_000);
}

/**
 * Transcribes a WAV buffer.
 *
 * `language` is the ISO 639-1 code the recording is expected to be in — the
 * half of the topic's pair the visitor is speaking right now. It is required
 * because the engine answers in whatever language it is told, including when
 * that is wrong, and because the app has no detection left to double-check it.
 */
export async function transcribe(audio: Buffer, language: string, signal?: AbortSignal): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: "audio/wav" }), "speech.wav");
  // Plain `json`: the verbose shape carries per-word timings nothing here
  // reads, and five minutes of them is a lot of JSON to parse per request.
  form.append("response_format", "json");
  form.append("language", language);

  const stop = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs())]) : AbortSignal.timeout(timeoutMs());
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/inference`, { method: "POST", body: form, signal: stop });
  } catch (err) {
    throw wrap(err, signal);
  }
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 300);
    } catch {
      /* the status alone will have to do */
    }
    throw new SttError(`engine answered ${res.status}: ${detail}`, "http");
  }

  const data = (await res.json()) as { text?: string };
  return (data.text ?? "").trim();
}

/** fetch failure turned into an SttError: the caller's own abort means the
 *  visitor left, everything else means the engine is unreachable. */
function wrap(err: unknown, callerSignal?: AbortSignal): SttError {
  if (err instanceof SttError) return err;
  if (callerSignal?.aborted) return new SttError("request cancelled by the caller", "aborted");
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
    return new SttError("engine did not answer in time", "timeout");
  }
  const reason = err instanceof Error ? err.message : String(err);
  return new SttError(`engine unreachable at ${baseUrl()} (${reason})`, "unavailable");
}

/** Positive integer from the environment, with a fallback. */
function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}
