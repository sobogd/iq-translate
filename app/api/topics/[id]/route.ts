import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveIdentity } from "@/lib/auth";
import { getLanguage } from "@/lib/languages";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const identity = await resolveIdentity(req);
    if (!identity) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const { id } = await params;
    const topic = await prisma.topic.findUnique({
      where: { id },
      include: {
        translations: { orderBy: { createdAt: "desc" }, take: 100 },
      },
    });
    if (!topic || topic.ownerKey !== identity.ownerKey) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json(topic);
  } catch (err: unknown) {
    console.error("[topics] request failed", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

// Manual language override: set sourceLang (before or after auto-detect
// locked it) and/or change targetLang for this topic going forward.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const identity = await resolveIdentity(req);
    if (!identity) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const { id } = await params;
    const topic = await prisma.topic.findUnique({ where: { id } });
    if (!topic || topic.ownerKey !== identity.ownerKey) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    const body = await req.json();
    const data: { sourceLang?: string | null; targetLang?: string; writeLang?: string | null } = {};
    if (body.sourceLang === null) {
      // Explicit reset of the A side. Nothing detects it again (auto-detect is
      // gone), so the topic stays unusable until the client sets one — the
      // route answers `source_required` meanwhile.
      data.sourceLang = null;
      data.writeLang = null;
    } else if (typeof body.sourceLang === "string") {
      if (!getLanguage(body.sourceLang)) {
        return NextResponse.json({ error: "unknown language" }, { status: 400 });
      }
      data.sourceLang = body.sourceLang;
    }
    if (typeof body.targetLang === "string") {
      if (!getLanguage(body.targetLang)) {
        return NextResponse.json({ error: "unknown language" }, { status: 400 });
      }
      data.targetLang = body.targetLang;
    }
    // The direction the visitor is typing in now — flipped by the swap button.
    // Must be one of the topic's two languages, or the next translation would
    // go to a third one.
    if (typeof body.writeLang === "string") {
      if (!getLanguage(body.writeLang)) {
        return NextResponse.json({ error: "unknown language" }, { status: 400 });
      }
      const pair = [data.sourceLang ?? topic.sourceLang, data.targetLang ?? topic.targetLang];
      if (!pair.includes(body.writeLang)) {
        return NextResponse.json({ error: "unknown language" }, { status: 400 });
      }
      data.writeLang = body.writeLang;
    }

    const updated = await prisma.topic.update({ where: { id }, data });
    return NextResponse.json(updated);
  } catch (err: unknown) {
    console.error("[topics] request failed", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const identity = await resolveIdentity(req);
    if (!identity) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const { id } = await params;
    const topic = await prisma.topic.findUnique({ where: { id } });
    if (!topic || topic.ownerKey !== identity.ownerKey) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    await prisma.topic.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    console.error("[topics] request failed", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
