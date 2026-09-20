import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveIdentity } from "@/lib/auth";
import { hasValidPass, requiresTurnstile } from "@/lib/turnstile";
import { getLanguage } from "@/lib/languages";
import { chargeImage, refundImage } from "@/lib/credits";
import { allowRequest } from "@/lib/rate-limit";
import { ocrImage, composeImage, OcrError } from "@/lib/image-ocr";
import { saveTranslatedImage, translatedImageUrl } from "@/lib/translated-image";
import { translateImageBlocks } from "@/lib/translate";

export const runtime = "nodejs";
export const maxDuration = 60;

// Image translation: photo in -> OCR sidecar (text + pixel boxes) -> text-only
// calls to the local model for per-block translations -> blocks with
// normalized geometry back to the client, which pastes the translated text
// into the image itself.
//
// Quota is PER PHOTO, not per character (one image = one unit of the
// imagesBalance pool) — a screenshot must never be refused because its
// recognized text would be "too long for the text plan". Costs are bounded
// two ways instead: the OCR input is capped (bytes, pixels, line count) and
// MAX_IMAGE_TEXT_CHARS below stops one image from ever feeding an unbounded
// prompt to the model.
//
// Two modes:
//  * topicId given (widget flow) — behaves like /api/translate-voice: reads
//    the pair and the current direction from the topic, sets the title on the
//    first turn and persists a translation row so the turn lands in the chat
//    history. The response still carries the block geometry for the caller.
//  * topicId absent (external-server flow) — stateless: targetLang is
//    required (sourceLang is an optional hint) and the response is the blocks
//    payload only.

const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // matches sidecar OCR_MAX_BYTES
const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "image/jpeg",
  "image/png": "image/png",
  "image/webp": "image/webp",
};
// Safety ceiling on what a single image may feed the model: the whole batch
// has to fit the window (see lib/llm-limits.ts) on top of the OCR sidecar's
// own limits. Real screenshots/photos are far below it.
const MAX_IMAGE_TEXT_CHARS = 12000;

