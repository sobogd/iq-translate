"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { analytics } from "@/lib/analytics";
import { lockScroll } from "@/lib/scroll-lock";
import { useMounted, useVisualViewport } from "./Modal";

// Client half of the Turnstile gate (server half: lib/turnstile.ts). The
// widget is rendered explicitly and in "execute" mode with the
// interaction-only appearance: nothing is visible until Cloudflare actually
// decides this visitor needs to interact, so the normal case stays a silent
// background check right before the first message.
//
// One solve buys a pass cookie good for PASS_TTL_SECONDS, so `ensurePass`
// is a no-op for the rest of the conversation.

const SCRIPT_ID = "cf-turnstile-script";
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  execute: (id: string) => void;
  reset: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

// The script is shared by every widget on the page; resolve once and reuse.
let scriptPromise: Promise<TurnstileApi | null> | null = null;

function loadScript(): Promise<TurnstileApi | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve) => {
    const done = () => resolve(window.turnstile ?? null);
    const existing = document.getElementById(SCRIPT_ID);
    if (existing) {
      existing.addEventListener("load", done);
      existing.addEventListener("error", () => resolve(null));
      return;
    }
    const el = document.createElement("script");
    el.id = SCRIPT_ID;
    el.src = SCRIPT_SRC;
    el.async = true;
    el.defer = true;
    el.onload = done;
    el.onerror = () => resolve(null);
    document.head.appendChild(el);
  });
  return scriptPromise;
}

export type TurnstileGate = {
  /** Attach point for the challenge container — the overlay centres it. */
  attachContainer: (el: HTMLDivElement | null) => void;
  /** True while Cloudflare is showing an interactive challenge. */
  interactive: boolean;
  /** True once the request may go out. Solves a challenge if needed. */
  ensurePass: () => Promise<boolean>;
  /** Forget the local pass after the server reported it expired. */
  invalidatePass: () => void;
};

export function useTurnstileGate(siteKey: string | null, enabled: boolean): TurnstileGate {
  const containerElRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  // Raised by Cloudflare's interactive callbacks and turned into the blurred
  // overlay below — this is the only signal that the visitor now has something
  // to click, since interaction-only widgets stay invisible until then.
  const [interactive, setInteractive] = useState(false);
  // Resolver of the solve currently in flight — Turnstile hands the token
  // back through a callback, not a promise.
  const pendingRef = useRef<((token: string | null) => void) | null>(null);
  // Local mirror of the httpOnly pass cookie's expiry, kept a little shorter
  // than the server's TTL so a request is never sent against a pass that
  // expires in flight.
  const passUntilRef = useRef(0);

  const containerRef = useCallback((el: HTMLDivElement | null) => {
    containerElRef.current = el;
  }, []);

  const invalidatePass = useCallback(() => {
    passUntilRef.current = 0;
  }, []);

  const solve = useCallback(async (): Promise<string | null> => {
    const api = await loadScript();
    const container = containerElRef.current;
    if (!api || !container || !siteKey) return null;

    const settle = (token: string | null) => {
      // Every terminal callback (error/timeout/expired/success) means the
      // challenge is over, so the overlay must come down even if Cloudflare
      // never fires after-interactive-callback (it does not on a timeout).
      setInteractive(false);
      const resolve = pendingRef.current;
      pendingRef.current = null;
      resolve?.(token);
    };

    return new Promise<string | null>((resolve) => {
      pendingRef.current = resolve;
      try {
        if (widgetIdRef.current === null) {
          widgetIdRef.current = api.render(container, {
            sitekey: siteKey,
            execution: "execute",
            appearance: "interaction-only",
            callback: (token: string) => settle(token),
            "error-callback": () => settle(null),
            "timeout-callback": () => settle(null),
            "expired-callback": () => settle(null),
            "before-interactive-callback": () => setInteractive(true),
            "after-interactive-callback": () => setInteractive(false),
          });
        } else {
          // A token is single-use: reset before asking for the next one.
          api.reset(widgetIdRef.current);
        }
        api.execute(widgetIdRef.current);
      } catch {
        settle(null);
      }
    });
  }, [siteKey]);

  const ensurePass = useCallback(async (): Promise<boolean> => {
    if (!enabled || !siteKey) return true;
    if (Date.now() < passUntilRef.current) return true;
    // Only the solves that actually happen are worth an event — the cached-pass
    // path above is the common case and says nothing.
    analytics.track("Show", "Turnstile check");
    const token = await solve();
    if (!token) {
      analytics.track("Show", "Turnstile failed");
      return false;
    }
    try {
      const res = await fetch("/api/turnstile/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        analytics.track("Show", "Turnstile rejected");
        return false;
      }
      const data = (await res.json()) as { ttl?: number };
      const ttl = typeof data.ttl === "number" ? data.ttl : 0;
      // Expire the local pass a minute early — see passUntilRef.
      passUntilRef.current = Date.now() + Math.max(0, ttl - 60) * 1000;
      analytics.track("Show", "Turnstile passed");
      return true;
    } catch {
      analytics.track("Show", "Turnstile failed");
      return false;
    }
  }, [enabled, siteKey, solve]);

  return { attachContainer: containerRef, interactive, ensurePass, invalidatePass };
}

/**
 * Full-screen shell for the interactive challenge: a blurred backdrop with the
 * widget centred on it, instead of the challenge squeezing into the composer
 * row next to the text field.
 *
 * The container is mounted for the lifetime of the page, not only while the
 * challenge shows: Turnstile destroys a widget when its container unmounts, and
 * the gate reuses one widget across solves. While hidden it paints nothing at
 * all — a backdrop-filter blurs its backdrop even at opacity 0, so the blur
 * class only exists in the interactive state. Portaled to <body> for the same
 * reason the modal is (see Modal.tsx): no ancestor transform may trap a fixed
 * overlay.
 */
export function TurnstileOverlay({ gate }: { gate: TurnstileGate }) {
  // This component renders on the server too, where a portal has no DOM to
  // target — the flag reads false through hydration and true afterwards.
  const mounted = useMounted();
  const box = useVisualViewport();
  const { interactive, attachContainer } = gate;

  // Frozen page scroll behind the challenge, released when it comes down —
  // same contract as the modal shell.
  useEffect(() => {
    if (!interactive) return;
    return lockScroll();
  }, [interactive]);

  if (!mounted) return null;

  return createPortal(
    <div
      className={`fixed left-0 top-0 z-[60] flex w-full items-center justify-center p-4 transition-opacity duration-200 ${
        interactive ? "bg-black/40 opacity-100 backdrop-blur-sm" : "pointer-events-none opacity-0"
      } ${box ? "" : "h-full"}`}
      style={
        box
          ? { height: box.height, transform: `translate(${box.left}px, ${box.top}px)` }
          : undefined
      }
      aria-hidden={!interactive}
      // Hidden the challenge must not be reachable by Tab either — the
      // interaction-only widget keeps its iframe mounted while invisible.
      inert={!interactive}
    >
      {/* The card the modal shell would draw around a title, minus the
          title: the widget carries Cloudflare's own localised copy. */}
      <div
        className="rounded-2xl border p-4 shadow-xl"
        style={{ background: "var(--card)", borderColor: "var(--border)" }}
      >
        <div ref={attachContainer} />
      </div>
    </div>,
    document.body,
  );
}
