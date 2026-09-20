import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveIdentity, type Identity } from "@/lib/auth";
import { hasValidPass, requiresTurnstile } from "@/lib/turnstile";
import { Language, getLanguage } from "@/lib/languages";
import { chargeChars, chargeSeconds, refundChars, refundSeconds } from "@/lib/credits";
import { transcribe, SttError } from "@/lib/stt";
import { translateStream, type RecentTurn } from "@/lib/translate";
import { LlmError } from "@/lib/llm";
import { allowRequest } from "@/lib/rate-limit";
import { Emit, sseResponse } from "@/lib/sse";
import { MAX_AUDIO_BYTES, parseWav } from "@/lib/wav";

export const runtime = "nodejs";
export const maxDuration = 300;

// One-shot voice flow: audio in -> STT -> translation -> saved turn, answered
// as a stream. Charges seconds for the STT leg and characters for the
// translation of the transcript (the same split the pricing math assumes), and
// refunds both legs whenever the request dies before a turn was stored — the
// seconds used to be gone for good on an empty transcript or an
// out-of-characters account.
//
// The stream sends `transcript` as soon as speech recognition is done, then
// `delta` frames of the translation, then `done` with the stored turn. That
// first frame is the reason voice feels usable on a local model: recognition
// and translation are two engines now, so the visitor sees what was heard
// while the second one is still working.
export async function POST(req: NextRequest) {
  const identity = await resolveIdentity(req);
  if (!identity) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!allowRequest("translate", identity.quotaKey)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  // Anonymous traffic must carry a valid Turnstile pass before anything
  // reaches the engines — checked ahead of credit consumption so a rejected
  // request never burns quota.
  if (requiresTurnstile(identity) && !hasValidPass(req)) {
    return NextResponse.json({ error: "turnstile_required" }, { status: 403 });
  }

  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > MAX_AUDIO_BYTES + 4096) {
    return NextResponse.json({ error: "audio_too_long" }, { status: 413 });
  }

  const form = await req.formData();
  const file = form.get("audio");
  const topicId = String(form.get("topicId") || "");
  if (!(file instanceof Blob)) return NextResponse.json({ error: "no audio" }, { status: 400 });
  if (!topicId) return NextResponse.json({ error: "no topicId" }, { status: 400 });

  const topic = await prisma.topic.findUnique({ where: { id: topicId } });
  if (!topic || topic.ownerKey !== identity.ownerKey) {
    return NextResponse.json({ error: "topic not found" }, { status: 404 });
  }

  // Same direction rule as the text route: the pair is fixed per topic, and
  // `writeLang` (the swap button) says which half is being spoken now.
  const langA = topic.sourceLang ? getLanguage(topic.sourceLang) : undefined;
  const langB = getLanguage(topic.targetLang);
  const written = topic.writeLang ? getLanguage(topic.writeLang) : undefined;
  if (!langA || !langB) {
    return NextResponse.json({ error: "source_required" }, { status: 400 });
  }
  const sourceLang = written ?? langA;
  const targetLang = sourceLang.code === langA.code ? langB : langA;

  const audioBuf = Buffer.from(await file.arrayBuffer());
  if (audioBuf.length > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: "audio_too_long" }, { status: 413 });
  }
  // Duration comes from the container, not from the byte count, and the mime
  // type we hand the engine is ours, not the uploader's.
  const wav = parseWav(audioBuf);
  if (!wav) return NextResponse.json({ error: "bad_audio" }, { status: 400 });

  if ((await chargeSeconds(identity, wav.seconds)) !== "ok") {
    return NextResponse.json({ error: "insufficient_credits" }, { status: 402 });
  }

  // last 6 turns, oldest first, for conversational consistency
  const recent = (
    await prisma.translation.findMany({ where: { topicId }, orderBy: { createdAt: "desc" }, take: 6 })
  )
    .reverse()
    .map((t) => ({
      sourceLang: t.sourceLang,
      transcript: t.transcript,
      translation: t.translation,
    }));

  return sseResponse((emit) =>
    run({
      emit,
      identity,
      topicId,
      hasTitle: !!topic.title,
      sourceLang,
      targetLang,
      audio: audioBuf,
      seconds: wav.seconds,
      recent,
      signal: req.signal,
    }),
  );
}