export async function POST(req: NextRequest) {
  const identity = await resolveIdentity(req);
  if (!identity) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!allowRequest("translate", identity.quotaKey)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  // Anonymous traffic must carry a valid Turnstile pass before anything
  // reaches the OCR sidecar or the model.
  if (requiresTurnstile(identity) && !hasValidPass(req)) {
    return NextResponse.json({ error: "turnstile_required" }, { status: 403 });
  }

  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > MAX_IMAGE_BYTES + 4096) {
    return NextResponse.json({ error: "image_too_large" }, { status: 413 });
  }

  // One photo per request, charged like voice charges its seconds: up front,
  // handed back whenever the request dies between charging and a result.
  let charged = false;
  try {
    const form = await req.formData();
    const file = form.get("image");
    const topicId = String(form.get("topicId") || "");
    const targetLangCode = String(form.get("targetLang") || "");
    const sourceLangCode = String(form.get("sourceLang") || "");
    const recLang = String(form.get("recLang") || "").trim() || undefined;

    if (!(file instanceof Blob) || !file.type || !ALLOWED_MIME[file.type]) {
      return NextResponse.json({ error: "bad_image" }, { status: 400 });
    }

    // Resolve the direction. A topicId wins (its pair and writeLang decide,
    // exactly like voice); otherwise the caller must declare targetLang (and
    // may hint sourceLang) — the stateless mode used by external renderers,
    // where a photo is translated into a language without any conversation.
    let topic: { id: string; ownerKey: string; sourceLang: string | null; writeLang: string | null; targetLang: string; title: string | null } | null = null;
    let targetLang = getLanguage(targetLangCode);
    let sourceLang: ReturnType<typeof getLanguage> | null = sourceLangCode ? getLanguage(sourceLangCode) ?? null : null;

    if (topicId) {
      topic = await prisma.topic.findUnique({ where: { id: topicId } });
      if (!topic || topic.ownerKey !== identity.ownerKey) {
        return NextResponse.json({ error: "topic not found" }, { status: 404 });
      }
      const langA = topic.sourceLang ? getLanguage(topic.sourceLang) : undefined;
      const langB = getLanguage(topic.targetLang);
      if (!langA || !langB) {
        return NextResponse.json({ error: "source_required" }, { status: 400 });
      }
      const written = topic.writeLang ? getLanguage(topic.writeLang) : undefined;
      sourceLang = written ?? langA;
      targetLang = sourceLang.code === langA.code ? langB : langA;
    } else if (!targetLang) {
      return NextResponse.json({ error: "no targetLang" }, { status: 400 });
    }

    const imageBuf = Buffer.from(await file.arrayBuffer());
    if (imageBuf.length > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "image_too_large" }, { status: 413 });
    }

    const charge = await chargeImage(identity);
    if (charge === "insufficient") {
      return NextResponse.json({ error: "insufficient_credits" }, { status: 402 });
    }
    charged = true;

    const ocr = await ocrImage(imageBuf, ALLOWED_MIME[file.type], recLang);

    // Filter FIRST so texts and blocks stay index-aligned for the translation
    // pass below (the sidecar already filters by confidence).
    const kept = ocr.blocks.filter((b) => b.text.trim().length > 0);
    const texts = kept.map((b) => b.text.trim());
    if (texts.length === 0) {
      await refundImage(identity);
      charged = false;
      return NextResponse.json({ error: "not_recognized" }, { status: 422 });
    }
    const detectedChars = texts.reduce((n, t) => n + t.length, 0);
    if (detectedChars > MAX_IMAGE_TEXT_CHARS) {
      // Refund and refuse: one image must not be able to bill a huge prompt.
      await refundImage(identity);
      charged = false;
      return NextResponse.json({ error: "text_too_long" }, { status: 413 });
    }

    // The direction is decided before the model is asked (see the pair
    // resolution above) — there is no detection left to do here, and none is
    // wanted: a model that has to name the language of a photo AND translate
    // it does both worse.
    const translations = await translateImageBlocks(targetLang, texts, sourceLang);
    if (translations.every((t) => !t)) {
      // Model returned nothing at all — nothing was translated, refund.
      await refundImage(identity);
      charged = false;
      return NextResponse.json({ error: "not_recognized" }, { status: 422 });
    }

    // Normalized 0..1 geometry against the *processed* image (width/height
    // below); the client scales to its own copy of the photo.
    const blocks = kept.map((b, i) => {
      const [x0, y0, x1, y1] = b.box;
      return {
        id: i,
        text: b.text.trim(),
        translation: translations[i] ?? "",
        confidence: b.confidence,
        polygon: b.polygon.map(([x, y]) => [x / ocr.width, y / ocr.height]),
        box: [x0 / ocr.width, y0 / ocr.height, x1 / ocr.width, y1 / ocr.height],
      };
    });
    // Same normalized polygons the sidecar's /compose needs to paint back in
    // the identical processed space.
    const normPolygons = blocks.map((b) => b.polygon);

    const payload: Record<string, unknown> = {
      width: ocr.width,
      height: ocr.height,
      recLang: ocr.recLang,
      blocks,
    };

    if (topic) {
      // Persist one conversation turn so the image send shows up in the chat
      // history like text/voice sends do. Transcript and translation are the
      // block texts joined line-by-line, so the lines stay aligned 1:1.
      const transcript = texts.join("\n");
      const row = await prisma.translation.create({
        data: {
          topicId: topic.id,
          sourceLang: sourceLang?.code ?? "und",
          transcript,
          translation: translations.join("\n"),
        },
      });
      await prisma.topic.update({
        where: { id: topic.id },
        data: {
          lastUsedAt: new Date(),
          ...(topic.title ? {} : { title: transcript.slice(0, 40) }),
        },
      });
      payload.id = row.id;

      // Repaint the photo: erase the original text, draw the translations.
      // Optional layer — if compose/disk fails the turn still persists as a
      // text message and the error is only logged.
      try {
        const jpeg = await composeImage(
          imageBuf,
          ocr.width,
          ocr.height,
          kept.map((b, i) => ({
            polygon: normPolygons[i] as [number, number][],
            translation: translations[i] ?? "",
          })),
        );
        await saveTranslatedImage(topic.id, row.id, jpeg);
        const imageUrl = translatedImageUrl(topic.id, row.id);
        await prisma.translation.update({
          where: { id: row.id },
          data: { imageUrl },
        });
        payload.imageUrl = imageUrl;
      } catch (composeErr) {
        console.error("[translate-image] compose failed — turn saved without image", composeErr);
      }
    }

    return NextResponse.json(payload);
  } catch (err: unknown) {
    if (charged) {
      await refundImage(identity);
      charged = false;
    }
    if (err instanceof OcrError) {
      console.error("[translate-image] ocr failed", err.code, err.message);
      // Forward the sidecar's 4xx (bad rec_lang / oversized / unreadable
      // image); anything else means the sidecar itself is down.
      if (err.status >= 400 && err.status < 500) {
        return NextResponse.json({ error: "bad_image" }, { status: err.status });
      }
      return NextResponse.json({ error: "ocr_unavailable" }, { status: 503 });
    }
    console.error("[translate-image] failed", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
