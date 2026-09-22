import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveIdentity } from "@/lib/auth";
import { hasValidPass, requiresTurnstile } from "@/lib/turnstile";
import { Language, getLanguage } from "@/lib/languages";
import { translateStream, type RecentTurn } from "@/lib/translate";
import { LlmError } from "@/lib/llm";
import { allowRequest } from "@/lib/rate-limit";
import { Emit, sseResponse } from "@/lib/sse";

export const runtime = "nodejs";
export const maxDuration = 300;

// nginx allows 25 MB on this vhost because voice uploads need the room. A text
// translation never does, and the body is parsed in full before text.length can
// be looked at — so the cheap guard has to come off the header first.
const MAX_BODY_BYTES = 256 * 1024;

// The answer streams on `text/event-stream`: `transcript` with what is being
// translated, then `delta` frames carrying the translation as it is generated,
// then `done` with the stored turn (or `error` with a code). Everything that
// can be decided before the model is asked — identity, the bot gate, the rate
// limit, the conversation — is decided before the stream opens, so those
// failures still arrive as plain HTTP statuses the widget already handles.
export async function POST(req: NextRequest) {
  const identity = await resolveIdentity(req);
  if (!identity) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Everything is free, so nothing bounds how much gets translated — the rate
  // limit is the only thing stopping one caller from occupying the engine's
  // whole concurrency with repeated requests.
  if (!allowRequest("translate", identity.rateKey)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  // Anonymous traffic must carry a valid Turnstile pass before anything
  // reaches the model. Signed-in visitors are never challenged.
  if (requiresTurnstile(identity) && !hasValidPass(req)) {
    return NextResponse.json({ error: "turnstile_required" }, { status: 403 });
  }

  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "text_too_long" }, { status: 413 });
  }

  const body = await req.json().catch(() => ({}));
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const conversationId = typeof body.conversationId === "string" ? body.conversationId : "";
  if (!text) return NextResponse.json({ error: "no text" }, { status: 400 });
  if (!conversationId) return NextResponse.json({ error: "no conversationId" }, { status: 400 });

  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!conversation || conversation.ownerKey !== identity.ownerKey) {
    return NextResponse.json({ error: "conversation not found" }, { status: 404 });
  }

  // The direction is always known: the pair is fixed per conversation and
  // there is no auto-detect to fall back on. `writeLang` is the half the
  // visitor is typing in now (the swap button flips it).
  const langA = getLanguage(conversation.sourceLang);
  const langB = getLanguage(conversation.targetLang);
  const written = getLanguage(conversation.writeLang);
  if (!langA || !langB || !written) {
    return NextResponse.json({ error: "source_required" }, { status: 400 });
  }
  const sourceLang = written;
  const targetLang = sourceLang.code === langA.code ? langB : langA;

  // last 6 turns, oldest first, for conversational consistency
  const recent = (
    await prisma.translation.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      take: 6,
    })
  )
    .reverse()
    .map((t) => ({
      sourceLang: t.sourceLang,
      transcript: t.transcript,
      translation: t.translation,
    }));

  return sseResponse((emit) =>
    run({ emit, conversationId, sourceLang, targetLang, text, recent, signal: req.signal }),
  );
}

/**
 * The streaming half of the route: translate, report, store.
 *
 * Runs after the response has already started, so every failure has to be
 * reported as an `error` frame rather than a status code.
 */
async function run(params: {
  emit: Emit;
  conversationId: string;
  sourceLang: Language;
  targetLang: Language;
  text: string;
  recent: RecentTurn[];
  signal: AbortSignal;
}): Promise<void> {
  const { emit, conversationId, sourceLang, targetLang, text, recent, signal } = params;
  let translation = "";

  try {
    // The transcript is the input itself — the model is no longer asked to
    // echo it — so the widget can show what is being translated immediately.
    emit("transcript", { text });
    for await (const delta of translateStream(sourceLang, targetLang, text, recent, signal)) {
      translation += delta;
      emit("delta", { text: delta });
    }

    if (!translation.trim()) {
      emit("error", { error: "not_recognized" });
      return;
    }

    const row = await prisma.translation.create({
      data: {
        conversationId,
        sourceLang: sourceLang.code,
        transcript: text,
        translation,
      },
    });
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { lastUsedAt: new Date() },
    });

    emit("done", {
      id: row.id,
      source_lang: sourceLang.code,
      transcript: text,
      translation,
    });
  } catch (err: unknown) {
    // Whatever arrived before the failure is discarded with it: half a
    // translation is not a turn the visitor wants in their history.
    if (err instanceof LlmError && err.code === "aborted") {
      console.warn("[translate] client left mid-answer");
      return;
    }
    if (err instanceof LlmError) {
      console.error("[translate] model failed", err.code, err.message);
      emit("error", { error: err.code === "timeout" ? "model_timeout" : "model_unavailable" });
      return;
    }
    console.error("[translate] failed", err);
    emit("error", { error: "server_error" });
  }
}
