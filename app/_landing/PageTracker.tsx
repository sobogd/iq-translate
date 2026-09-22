"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { analytics, isValidPageLabel, searchReferrerHost, type TrackCtx } from "@/lib/analytics";
import { sectionLabel } from "@/lib/track-sections";

// Pageview + scroll tracking for one route. Mounted once per page by
// SessionProvider, which every page component already wraps around itself.
//
// Ported from iq-rest (apps/landing/app/_landing/components/page-tracker.tsx),
// including the allowlisted ad/campaign capture: like iq-rest's landing tracker,
// this one keeps gclid/fbclid/… click ids and utm_* campaign params out of a
// fresh URL and sends them as visit attribution (the server stores only those
// keys, never the rest of the query string).

const FROM_REGEX = /^[A-Za-z0-9_.-]{1,64}$/;

// Click-id params the analytics server keeps as attribution (mirrors the
// server-side allowlist — anything else in the query never leaves the page).
const CLICK_ID_KEYS = new Set(["gclid", "gbraid", "wbraid", "fbclid", "msclkid", "yclid"]);
// UTM keys accepted by the server: utm_ + 1..24 lowercase alphanumerics or _.
const UTM_KEY_RE = /^utm_[a-z0-9_]{1,24}$/i;
// Server caps: 16 params total, click-id values up to 512 chars, utm values up
// to 256 chars, param names up to 32 chars (UTM_KEY_RE already bounds names).
const Q_MAX_KEYS = 16;
const Q_MAX_CLICK_ID = 512;
const Q_MAX_UTM = 256;

// Document-scoped (not pageview-scoped) facts. They describe the visit, not the
// route, so re-sending them on every client-side navigation would inflate the
// counts without adding information. Module scope is exactly the lifetime we
// want: reset on a real document load, kept across soft navigations.
let documentCtxSent = false;

/** Collect visit attribution (?from=, search referrer, colour scheme), then
 *  strip the ENTIRE query string so a reload does not re-send it. Must run
 *  before any other tracking on the page. */
function collectCtxAndCleanUrl(): { ctx?: TrackCtx } {
  const ctx: TrackCtx = {};
  const sp = new URLSearchParams(window.location.search);

  const from = sp.get("from");
  if (from && FROM_REGEX.test(from)) ctx.from = from;

  // Allowlisted ad/campaign params (?gclid=, ?utm_source=, …) — the paid-click
  // and campaign equivalent of ?from=. Values stay RAW: the server validates
  // shape and length, so do not lower-case or sanitize here.
  const q: Record<string, string> = {};
  for (const [key, value] of sp) {
    if (Object.keys(q).length >= Q_MAX_KEYS) break;
    if (CLICK_ID_KEYS.has(key)) {
      if (value.length <= Q_MAX_CLICK_ID) q[key] = value;
    } else if (UTM_KEY_RE.test(key) && value.length <= Q_MAX_UTM) {
      q[key] = value;
    }
  }
  if (Object.keys(q).length > 0) ctx.q = q;

  const ref = searchReferrerHost();
  if (ref) ctx.ref = ref;
  if (window.matchMedia) {
    ctx.theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  if ([...sp.keys()].length > 0) {
    // Preserve the existing state object. Passing a fresh {} overwrites the App
    // Router's internal history state, and Back onto this entry then finds
    // nothing to restore and falls back to a full document reload.
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname + window.location.hash,
    );
  }
  return { ctx: Object.keys(ctx).length > 0 ? ctx : undefined };
}

/** A `?from=` or an allowlisted click-id / utm_* param only ever comes from a
 *  fresh entry URL, so seeing one means a genuinely new attribution — worth
 *  sending even mid-visit. `ref` is derived from document.referrer, which
 *  survives soft navigations and would otherwise re-attribute the visit on
 *  every route change. */
function hasFreshAttribution(ctx: TrackCtx): boolean {
  return Boolean(ctx.from || (ctx.q && Object.keys(ctx.q).length > 0));
}

/** How long the page must sit still before a scroll counts as finished. Long
 *  enough to ride out momentum scrolling on a phone, short enough that two
 *  deliberate swipes are two events. */
const SCROLL_SETTLE_MS = 500;
/** Hard cap per pageview. Someone flicking up and down a long page produces
 *  real transitions, but not an unbounded number of rows. */
const MAX_SCROLL_EVENTS = 40;

/**
 * Scroll as movement between sections: every time the page settles somewhere
 * new, one event — "Scroll down" / "Scroll up" for the action, the section it
 * came to rest on for the name.
 *
 * Direction is the action rather than part of the name so the two can be
 * counted separately, and only the destination is named: the section it left is
 * the destination of the event before it.
 */
