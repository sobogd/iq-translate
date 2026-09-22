import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveIdentity } from "@/lib/auth";
import { getLanguage } from "@/lib/languages";
import { allowRequest } from "@/lib/rate-limit";
import { maybePrune } from "@/lib/maintenance";

export const runtime = "nodejs";

// The pair a conversation belongs to. Stored in canonical order (smaller code
// first) so en<->es is one row whichever side the visitor writes in; writeLang
// carries the direction separately. That is the whole reason the swap button
// does not have to mirror the history to the other side.
function canonical(source: string, target: string): [string, string] {
  return source < target ? [source, target] : [target, source];
}

const readParam = (v: string | null) => (typeof v === "string" ? v.trim() : "");

// History of one language pair. A pair the visitor never used comes back as a
// synthetic row (id: null, no turns) rather than a 404: the widget renders the
// same shape either way and only creates the row on the first send.
export async function GET(req: NextRequest) {
  try {
    const identity = await resolveIdentity(req);
    if (!identity) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    // Every history read is a chance to run the retention sweep.
    maybePrune();

    const source = readParam(req.nextUrl.searchParams.get("source"));
    const target = readParam(req.nextUrl.searchParams.get("target"));
    if (!getLanguage(source) || !getLanguage(target) || source === target) {
      return NextResponse.json({ error: "unknown language" }, { status: 400 });
    }

    const [sourceLang, targetLang] = canonical(source, target);
    const row = await prisma.conversation.findUnique({
      where: { ownerKey_sourceLang_targetLang: { ownerKey: identity.ownerKey, sourceLang, targetLang } },
      include: { translations: { orderBy: { createdAt: "desc" }, take: 200 } },
    });

    if (!row) {
      return NextResponse.json({
        id: null,
        sourceLang,
        targetLang,
        // No row yet: the side the visitor picked as their own is the one they
        // are about to write in.
        writeLang: source,
        translations: [],
      });
    }
    return NextResponse.json(row);
  } catch (err: unknown) {
    console.error("[conversation] read failed", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

// Get-or-create for a pair. Idempotent: the unique key means a second call for
// the same pair returns the existing row instead of opening a parallel one.
export async function POST(req: NextRequest) {
  try {
    const identity = await resolveIdentity(req);
    if (!identity) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (!allowRequest("topic", identity.rateKey)) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      sourceLang?: unknown;
      targetLang?: unknown;
      writeLang?: unknown;
    };
    const source = typeof body.sourceLang === "string" ? body.sourceLang.trim() : "";
    const target = typeof body.targetLang === "string" ? body.targetLang.trim() : "";
    if (!getLanguage(source) || !getLanguage(target)) {
      return NextResponse.json({ error: "unknown language" }, { status: 400 });
    }
    if (source === target) {
      return NextResponse.json({ error: "same_language" }, { status: 400 });
    }

    const [sourceLang, targetLang] = canonical(source, target);
    // writeLang is the caller's chosen writing side; it must be one of the pair.
    const requestedWrite = typeof body.writeLang === "string" ? body.writeLang.trim() : "";
    const writeLang = requestedWrite === source || requestedWrite === target ? requestedWrite : source;

    const row = await prisma.conversation.upsert({
      where: { ownerKey_sourceLang_targetLang: { ownerKey: identity.ownerKey, sourceLang, targetLang } },
      create: { ownerKey: identity.ownerKey, sourceLang, targetLang, writeLang },
      update: {},
    });
    return NextResponse.json(row);
  } catch (err: unknown) {
    console.error("[conversation] create failed", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
