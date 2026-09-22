import { NextResponse } from "next/server";
import { OAuth2Client } from "google-auth-library";
import { prisma } from "@/lib/prisma";
import {
  SESSION_COOKIE,
  generateSessionToken,
  getOrigin,
  hashSessionToken,
  isAllowed,
  parseCookie,
  SESSION_TTL_MS,
} from "@/lib/auth";
import { SIGNED_IN_COOKIE } from "@/lib/cookies";
import { trackServerEvent } from "@/lib/analytics/server-event";
import { mergeAnonymousHistory } from "@/lib/merge-conversations";

export const runtime = "nodejs";

const STATE_COOKIE = "translator_oauth_state";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const cookieHeader = req.headers.get("cookie");
  const expectedState = parseCookie(cookieHeader, STATE_COOKIE);

  const origin = getOrigin(req);
  const redirectUri = `${origin}/api/auth/google/callback`;

  // Always clear the single-use state cookie regardless of outcome.
  const bounce = () => {
    const res = NextResponse.redirect(new URL("/", origin), 302);
    res.cookies.set(STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  };

  if (error || !code || !state || !expectedState || state !== expectedState) {
    return bounce();
  }

  try {
    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, redirectUri);
    const { tokens } = await client.getToken(code);
    const idToken = tokens.id_token;
    if (!idToken) return bounce();

    const verifier = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    const ticket = await verifier.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();

    if (!payload?.email || payload.email_verified !== true) {
      return bounce();
    }

    const email = payload.email.trim().toLowerCase();
    if (!isAllowed(email)) {
      return bounce();
    }

    // Read before the new row is written: no earlier session for this address
    // means this is the very first sign-in, i.e. a registration. Sessions are
    // never deleted on logout, so the count survives sign-out/sign-in cycles.
    const priorSessions = await prisma.session.count({ where: { email } });

    const token = generateSessionToken();
    const tokenHash = hashSessionToken(token);
    // Sessions used to be created with `expiresAt: null` — valid forever, so a
    // cookie that leaked once stayed a working credential with no way to age it
    // out. The cookie itself is refreshed on every request (proxy.ts), so an
    // account in daily use never notices the ceiling.
    await prisma.session.create({
      data: { email, tokenHash, expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
    });

    // Awaited, not fired and forgotten: the response is a redirect, and work
    // left running after it may be cut short. It stitches the anonymous visit
    // that led here onto the account, so it has to land on the same visit.
    await trackServerEvent(req.headers, email, {
      page: "Auth",
      action: priorSessions === 0 ? "Register" : "Sign in",
      name: "Google",
    });

    // Hand the pre-sign-in anonymous history to the account. Best-effort: a
    // merge failure must not fail the sign-in itself.
    await mergeAnonymousHistory(req, email).catch((err) => {
      console.error("[auth] anonymous history merge failed", err);
    });

    const res = NextResponse.redirect(new URL("/", origin), 302);
    res.cookies.set(STATE_COOKIE, "", { path: "/", maxAge: 0 });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 400,
    });
    // Readable-by-JS twin of the session cookie: carries no credential, only
    // the yes/no the prerendered header needs to paint "Account" instead of
    // "Sign in" on the first frame (see app/_landing/session.tsx).
    res.cookies.set(SIGNED_IN_COOKIE, "1", {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 400,
    });
    return res;
  } catch {
    return bounce();
  }
}