function createScrollTracker() {
  let settled: string | null = null;
  let settledY = 0;
  let sent = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  /** The active content scroller. The page is pinned at 100dvh; content lives
   *  in the window's single scroll area (.page-scroll) or in the legacy
   *  single-scroll window (.window-scroll) on product-less pages. The
   *  document itself never scrolls; fall back to its metrics only for a
   *  standalone surface (the 404, which does not run this tracker anyway). */
  const scroller = (): { el: HTMLElement | null; scrollTop: number; clientHeight: number } => {
    const el = document.querySelector<HTMLElement>(".page-scroll, .window-scroll");
    if (el) return { el, scrollTop: el.scrollTop, clientHeight: el.clientHeight };
    return { el: null, scrollTop: window.scrollY, clientHeight: window.innerHeight };
  };

  /** The section the viewport is looking at = the one containing its middle.
   *  Using the centre rather than the top edge keeps the answer stable while a
   *  section boundary drifts past the top of the window. */
  const currentSection = (): string | null => {
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-section]")).filter(
      (el) => el.dataset.section,
    );
    if (els.length === 0) return null;
    const { el: con, scrollTop, clientHeight } = scroller();
    const conTop = con ? con.getBoundingClientRect().top : 0;
    const topOf = (el: HTMLElement) => el.getBoundingClientRect().top - conTop + scrollTop;

    // At the very bottom, name the last section outright. A short closing band
    // never reaches the middle of the screen, so the centre rule alone would
    // report the block above it as the end of every scroll to the end.
    const scrollHeight = con ? con.scrollHeight : Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
    if (scrollTop + clientHeight >= scrollHeight - 2) {
      const last = els[els.length - 1].dataset.section;
      return last ? sectionLabel(last) : null;
    }

    const centre = scrollTop + clientHeight / 2;
    let best: string | null = null;
    let bestTop = -Infinity;
    for (const el of els) {
      const top = topOf(el);
      if (top > centre) continue;
      // Sections are laid out in document order, but a nested one can appear
      // later with a smaller top — take the lowest section that starts above
      // the centre.
      if (top > bestTop) {
        bestTop = top;
        best = sectionLabel(el.dataset.section!);
      }
    }
    // Scrolled above the first section (rubber-banding, sticky header offset).
    return best ?? sectionLabel(els[0].dataset.section!);
  };

  const settle = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    // A modal locks the window's scroll (lib/scroll-lock.ts sets overflow:
    // hidden on the scrollers), which collapses the scrollable height while
    // scrollTop keeps its old value — the bottom-of-page rule above would
    // then read as "reached the end" from wherever the visitor happened to
    // be. Nothing done inside a modal is a scroll gesture.
    const con = document.querySelector<HTMLElement>(".page-scroll, .window-scroll");
    if (con?.style.overflow === "hidden") return;
    const now = currentSection();
    const y = scroller().scrollTop;
    if (!now) return;
    if (settled && now !== settled && sent < MAX_SCROLL_EVENTS) {
      sent += 1;
      analytics.track(y >= settledY ? "Scroll down" : "Scroll up", now);
    }
    settled = now;
    settledY = y;
  };

  /** Called on every (coalesced) scroll frame: restart the settle countdown. */
  const onMove = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(settle, SCROLL_SETTLE_MS);
  };

  /** Where the visitor entered the page — an anchor link or a restored position
   *  means that is not necessarily the top. */
  const begin = () => {
    settled = currentSection();
    settledY = scroller().scrollTop;
  };

  /** The pageview is ending: close any scroll still in flight and push it out.
   *
   *  The flush is not optional. The transport registers its own pagehide /
   *  visibilitychange handlers when the module loads, i.e. BEFORE this
   *  component mounts, so on the way out it drains the queue first and an event
   *  queued here would sit on a document that is already gone. */
  const finish = () => {
    settle();
    analytics.flush();
  };

  return { begin, onMove, finish };
}

/** Page label with a guaranteed-valid result — an empty or malformed one is
 *  rejected by the server per-batch, taking every unrelated event in the batch
 *  down with it. */
function toPageLabel(page: string): string {
  return isValidPageLabel(page) ? page : "Home";
}

export function PageTracker({ page }: { page: string }) {
  // Keyed on the real pathname, not on `page`: many routes share a page key
  // (every locale home is "Home", every pair page is "Pair"), and a `page`-only
  // dependency would skip the second pageview and leave the scroll listener
  // measuring the unmounted route.
  const pathname = usePathname();

  useEffect(() => {
    analytics.setPage(toPageLabel(page));
    analytics.setLocale(document.documentElement.lang || "");

    const { ctx } = collectCtxAndCleanUrl();
    const attribution = ctx && (!documentCtxSent || hasFreshAttribution(ctx)) ? ctx : undefined;
    documentCtxSent = true;
    // The pageview carries the attribution ctx — the server applies it to the
    // visit first-write-wins. Instant: it must not sit out the 2s buffer — a
    // quick bounce would lose the whole visit, and the response carries the
    // visit token every later batch wants.
    analytics.track("Show", "Pageview", attribution, { instant: true });

    const scroll = createScrollTracker();
    scroll.begin();
    // rAF-coalesced: a scroll fires dozens of events per second, and there is no
    // point restarting the settle countdown more than once per frame.
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        scroll.onMove();
      });
    };
    // Scroll events do not bubble, so listen on document in the capture phase
    // to catch the window's internal scroller (.window-scroll) regardless of
    // which element actually scrolls.
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    // Three exits, and all three are needed. On mobile a tab is usually swiped
    // away or backgrounded, which fires visibilitychange and often no pagehide
    // at all; desktop link-outs fire pagehide; a soft navigation fires neither
    // and only unmounts.
    const onHide = () => {
      if (document.visibilityState === "hidden") scroll.finish();
    };
    window.addEventListener("pagehide", scroll.finish);
    document.addEventListener("visibilitychange", onHide);
    // Back-navigation restores the page from bfcache: the document is reused, so
    // this effect never re-runs and the return visit would otherwise leave no
    // trace at all. The attribution ctx is deliberately not re-sent — the visit
    // already carries it.
    const onShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      analytics.setPage(toPageLabel(page));
      analytics.setLocale(document.documentElement.lang || "");
      analytics.track("Show", "Pageview", undefined, { instant: true });
      scroll.begin();
    };
    window.addEventListener("pageshow", onShow);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener("scroll", onScroll, { capture: true } as EventListenerOptions);
      window.removeEventListener("pagehide", scroll.finish);
      window.removeEventListener("pageshow", onShow);
      document.removeEventListener("visibilitychange", onHide);
      scroll.finish();
    };
  }, [page, pathname]);

  return null;
}