/**
 * The streaming half: recognise, translate, report, settle the account.
 *
 * Runs after the response has started, so failures are `error` frames instead
 * of status codes — and every path that stored no turn gives back both legs,
 * seconds included (the STT leg is charged before the engine is asked, which
 * is the only way an empty transcript can still be charged for).
 */
async function run(params: {
  emit: Emit;
  identity: Identity;
  topicId: string;
  hasTitle: boolean;
  sourceLang: Language;
  targetLang: Language;
  audio: Buffer;
  seconds: number;
  recent: RecentTurn[];
  signal: AbortSignal;
}): Promise<void> {
  const { emit, identity, topicId, hasTitle, sourceLang, targetLang, audio, seconds, recent, signal } = params;
  let chargedSeconds = seconds;
  let chargedChars = 0;
  let translation = "";
  // Set once the turn is stored: a failure after that point (reporting it,
  // touching the topic row) must not hand back quota for a translation the
  // visitor already owns.
  let persisted = false;

  try {
    // The topic's own language is the hint, and whisper.cpp obeys it either
    // way: a short or noisy recording is exactly where an engine left to guess
    // picks the wrong language, and here there is nothing left to guess.
    const transcript = await transcribe(audio, sourceLang.code, signal);
    if (!transcript) {
      await refundSeconds(identity, chargedSeconds);
      emit("error", { error: "not_recognized" });
      return;
    }
    emit("transcript", { text: transcript });

    const charge = await chargeChars(identity, transcript.length);
    if (charge !== "ok") {
      // The person spoke and is out of characters: give the seconds back and
      // say why, rather than charging for a translation that never ran.
      await refundSeconds(identity, chargedSeconds);
      chargedSeconds = 0;
      emit("error", { error: charge === "too_long" ? "text_too_long" : "insufficient_credits" });
      return;
    }
    chargedChars = transcript.length;

    for await (const delta of translateStream(sourceLang, targetLang, transcript, recent, signal)) {
      translation += delta;
      emit("delta", { text: delta });
    }

    if (!translation.trim()) {
      await refundSeconds(identity, chargedSeconds);
      await refundChars(identity, chargedChars);
      emit("error", { error: "not_recognized" });
      return;
    }

    const row = await prisma.translation.create({
      data: {
        topicId,
        sourceLang: sourceLang.code,
        transcript,
        translation,
      },
    });
    persisted = true;
    await prisma.topic.update({
      where: { id: topicId },
      data: {
        lastUsedAt: new Date(),
        ...(hasTitle ? {} : { title: transcript.slice(0, 40) }),
      },
    });

    emit("done", {
      id: row.id,
      source_lang: sourceLang.code,
      transcript,
      translation,
    });
  } catch (err: unknown) {
    if (!persisted) {
      if (chargedSeconds) await refundSeconds(identity, chargedSeconds);
      if (chargedChars) await refundChars(identity, chargedChars);
    }
    if ((err instanceof LlmError || err instanceof SttError) && err.code === "aborted") {
      console.warn("[translate-voice] client left mid-answer");
      return;
    }
    if (err instanceof SttError) {
      console.error("[translate-voice] stt failed", err.code, err.message);
      emit("error", { error: err.code === "timeout" ? "stt_timeout" : "stt_unavailable" });
      return;
    }
    if (err instanceof LlmError) {
      console.error("[translate-voice] model failed", err.code, err.message);
      emit("error", { error: err.code === "timeout" ? "model_timeout" : "model_unavailable" });
      return;
    }
    console.error("[translate-voice] failed", err);
    emit("error", { error: "server_error" });
  }
}
