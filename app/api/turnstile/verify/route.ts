import { NextResponse } from "next/server";
import { resolveIdentity } from "@/lib/auth";
import {
  PASS_TTL_SECONDS,
  TURNSTILE_PASS_COOKIE,
  issuePass,
  requiresTurnstile,
  verifyTurnstileToken,
} from "@/lib/turnstile";
import { allowRequest } from "@/lib/rate-limit";

export const runtime = "nodejs";

// Exchange a solved Turnstile token for the short-lived pass cookie the
// translate endpoints check (see lib/turnstile.ts).
export async function POST(req: Request) {
  const identity = await resolveIdentity(req);
  if (!identity) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // One solve buys a 30-minute pass, so a caller asking far more often than
  // that is grinding fresh passes, not using the product.
  if (!allowRequest("turnstile", identity.rateKey)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  // Signed-in accounts are never challenged — report the pass as already
  // held so the client doesn't try to render a widget for them.
  if (!requiresTurnstile(identity)) return NextResponse.json({ ok: true });

  const body = await req.json().catch(() => ({}));
  const token = typeof body.token === "string" ? body.token : "";
  const ok = await verifyTurnstileToken(token, req);
  if (!ok) return NextResponse.json({ error: "turnstile_failed" }, { status: 400 });

  const res = NextResponse.json({ ok: true, ttl: PASS_TTL_SECONDS });
  res.cookies.set(TURNSTILE_PASS_COOKIE, issuePass(req), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: PASS_TTL_SECONDS,
  });
  return res;
}
