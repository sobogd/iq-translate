// Shared "issue a session for a verified email" helper for the OTP email and
// Apple sign-in flows. Reuses translator's existing identity model (email is
// the key — Session and Conversation both hang off it), cookie names and the
// readable signed-in hint, exactly like the Google callback does.
import { prisma } from "./prisma";
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  generateSessionToken,
  hashSessionToken,
} from "./auth";
import { SIGNED_IN_COOKIE } from "./cookies";
import { trackServerEvent } from "./analytics/server-event";
import { mergeAnonymousHistory } from "./merge-conversations";

export type CookieSetter = {
  cookies: {
    set: (name: string, value: string, options: Record<string, unknown>) => unknown;
  };
};

/** Creates a session row + analytics event and returns the opaque token.
 *  Provider is the analytics name: "Email" | "Apple" | "Google". */
export async function establishSession(req: Request, email: string, provider: string): Promise<string> {
  // Read before the new row is written: no earlier session for this address
  // means this is the very first sign-in, i.e. a registration.
  const priorSessions = await prisma.session.count({ where: { email } });
  const token = generateSessionToken();
  await prisma.session.create({
    data: { email, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
  });
  await trackServerEvent(req.headers, email, {
    page: "Auth",
    action: priorSessions === 0 ? "Register" : "Sign in",
    name: provider,
  });
  // Hand the pre-sign-in anonymous history to the account. Best-effort: a
  // merge failure must not fail the sign-in itself.
  await mergeAnonymousHistory(req, email).catch((err) => {
    console.error("[auth] anonymous history merge failed", err);
  });
  return token;
}

/** Sets the httpOnly session cookie plus its readable signed-in hint twin. */
export function applyAuthCookies(res: CookieSetter, token: string): void {
  const secure = process.env.NODE_ENV === "production";
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 400,
  });
  res.cookies.set(SIGNED_IN_COOKIE, "1", {
    httpOnly: false,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 400,
  });
}
