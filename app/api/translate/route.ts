import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveIdentity, type Identity } from "@/lib/auth";
import { hasValidPass, requiresTurnstile } from "@/lib/turnstile";
import { Language, getLanguage } from "@/lib/languages";
import { chargeChars, refundChars } from "@/lib/credits";
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
// limit, the quota, the topic — is decided before the stream opens, so those
// failures still arrive as plain HTTP statuses the widget already handles.
export async function POST(req: NextRequest) {
  const identity = await resolveIdentity(req);
  if (!identity) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Quotas bound how much gets translated, never how fast: without this, 500
  // free characters could be spent one character at a time, each request
  // re-paying the fixed prompt overhead and occupying the model's only slots.
  if (!allowRequest("translate", identity.quotaKey)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  // Anonymous traffic must carry a valid Turnstile pass before anything
  // reaches the model — checked ahead of credit consumption so a rejected
  // request never burns quota.
  if (requiresTurnstile(identity) && !hasValidPass(req)) {
    return NextResponse.json({ error: "turnstile_required" }, { status: 403 });
  }

  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "text_too_long" }, { status: 413 });
  }

  const body = await req.json().catch(() => ({}));
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const topicId = typeof body.topicId === "string" ? body.topicId : "";
  if (!text) return NextResponse.json({ error: "no text" }, { status: 400 });
  if (!topicId) return NextResponse.json({ error: "no topicId" }, { status: 400 });

  const topic = await prisma.topic.findUnique({ where: { id: topicId } });
  if (!topic || topic.ownerKey !== identity.ownerKey) {
    return NextResponse.json({ error: "topic not found" }, { status: 404 });
  }

  // The direction is always known: the pair is fixed per topic and there is no
  // auto-detect to fall back on. `writeLang` is the half the visitor is typing
  // in now (the swap button flips it); a topic from before that column existed
  // falls back to its source. A topic that somehow has no source at all is
  // answered with a code the widget turns into "pick the language" rather than
  // guessed at.
  const langA = topic.sourceLang ? getLanguage(topic.sourceLang) : undefined;
  const langB = getLanguage(topic.targetLang);
  const written = topic.writeLang ? getLanguage(topic.writeLang) : undefined;
  if (!langA || !langB) {
    return NextResponse.json({ error: "source_required" }, { status: 400 });
  }
  const sourceLang = written ?? langA;
  const targetLang = sourceLang.code === langA.code ? langB : langA;

  // One pass over the account: the per-request length cap and the charge used
  // to be two calls, each re-reading and re-writing the same row.
  const charge = await chargeChars(identity, text.length);
  if (charge === "too_long") {
    return NextResponse.json({ error: "text_too_long" }, { status: 413 });
  }
  if (charge === "insufficient") {
    return NextResponse.json({ error: "insufficient_credits" }, { status: 402 });
  }

  // last 6 turns, oldest first, for conversational consistency
  const recent = (
    await prisma.translation.findMany({
      where: { topicId },
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
    run({ emit, identity, topicId, hasTitle: !!topic.title, sourceLang, targetLang, text, recent, signal: req.signal }),
  );
}

/**
 * The streaming half of the route: translate, report, and settle the account.
 *
 * Runs after the response has already started, so every failure has to be
 * reported as an `error` frame rather than a status code — and anything that
 * produced no translation is refunded here, which is also the rule the
 * pre-stream half relies on for the turns it never charged.
 */
async function run(params: {
  emit: Emit;
  identity: Identity;
  topicId: string;
  hasTitle: boolean;
  sourceLang: Language;
  targetLang: Language;
  text: string;
  recent: RecentTurn[];
  signal: AbortSignal;
}): Promise<void> {
  const { emit, identity, topicId, hasTitle, sourceLang, targetLang, text, recent, signal } = params;
  const chargedChars = text.length;
  let translation = "";
  // Once the turn is in the database it belongs to the visitor: a failure
  // afterwards (drawing it on screen, updating the topic row) must not hand
  // back quota they have already spent on a translation they now own.
  let persisted = false;

  try {
    // The transcript is the input itself now — the model is no longer asked to
    // echo it — so the widget can show what is being translated immediately.
    emit("transcript", { text });
    for await (const delta of translateStream(sourceLang, targetLang, text, recent, signal)) {
      translation += delta;
      emit("delta", { text: delta });
    }

    if (!translation.trim()) {
      // Nothing was produced, so nothing should have been paid for.
      await refundChars(identity, chargedChars);
      emit("error", { error: "not_recognized" });
      return;
    }

    const row = await prisma.translation.create({
      data: {
        topicId,
        sourceLang: sourceLang.code,
        transcript: text,
        translation,
      },
    });
    persisted = true;
    await prisma.topic.update({
      where: { id: topicId },
      data: {
        lastUsedAt: new Date(),
        ...(hasTitle ? {} : { title: text.slice(0, 40) }),
      },
    });

    emit("done", {
      id: row.id,
      source_lang: sourceLang.code,
      transcript: text,
      translation,
    });
  } catch (err: unknown) {
    // Whatever arrived before the failure is discarded with it: half a
    // translation is not a turn the visitor paid for or wants in their history.
    if (!persisted) await refundChars(identity, chargedChars);
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
