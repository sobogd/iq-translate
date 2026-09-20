import crypto from "crypto";
import { computeFingerprint, parseCookie, type Identity } from "./auth";
import { SITE_URL } from "./site";

// Cloudflare Turnstile gate for the endpoints that actually do work
// (/api/translate, /api/translate-voice, /api/translate-image). Only anonymous
// identities are challenged: a signed-in account already has a verified Google
// identity and a paid/limited pool behind it, while the free anonymous pool is
// keyed on a fingerprint anyone can rotate by changing IP or User-Agent.
//
// A Turnstile token is single-use and only valid for ~5 minutes, so solving
// on every message would put a challenge round-trip in front of every turn
// of a conversation. Instead one solve is exchanged for a short-lived pass
// cookie (below), and only that cookie is checked per request.

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export const TURNSTILE_PASS_COOKIE = "iqt_ts_pass";

// 30 minutes: long enough that a normal conversation never re-challenges,
// short enough that a stolen cookie is worth little.
export const PASS_TTL_SECONDS = 30 * 60;

const SITE_HOST = new URL(SITE_URL).host.split(":")[0];

function secret(): string {
  return process.env.TS_SECRET || "";
}

// Both halves must be configured or the gate stays off entirely — a missing
// secret in some environment must not lock translation out.
export function turnstileEnabled(): boolean {
  return Boolean(process.env.TS_SECRET && process.env.TS_SITE);
}

export function requiresTurnstile(identity: Identity): boolean {
  return turnstileEnabled() && identity.kind === "anonymous";
}

function clientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() || null;
}

/** Cloudflare reports which site the widget actually ran on. Accepting any
 *  hostname would accept a token minted on someone else's page against the
 *  same site key. */
function hostnameAllowed(hostname: string | undefined): boolean {
  if (!hostname) return false;
  if (hostname === SITE_HOST) return true;
  return (
    process.env.NODE_ENV !== "production" &&
    (hostname === "localhost" || hostname === "127.0.0.1" || hostname.startsWith("192.168."))
  );
}

export async function verifyTurnstileToken(token: string, req: Request): Promise<boolean> {
  if (!token || !secret()) return false;
  const form = new URLSearchParams({ secret: secret(), response: token });
  const ip = clientIp(req);
  if (ip) form.set("remoteip", ip);
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as {
      success?: boolean;
      hostname?: string;
      "error-codes"?: string[];
    };
    if (data.success !== true) {
      // Reused/expired tokens and a wrong secret all look the same from the
      // outside; the codes are the only way to tell them apart later.
      console.warn("[turnstile] rejected", data["error-codes"]);
      return false;
    }
    if (!hostnameAllowed(data.hostname)) {
      console.warn("[turnstile] foreign hostname", data.hostname);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

// Pass value: "<expiry-ms>.<hmac>", signed over the request's own fingerprint
// — the cookie is worthless from another IP/UA/language combination, so it
// can't be handed around to bypass the challenge.
//
// The signing key is DERIVED from TS_SECRET rather than being TS_SECRET: one
// secret doing two unrelated jobs (talking to Cloudflare, signing our own
// cookie) is how a leak in one place quietly becomes a forgery in the other.
let passKey: Buffer | null = null;
let passKeyFor = "";
function signingKey(): Buffer {
  const s = secret();
  if (!passKey || passKeyFor !== s) {
    passKey = crypto.createHmac("sha256", s).update("iqt-turnstile-pass-v1").digest();
    passKeyFor = s;
  }
  return passKey;
}

function sign(fingerprint: string, expiresAt: number): string {
  return crypto.createHmac("sha256", signingKey()).update(`${fingerprint}.${expiresAt}`).digest("hex");
}

export function issuePass(req: Request): string {
  const expiresAt = Date.now() + PASS_TTL_SECONDS * 1000;
  const fingerprint = computeFingerprint(req.headers);
  return `${expiresAt}.${sign(fingerprint, expiresAt)}`;
}

export function hasValidPass(req: Request): boolean {
  const raw = parseCookie(req.headers.get("cookie"), TURNSTILE_PASS_COOKIE);
  if (!raw) return false;
  const dot = raw.indexOf(".");
  if (dot === -1) return false;
  const expiresAt = Number(raw.slice(0, dot));
  const mac = raw.slice(dot + 1);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;
  const expected = sign(computeFingerprint(req.headers), expiresAt);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
