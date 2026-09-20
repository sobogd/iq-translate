// Server-sent events, the transport every translate route answers on now.
//
// A translation is generated token by token and the model runs at roughly 20
// tokens per second, so waiting for the whole answer before answering turns a
// three-second reply into a frozen widget. The route fills this stream as the
// answer grows; the browser paints it as it arrives (see readSse in
// lib/client.ts).

/** How often a keep-alive comment goes out while the answer is quiet. Small
 *  enough that no intermediary (nginx defaults to a 60 s read timeout) ever
 *  sees a silent connection, large enough not to matter on the wire. */
const HEARTBEAT_MS = 15_000;

/** Writes one frame of the stream: `event` names it, `data` carries JSON. */
export type Emit = (event: string, data: unknown) => void;

/**
 * Wraps `work` in a `text/event-stream` response.
 *
 * `work` receives the emitter and writes as much as it likes; the stream is
 * closed when it settles, whether it resolved or threw. Keep-alive comments
 * are sent in the meantime, so a slow model reads as a slow model rather than
 * as a dead connection. Buffering is switched off at the proxy with
 * `X-Accel-Buffering` — without it nginx would hold every delta until the
 * answer ended, which is exactly what this is here to avoid.
 */
export function sseResponse(work: (emit: Emit) => Promise<void>): Response {
  const encoder = new TextEncoder();
  let beat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Once the visitor closes the tab the controller is closed under us, and
      // enqueueing into it throws. Writing a frame to nobody is not an error
      // worth failing a request over — the work behind it decides what happens
      // next — so a closed stream simply swallows the rest.
      let open = true;
      const write = (frame: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(frame));
        } catch {
          open = false;
        }
      };
      const emit: Emit = (event, data) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      // A comment frame (`:`) carries no data: valid SSE, ignored by the
      // client's parser, enough to keep the connection alive.
      beat = setInterval(() => write(": hb\n\n"), HEARTBEAT_MS);
      try {
        await work(emit);
      } finally {
        clearInterval(beat);
        try {
          controller.close();
        } catch {
          /* already closed by cancel() */
        }
      }
    },
    cancel() {
      // The browser closed the connection: stop the keep-alive and let the
      // request's own AbortSignal release the engine slot (lib/llm.ts).
      clearInterval(beat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
