"use client";

// Thin fetch wrapper — kept as the one call site every component already
// uses. Anonymous identity no longer rides along on the client at all: the
// server derives it straight from the request's own IP/User-Agent/
// Accept-Language (see computeFingerprint in lib/auth.ts).
export async function apiFetch(input: string, init: RequestInit = {}) {
  return fetch(input, init);
}

/** One frame of a server-sent event stream: the event name and its parsed
 *  JSON payload. */
export type SseEvent = { event: string; data: unknown };

/**
 * Reads a `text/event-stream` response to its end, calling `onEvent` for every
 * frame.
 *
 * The translate routes answer on this transport because the model generates a
 * translation far slower than a person reads one (see lib/sse.ts): the caller
 * gets the answer as it grows instead of after the last token. Frames are
 * separated by a blank line, so a chunk boundary that lands mid-line is
 * carried over to the next read rather than parsed as a truncated frame;
 * comment frames (the server's keep-alives) are ignored. Resolves when the
 * server closes the stream — an `error` frame reaches `onEvent` like any
 * other, because by then the HTTP status has long been sent.
 */
export async function readSse(res: Response, onEvent: (event: SseEvent) => void): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let name = "";
  let data = "";

  const flush = () => {
    if (data) onEvent({ event: name || "message", data: parseJson(data) });
    name = "";
    data = "";
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index: number;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).replace(/\r$/, "");
      buffer = buffer.slice(index + 1);
      if (line === "") {
        flush();
        continue;
      }
      if (line.startsWith(":")) continue; // keep-alive comment
      if (line.startsWith("event:")) name = line.slice(6).trim();
      else if (line.startsWith("data:")) data += (data ? "\n" : "") + line.slice(5).trim();
    }
  }
  // A stream that ends without its final blank line still owes us that frame.
  flush();
}

/** Payload of a frame as a value; an unparseable payload becomes null instead
 *  of throwing into the caller's render loop. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
