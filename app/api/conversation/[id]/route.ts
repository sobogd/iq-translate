import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveIdentity } from "@/lib/auth";
import { getLanguage } from "@/lib/languages";

export const runtime = "nodejs";

// Every handler checks ownership against the caller's ownerKey (verified email
// or anonymous cookie) — a conversation and its turns are only reachable by
// whoever created them.

async function owned(req: Request, id: string) {
  const identity = await resolveIdentity(req);
  if (!identity) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const row = await prisma.conversation.findUnique({ where: { id } });
  if (!row || row.ownerKey !== identity.ownerKey) {
    return { error: NextResponse.json({ error: "not found" }, { status: 404 }) };
  }
  return { row };
}

// Persist the writing direction. The pair itself never changes, so a swap only
// moves writeLang to the other half instead of reordering sourceLang/targetLang
// (which would flip every bubble of the history).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const found = await owned(req, id);
    if (found.error) return found.error;
    const { row } = found;

    const body = (await req.json().catch(() => ({}))) as { writeLang?: unknown };
    const writeLang = typeof body.writeLang === "string" ? body.writeLang.trim() : "";
    if (!getLanguage(writeLang) || (writeLang !== row.sourceLang && writeLang !== row.targetLang)) {
      return NextResponse.json({ error: "unknown language" }, { status: 400 });
    }

    const updated = await prisma.conversation.update({ where: { id }, data: { writeLang } });
    return NextResponse.json(updated);
  } catch (err: unknown) {
    console.error("[conversation] update failed", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

// Clear the pair's history. The row stays (it remembers the pair and the
// direction), only the turns go.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const found = await owned(req, id);
    if (found.error) return found.error;

    await prisma.translation.deleteMany({ where: { conversationId: id } });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    console.error("[conversation] clear failed", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
