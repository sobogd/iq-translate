import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveIdentity } from "@/lib/auth";
import { getLanguage } from "@/lib/languages";
import { allowRequest } from "@/lib/rate-limit";

export const runtime = "nodejs";

// Creating a topic costs nothing and required nothing — no Turnstile, no
// quota, no limit — which made it the cheapest way to grow this database from
// the outside. A person accumulates conversations slowly; this is the ceiling
// that only an automated caller ever meets.
const MAX_TOPICS_PER_OWNER = 200;

export async function GET(req: NextRequest) {
  try {
    const identity = await resolveIdentity(req);
    if (!identity) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const topics = await prisma.topic.findMany({
      where: { ownerKey: identity.ownerKey },
      orderBy: { lastUsedAt: "desc" },
      include: { _count: { select: { translations: true } } },
    });
    const result = topics.map((topic) => ({
      id: topic.id,
      title: topic.title,
      sourceLang: topic.sourceLang,
      targetLang: topic.targetLang,
      lastUsedAt: topic.lastUsedAt,
      createdAt: topic.createdAt,
      translationCount: topic._count.translations,
    }));
    return NextResponse.json(result);
  } catch (err: unknown) {
    console.error("[topics] list failed", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

// Always creates a new topic — topics are independent sessions, not keyed
// by language pair.
export async function POST(req: NextRequest) {
  try {
    const identity = await resolveIdentity(req);
    if (!identity) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (!allowRequest("topic", identity.quotaKey)) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    }

    const body = await req.json().catch(() => ({}));
    const targetLang = typeof body.targetLang === "string" ? body.targetLang.trim() : "";
    if (!getLanguage(targetLang)) {
      return NextResponse.json({ error: "unknown language" }, { status: 400 });
    }
    // Required: with auto-detect gone a topic has no way to learn its source
    // language later, so the pair has to be complete when the thread is born.
    const sourceLang = typeof body.sourceLang === "string" ? body.sourceLang.trim() : "";
    if (!getLanguage(sourceLang)) {
      return NextResponse.json({ error: "unknown language" }, { status: 400 });
    }
    if (sourceLang === targetLang) {
      // Same language on both sides would make every translation the input.
      return NextResponse.json({ error: "same_language" }, { status: 400 });
    }

    const existing = await prisma.topic.count({ where: { ownerKey: identity.ownerKey } });
    if (existing >= MAX_TOPICS_PER_OWNER) {
      return NextResponse.json({ error: "too_many_topics" }, { status: 409 });
    }

    // writeLang starts as the source: the person opening the thread types in
    // the language they picked for themselves (see the swap button).
    const topic = await prisma.topic.create({
      data: { ownerKey: identity.ownerKey, targetLang, sourceLang, writeLang: sourceLang },
    });

    return NextResponse.json(topic);
  } catch (err: unknown) {
    console.error("[topics] create failed", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
