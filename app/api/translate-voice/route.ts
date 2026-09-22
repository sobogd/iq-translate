import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveIdentity } from "@/lib/auth";
import { hasValidPass, requiresTurnstile } from "@/lib/turnstile";
import { Language, getLanguage, whisperCode } from "@/lib/languages";
import { transcribe, SttError } from "@/lib/stt";
import { translateStream, type RecentTurn } from "@/lib/translate";
import { LlmError } from "@/lib/llm";
import { allowRequest } from "@/lib/rate-limit";
import { Emit, sseResponse } from "@/lib/sse";
import { MAX_AUDIO_BYTES, parseWav } from "@/lib/wav";

export const runtime = "nodejs";
export const maxDuration = 300;

// One-shot voice flow: audio in -> STT -> translation -> saved turn, answered
// as a stream. Nothing is metered any more, so the only walls are the rate
// limit and the bot gate.
//
// The stream sends `transcript` as soon as speech recognition is done, then
// `delta` frames of the translation, then `done` with the stored turn. That
// first frame is the reason voice feels usable on a local model: recognition
// and translation are two engines, so the visitor sees what was heard while
// the second one is still working.
export async function POST(req: NextRequest) {
  const identity = await resolveIdentity(req);
  if (!identity) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!allowRequest("translate", identity.rateKey)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  // Anonymous traffic must carry a valid Turnstile pass before anything
  // reaches the engines.
  if (requiresTurnstile(identity) && !hasValidPass(req)) {
    return NextResponse.json({ error: "turnstile_required" }, { status: 403 });
  }

  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > MAX_AUDIO_BYTES + 4096) {
    return NextResponse.json({ error: "audio_too_long" }, { status: 413 });
  }

  const form = await req.formData();
  const file = form.get("audio");
  const conversationId = String(form.get("conversationId") || "");
  if (!(file instanceof Blob)) return NextResponse.json({ error: "no audio" }, { status: 400 });
  if (!conversationId) return NextResponse.json({ error: "no conversationId" }, { status: 400 });

  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!conversation || conversation.ownerKey !== identity.ownerKey) {
    return NextResponse.json({ error: "conversation not found" }, { status: 404 });
  }

  // Same direction rule as the text route: the pair is fixed per conversation,
  // and `writeLang` (the swap button) says which half is being spoken now.
  const langA = getLanguage(conversation.sourceLang);
  const langB = getLanguage(conversation.targetLang);
  const written = getLanguage(conversation.writeLang);
  if (!langA || !langB || !written) {
    return NextResponse.json({ error: "source_required" }, { status: 400 });
  }
  const sourceLang = written;
  const targetLang = sourceLang.code === langA.code ? langB : langA;

  // The spoken half has to be a language the speech engine knows, and it has to
  // reach the engine under the code the engine files it under (whisper spells
  // Javanese jw and has no nb — see lib/languages.ts). The widget hides the mic
  // for everything else, but this route is reachable on its own — a preset pair
  // from a landing page, a replayed request — and an unknown code is not an
  // error the engine reports: it quietly transcribes into some other language.
  const sttLang = whisperCode(sourceLang.code);
  if (!sttLang) {
    return NextResponse.json({ error: "voice_unsupported" }, { status: 400 });
  }

  const audioBuf = Buffer.from(await file.arrayBuffer());
  if (audioBuf.length > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: "audio_too_long" }, { status: 413 });
  }
  // Duration comes from the container, not from the byte count, and the mime
  // type we hand the engine is ours, not the uploader's.
  const wav = parseWav(audioBuf);
  if (!wav) return NextResponse.json({ error: "bad_audio" }, { status: 400 });

  // last 6 turns, oldest first, for conversational consistency
  const recent = (
    await prisma.translation.findMany({ where: { conversationId }, orderBy: { createdAt: "desc" }, take: 6 })
  )
    .reverse()
    .map((t) => ({
      sourceLang: t.sourceLang,
      transcript: t.transcript,
      translation: t.translation,
    }));

  return sseResponse((emit) =>
    run({ emit, conversationId, sourceLang, targetLang, sttLang, audio: audioBuf, recent, signal: req.signal }),
  );
}

/**
 * The streaming half: recognise, translate, report, store.
 *
 * Runs after the response has started, so failures are `error` frames instead
 * of status codes.
 */
async function run(params: {
  emit: Emit;
  conversationId: string;
  sourceLang: Language;
  targetLang: Language;
  /** Code to hand the speech engine — the app's own code except where the two
   *  spellings differ (see whisperCode in lib/languages.ts). Never null here:
   *  the pre-stream half refuses a language the engine does not know. */
  sttLang: string;
  audio: Buffer;
  recent: RecentTurn[];
  signal: AbortSignal;
}): Promise<void> {
  const { emit, conversationId, sourceLang, targetLang, sttLang, audio, recent, signal } = params;
  let translation = "";

  try {
    // The conversation's own language is the hint, and whisper.cpp obeys it
    // either way: a short or noisy recording is exactly where an engine left to
    // guess picks the wrong language, and here there is nothing left to guess.
    const transcript = await transcribe(audio, sttLang, signal);
    if (!transcript) {
      emit("error", { error: "not_recognized" });
      return;
    }
    emit("transcript", { text: transcript });

    for await (const delta of translateStream(sourceLang, targetLang, transcript, recent, signal)) {
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
        transcript,
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
      transcript,
      translation,
    });
  } catch (err: unknown) {
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
