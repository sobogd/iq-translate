"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { ArrowLeftRight, ArrowUp, BookOpen, ChevronDown, Image as ImageIcon, Loader2, Mic, Plus, Square, Trash2, Type, X } from "lucide-react";
import { WavRecorder } from "@/lib/recorder";
import { History } from "@/components/History";
import { apiFetch, readSse } from "@/lib/client";
import type { Topic, TopicDetail } from "@/lib/types";
import { LANGUAGES, getLanguage, supportsVoice } from "@/lib/languages";
import { Modal } from "./Modal";
import { LAYOUT_GAP } from "./desktop/layout";
import { QUOTA_EVENT, useSession } from "./session";
import { PAIR_COOKIE, formatPairCookie, parsePairCookie, readCookieValue } from "@/lib/cookies";
import { analytics } from "@/lib/analytics";
import { useTurnstileGate } from "./Turnstile";
import type { TranslatorTexts } from "./types";

// Pre-cookie storage of the target half. Only read now, as a one-time
// migration for visitors who picked a language before PAIR_COOKIE existed.
const TO_KEY = "translator_to_lang";
// How long a remembered pair lives (see PAIR_COOKIE) — same ceiling as the
// session/locale cookies.
const PAIR_MAX_AGE = 400 * 86400;
const rememberPair = (source: string, target: string) => {
  document.cookie = `${PAIR_COOKIE}=${formatPairCookie(source, target)}; path=/; max-age=${PAIR_MAX_AGE}; samesite=lax`;
};
// Last thread the visitor had open, restored on the next visit to the same
// pair page (the topic list itself is fetched after hydration — every page
// here is prerendered, so nothing personalized exists during render).
const LAST_TOPIC_KEY = "iqt_last_topic";
const rememberTopic = (id: string) => {
  try {
    localStorage.setItem(LAST_TOPIC_KEY, id);
  } catch {
    /* private mode — the list still opens, just without the memory */
  }
};
// Turnstile's public site key. Inlined at build time (NEXT_PUBLIC_*) instead
// of read on the server, so the pages stay statically prerendered — the
// secret half (TS_SECRET) never leaves lib/turnstile.ts.
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TS_SITE ?? null;
const DEFAULT_TO = "es";
// The other half of that default. There is no auto-detect any more, so a page
// that seeds only its target still needs a source to open with: English is the
// language most visitors need translated, and on the English site itself the
// pair falls back to DEFAULT_TO so the two halves never collide.
const DEFAULT_FROM = "en";

// Seed pair of a freshly mounted widget: exactly one half may be missing (a
// locale home seeds the target only) and the two halves must differ — a pair
// of one language would make every translation the input. The guessed half is
// always the source: pages seed the target deliberately, so when the two
// collide it is the source that moves.
function seedPair(source: string | null, target: string): { source: string; target: string } {
  const fallback = target === DEFAULT_FROM ? DEFAULT_TO : DEFAULT_FROM;
  const from = source && source !== target ? source : fallback;
  return { source: from, target };
}

// Every browser on iOS is WebKit (Safari's engine is mandatory there), and
// WebKit treats the on-screen keyboard as an overlay: it does NOT shrink the
// layout viewport — which is exactly why the widget pane is sized from the
// *visual* viewport via --app-vh (see Taskbar). The flip side is that WebKit
// scrolls a focused field into view by itself, and that scroll fights the
// pane's keyboard-driven shrink (see the focus guard effect in <Translator>).
const IS_IOS =
  typeof navigator !== "undefined" &&
  (/iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

// OCR recognition engine for a photo, guessed from what we know about the
// text it likely contains: the topic's locked source, or failing that the
// target (a user translating INTO a Cyrillic language most often photographs
// Latin text, and vice versa). The sidecar defaults to "cyrillic", which also
// reads English — this only widens coverage for Latin-source photos.
const CYRILLIC_CODES = new Set(["ru", "uk", "be", "bg", "sr", "mk"]);
function guessRecLang(sourceCode: string | null | undefined, targetCode: string): string {
  if (sourceCode) return CYRILLIC_CODES.has(sourceCode) ? "cyrillic" : "latin";
  return CYRILLIC_CODES.has(targetCode) ? "latin" : "cyrillic";
}

type RecStatus = "idle" | "recording" | "processing";
type WidgetTexts = TranslatorTexts["translator"];

/** Why getUserMedia() failed, so the mic modal can say what actually happened
 *  and analytics can split the one "Mic denied" event into its real causes. */
type MicErrorKind = "blocked" | "notfound" | "busy" | "insecure" | "unknown";

/** Error codes reach the name field, which the server validates against a
 *  tight character set — anything unexpected would take the whole batch down
 *  with it, so clamp here.
 *
 *  A message with nothing ASCII in it (a browser's own localised network
 *  error, say) used to survive as a row of underscores — every such failure
 *  then looked identical in the analytics and said nothing about its cause.
 *  Those are reported as "unknown" instead. */
function trackError(code: string): string {
  const slug = code.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 40);
  return /[A-Za-z0-9]/.test(slug) ? slug : "unknown";
}

// Server routes answer with opaque codes: printing an unrecognised one used to
// mean printing whatever the server threw (Prisma messages included), and the
// one hardcoded Russian string reached every locale untranslated.
function friendlyError(code: string, texts: WidgetTexts): string {
  const e = texts.errors;
  if (code === "insufficient_credits") return e.insufficientCredits;
  if (code === "text_too_long" || code === "audio_too_long") return e.textTooLong;
  if (code === "turnstile_required" || code === "turnstile_failed") return e.turnstileFailed;
  if (code === "not_recognized" || code === "bad_audio") return e.notRecognized;
  if (code === "rate_limited") return e.rateLimited;
  return e.generic;
}

/** Classify a getUserMedia() rejection. The permissions API is the
 *  authoritative "the user blocked it" signal; the error name only narrows
 *  hardware vs permission for the rest. A missing navigator.mediaDevices or an
 *  explicit SecurityError means no secure context (http://) — the silent killer
 *  that masquerades as a plain "Mic denied". */
async function classifyMicError(err: unknown): Promise<MicErrorKind> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return "insecure";
  }
  const name = err instanceof Error ? err.name : typeof err === "string" ? err : "";
  try {
    const st = await navigator.permissions.query({ name: "microphone" });
    if (st.state === "denied") return "blocked";
  } catch {
    // permissions.query unsupported (older Safari) or rejects the name.
  }
  // NotAllowedError: the permission-prompt dismissal — covered again above when
  // the permissions API is available, this is the fallback path.
  if (name === "NotAllowedError") return "blocked";
  if (name === "SecurityError") return "insecure";
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") {
    return "notfound";
  }
  if (name === "NotReadableError") return "busy";
  return "unknown";
}

// The analytics event keeps saying "denied" for the blocked case so the
// existing funnel doesn't split; the rarer causes get their own name.
function micErrorEvent(kind: MicErrorKind): string {
  if (kind === "blocked") return "Mic denied";
  if (kind === "notfound") return "Mic not-found";
  if (kind === "busy") return "Mic busy";
  if (kind === "insecure") return "Mic insecure";
  return "Mic unknown";
}

function micErrorTitle(t: WidgetTexts, kind: MicErrorKind): string {
  if (kind === "blocked") return t.micBlockedTitle;
  if (kind === "notfound") return t.micNotFound;
  if (kind === "busy") return t.micBusy;
  if (kind === "insecure") return t.micInsecure;
  return t.micGeneric;
}

function matchesQuery(l: { nameRu: string; nameNative: string }, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return l.nameRu.toLowerCase().includes(needle) || l.nameNative.toLowerCase().includes(needle);
}

// Language picker: a full-screen blurred modal.
// Everything behind is blurred (no dimming). Centred is one column of two
// rows, 8px apart: the search field on top and a 400px-tall scrollable list
// of languages below — both on the same background as the content panels.
// There is no header/close button; a click on the blurred background closes.
function LanguagePickerModal({
  current,
  texts,
  onClose,
  onSelect,
}: {
  current: string | null;
  texts: WidgetTexts;
  onClose: () => void;
  onSelect: (code: string) => void;
}) {
  const [query, setQuery] = useState("");
  const list = LANGUAGES.filter((l) => matchesQuery(l, query));
  // The currently active language always jumps to the first row (whether the
  // picker opened for source or target).
  const ordered = useMemo(() => {
    const cur = current;
    if (!cur) return list;
    const idx = list.findIndex((l) => l.code === cur);
    if (idx <= 0) return list;
    const copy = list.slice();
    copy.unshift(copy.splice(idx, 1)[0]);
    return copy;
  }, [list, current]);

  // Rendered IN PLACE of the conversation panel, with the same height: a
  // search block on top and a scrollable list below — no modal, no backdrop,
  // no blur, nothing else. Picking a language returns to the chat.
  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-2">
      {/* Search block — same height (h-12) and surface as the message input,
          with a bare close icon on the right (no border/background). */}
      <div className="flex h-12 shrink-0 items-center gap-2 rounded-lg bg-[var(--window-bg)] px-2">
        <input
          type="search"
          inputMode="search"
          enterKeyHint="search"
          name="language-search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          data-lpignore="true"
          data-1p-ignore
          data-bwignore
          data-form-type="other"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
          placeholder={texts.searchPlaceholder}
          className="min-w-0 flex-1 bg-transparent px-2 text-base leading-6 outline-none placeholder:text-hint"
        />
        <button
          type="button"
          onClick={onClose}
          aria-label={texts.close}
          title={texts.close}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-hint transition-colors hover:text-text active:scale-90"
        >
          <X size={16} />
        </button>
      </div>

      {/* Language list — fills the remaining height of the panel. Every
          language is offered in both pickers, including whatever is selected
          on the other side: a colliding pick swaps the pair instead of being
          hidden (see selectSource/selectTarget). */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-lg bg-[var(--window-bg)] p-2">
        {ordered.map((l) => (
          <button
            key={l.code}
            type="button"
            onClick={() => onSelect(l.code)}
            className={`flex w-full items-center px-2 py-2 text-left text-sm transition-colors hover:bg-accent ${
              l.code === current ? "font-semibold text-text" : "text-text/80"
            }`}
          >
            <span className="min-w-0 flex-1 truncate">{l.nameNative}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function Translator({
  texts,
  presetSource,
  presetTarget,
  initialTarget,
  initialSource = null,
  pricingHref = "/pricing",
}: {
  texts: TranslatorTexts;
  /** Seed source language for the draft pair (pair pages pass the page's
   *  own pair). Only an initial value — the pair is always switchable. */
  presetSource?: string;
  /** Seed target language (pair pages); wins over localStorage on mount. */
  presetTarget?: string;
  /** Soft default target (locale homes/pricing/legal): initial value only. */
  initialTarget?: string;
  /** Source half of the pair for pages that seed only a target (locale homes).
   *  Both halves are always concrete: auto-detect is gone, so a page that
   *  seeds nothing gets English here and DEFAULT_TO as the target. */
  initialSource?: string | null;
  /** Locale-local pricing path for the out-of-quota error link. */
  pricingHref?: string;
}) {
  const t = texts.translator;
  // Signed-in visitors are never bot-challenged (see lib/turnstile.ts).
  const { signedIn, quota } = useSession();
  // Seeded pair, normalised once — the two states below are then edited
  // independently (and the cookie/localStorage may replace both on mount).
  const seed = seedPair(presetSource ?? initialSource ?? null, presetTarget ?? initialTarget ?? DEFAULT_TO);
  const [defaultTarget, setDefaultTarget] = useState(seed.target);
  const [topics, setTopics] = useState<Topic[]>([]);
  // Only pair pages auto-open a thread (the matching one, fetched below);
  // home always starts as a blank draft. A topic only ever lands there once
  // the user actually sends something in this session (see
  // translateText/stopRec), so the hero picker never ends up showing some
  // unrelated pair.
  const [topic, setTopic] = useState<TopicDetail | null>(null);
  // Language the visitor writes in before a topic exists yet — carried into
  // the topic created on first send, and mirrored by the swap button.
  const [draftSourceLang, setDraftSourceLang] = useState(seed.source);
  const [loadingTopic, setLoadingTopic] = useState(true);
  const [pickerFor, setPickerFor] = useState<"source" | "target" | null>(null);
  const [topicsOpen, setTopicsOpen] = useState(false);
  const [text, setText] = useState("");
  const [textBusy, setTextBusy] = useState(false);
  // Turn being generated right now — drawn in the thread while the stream
  // fills it, and dropped as soon as the stored row arrives (see
  // translateText/stopRec and the pending prop of History).
  const [pending, setPending] = useState<{ transcript: string; translation: string } | null>(null);
  const [status, setStatus] = useState<RecStatus>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [micError, setMicError] = useState<MicErrorKind | null>(null);
  const [quotaModal, setQuotaModal] = useState(false);
  // Remaining voice seconds, fetched when recording starts — the ticking
  // timer stops the mic the moment the free/plan pool would run out.
  const secondsLeftRef = useRef<number | null>(null);
  // Attachment context menu (composer) + the in-flight image translation.
  const [attachOpen, setAttachOpen] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const attachFileRef = useRef<HTMLInputElement>(null);
  const composerIslandRef = useRef<HTMLDivElement>(null);

  // Bot gate in front of the endpoints that occupy the engine. Anonymous
  // only: an account's requests are never challenged server-side, so the
  // widget script isn't even loaded for them.
  const { containerRef: turnstileRef, ensurePass, invalidatePass } = useTurnstileGate(
    TURNSTILE_SITE_KEY,
    !signedIn,
  );

  const recRef = useRef<WavRecorder | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // A seeded pair (SEO pair pages) wins over the remembered pair — reading
    // it again here would only overwrite the same values after hydration.
    if (presetTarget) return;
    const stored = parsePairCookie(readCookieValue(PAIR_COOKIE));
    // one-time init from storage, not a render cascade.
    if (stored) {
      // A cookie written while auto-detect still existed has no source half;
      // seedPair fills it in rather than leaving the widget without one.
      const pair = seedPair(stored.source, stored.target);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDefaultTarget(pair.target);
       
      setDraftSourceLang(pair.source);
      return;
    }
    const saved = localStorage.getItem(TO_KEY);
     
    if (saved) setDefaultTarget(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadTopics = useCallback(async () => {
    const res = await apiFetch("/api/topics");
    if (res.ok) setTopics(await res.json());
  }, []);

  // Opens a thread. A row created while auto-detect still existed can carry no
  // source language — such a thread is empty by definition (the first
  // translation is what used to lock the source), so it is quietly given the
  // pair the visitor has in front of them instead of being shown a picker for
  // a conversation that never happened.
  const loadTopic = useCallback(
    async (id: string) => {
      const res = await apiFetch(`/api/topics/${id}`);
      if (!res.ok) return;
      const loaded = (await res.json()) as TopicDetail;
      if (loaded.sourceLang) {
        setTopic(loaded);
        return;
      }
      const fixed = await apiFetch(`/api/topics/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceLang: draftSourceLang, targetLang: defaultTarget, writeLang: draftSourceLang }),
      });
      setTopic(fixed.ok ? ((await fixed.json()) as TopicDetail) : { ...loaded, sourceLang: draftSourceLang });
    },
    [draftSourceLang, defaultTarget],
  );

  // Drops a topic that was created for a send that then failed — without this
  // every failed first attempt left an empty thread behind in the list (see
  // the discardIfCreated calls in translateText/stopRec).
  const discardTopic = useCallback(
    async (id: string) => {
      try {
        await apiFetch(`/api/topics/${id}`, { method: "DELETE" });
      } catch {
        /* the thread stays in the list; not worth a second error on screen */
      }
      setTopic(null);
      setTopics((prev) => prev.filter((tp) => tp.id !== id));
    },
    [],
  );

  // Creates a topic and returns its id — the only place a session actually
  // gets written. Called lazily, from translateText, on the first send.
  const createTopic = useCallback(
    async (targetLang: string, sourceLang?: string | null) => {
      const res = await apiFetch("/api/topics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetLang, ...(sourceLang ? { sourceLang } : {}) }),
      });
      const created = await res.json();
      if (!res.ok) throw new Error(created.error || "error");
      await loadTopics();
      await loadTopic(created.id);
      rememberTopic(created.id as string);
      return created.id as string;
    },
    [loadTopics, loadTopic],
  );

  // bootstrap once: open the most recently used topic. No topics yet? Stay
  // in draft state (topic=null) — a session is only created once the user
  // actually sends something to translate, not just for opening the page.
  useEffect(() => {
    (async () => {
      setLoadingTopic(true);
      try {
        const res = await apiFetch("/api/topics");
        const list: Topic[] = res.ok ? await res.json() : [];
        setTopics(list);
        // History is global across all pairs. Restore the last thread the
        // visitor had open if it still exists, otherwise start with a blank
        // draft (a thread is only created once something is actually sent).
        let remembered: string | null = null;
        try {
          remembered = localStorage.getItem(LAST_TOPIC_KEY);
        } catch {
          /* private mode */
        }
        const match = remembered ? (list.find((tp) => tp.id === remembered) ?? null) : null;
        if (match) await loadTopic(match.id);
      } catch {
        setTopic(null);
      } finally {
        setLoadingTopic(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keep the newest turn in view — the chat column is its own scroll box now
  // (fixed-height desktop layout), not page content, so it scrolls itself.
  const turnCount = topic?.translations?.length ?? 0;
  const chatMounted = !pickerFor;
  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [turnCount, topic?.id, chatMounted]);

  async function switchTopic(id: string) {
    analytics.track("Click", "Topic switch");
    rememberTopic(id);
    setText("");
    setPending(null);
    setError(null);
    setLoadingTopic(true);
    await loadTopic(id);
    setLoadingTopic(false);
  }

  // No API call — just clears the view back to a draft. The topic itself
  // is only created once the user actually sends something (translateText).
  function newTopic() {
    analytics.track("Click", "Topic new");
    setTopic(null);
    setText("");
    setPending(null);
    setError(null);
  }

  async function deleteTopic(id: string) {
    if (!confirm(t.deleteTopicConfirm)) return;
    analytics.track("Click", "Topic delete");
    await apiFetch(`/api/topics/${id}`, { method: "DELETE" });
    const remaining = topics.filter((tp) => tp.id !== id);
    setTopics(remaining);
    if (id === topic?.id) {
      // History is global: the next thread in the list takes over.
      const next = remaining[0];
      if (next) {
        setLoadingTopic(true);
        try {
          await loadTopic(next.id);
        } finally {
          setLoadingTopic(false);
        }
      } else {
        setTopic(null);
      }
    }
  }

  // Both pickers list every language, including the one already selected on
  // the other side. The two halves of a pair must differ (there is no
  // auto-detect to fall back on), so picking the language that already sits on
  // the other side swaps them instead of hiding the option.
  //
  // Only ever triggered from the hero picker (home) — always resets to a
  // fresh draft, never mutates whatever topic happens to be loaded.
  function selectSource(code: string) {
    analytics.track("Click", `Language source ${code}`);
    setPickerFor(null);
    setTopic(null);
    if (code === defaultTarget) {
      setDraftSourceLang(defaultTarget);
      setDefaultTarget(draftSourceLang);
      rememberPair(defaultTarget, draftSourceLang);
      return;
    }
    rememberPair(code, defaultTarget);
    setDraftSourceLang(code);
  }

  function selectTarget(code: string) {
    analytics.track("Click", `Language target ${code}`);
    setPickerFor(null);
    setTopic(null);
    if (code === draftSourceLang) {
      setDraftSourceLang(defaultTarget);
      setDefaultTarget(draftSourceLang);
      rememberPair(defaultTarget, draftSourceLang);
      return;
    }
    setDefaultTarget(code);
    rememberPair(draftSourceLang, code);
  }

  // Direction of the pair the visitor is looking at: the half they write in.
  // The conversation's A side (topic.sourceLang) never moves — that is what
  // the chat bubbles align by — while this follows the swap button.
  const direction = topic ? (topic.writeLang ?? topic.sourceLang ?? draftSourceLang) : draftSourceLang;
  const directionTarget = topic
    ? direction === topic.sourceLang
      ? topic.targetLang
      : (topic.sourceLang ?? defaultTarget)
    : defaultTarget;

  // Caps at 3 lines: leading-6 (24px) × 3 + the textarea's own py-2.5 (20px).
  // One line is 44px — the resting height of the field — and the island adds
  // its p-1.5 and border on top of that. Anything longer grows the island.
  const TEXTAREA_MAX_H = 96;

  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  // Remaining-quota counters that sit, always visible, at the bottom of the
  // chat pane (below the scroll, above the composer). SSR-safe placeholders
  // mirror the old header counters: the numbers replace them once /api/quota
  // lands. Photo translations are the newest of the three — there used to be
  // no counter for them at all.
  const quotaImages = quota ? (typeof quota.images === "number" ? quota.images.toLocaleString() : "–") : "–";
  const quotaSeconds = quota ? fmtTime(quota.seconds) : "–:––";
  const quotaChars = quota ? quota.chars.toLocaleString() : "–";

  // Language pair of whatever is about to be sent, as one locale-stable token
  // ("es-en") — the analytics name, never a translated label. It follows the
  // current direction, so a swapped thread reports the swap.
  const trackPair = () => `${direction}-${directionTarget}`;

  // Swap button between the two language blocks. In a draft it just exchanges
  // the halves; in a thread it persists the new writing direction on the topic
  // (writeLang) rather than exchanging sourceLang/targetLang, which would flip
  // every bubble of the history to the other side.
  async function swapDirection() {
    analytics.track("Click", "Language swap");
    setPickerFor(null);
    if (!topic) {
      setDraftSourceLang(directionTarget);
      setDefaultTarget(direction);
      rememberPair(directionTarget, direction);
      return;
    }
    const writeLang = directionTarget;
    // Shown immediately; the PATCH below only has to make it survive a reload.
    setTopic({ ...topic, writeLang });
    const res = await apiFetch(`/api/topics/${topic.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ writeLang }),
    });
    if (!res.ok) {
      // Fall back to what the server still believes rather than showing a
      // direction the next message will not use.
      setTopic(topic);
      setError(t.errors.generic);
    }
    rememberPair(topic.sourceLang ?? draftSourceLang, topic.targetLang);
  }

  function autosize() {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_H)}px`;
  }

  async function translateText() {
    if (!text.trim() || textBusy) return;
    setAttachOpen(false);
    const pair = trackPair();
    analytics.track("Click", "Send text");
    setError(null);
    setTextBusy(true);
    // Text stays in the input while busy (not cleared up front) — that's
    // what keeps the composer CTA showing its spinner instead of falling
    // back to the mic icon (showSend needs non-empty text).
    const sent = text;
    // Set only when this send is what created the thread — a failure then has
    // to take it back out again, or the list fills up with empty threads.
    let createdId: string | null = null;
    try {
      // First send with no topic yet: create one now, carrying over
      // whatever source/target were picked in draft state.
      if (!(await ensurePass())) throw new Error("turnstile_failed");
      if (!topic) createdId = await createTopic(directionTarget, direction);
      const topicId = topic?.id ?? (createdId as string);
      const send = () =>
        apiFetch("/api/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: sent, topicId }),
        });
      let res = await send();
      // The pass cookie expired between the local check and the request:
      // solve once more and resend rather than surfacing an error.
      if (res.status === 403) {
        invalidatePass();
        if (!(await ensurePass())) throw new Error("turnstile_failed");
        res = await send();
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "error");
      }

      // The answer arrives as a stream: the input shows up as its own turn
      // immediately, the translation fills in token by token. Everything after
      // the status check is a frame — including a failure, because by then the
      // response has already started.
      let failure: string | null = null;
      let streamed = "";
      await readSse(res, ({ event, data }) => {
        const payload = (data ?? {}) as { text?: string; error?: string };
        if (event === "transcript") {
          setPending({ transcript: payload.text ?? sent, translation: "" });
        } else if (event === "delta") {
          streamed += payload.text ?? "";
          setPending((prev) => (prev ? { ...prev, translation: streamed } : prev));
        } else if (event === "error") {
          failure = payload.error ?? "error";
        }
      });
      if (failure) throw new Error(failure);

      setText("");
      requestAnimationFrame(autosize);
      analytics.track("Translate", `Text ${pair}`);
      // The stored turn replaces the streamed one only once it is really in
      // the thread, so the text never blinks out between the two.
      await loadTopic(topicId);
      setPending(null);
      await loadTopics();
      window.dispatchEvent(new Event(QUOTA_EVENT));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error";
      setPending(null);
      if (createdId) await discardTopic(createdId);
      if (msg === "insufficient_credits") setQuotaModal(true);
      else {
        analytics.track("Show", `Translate error text: ${trackError(msg)}`);
        setError(friendlyError(msg, t));
      }
    } finally {
      setTextBusy(false);
    }
  }

  // Photo -> OCR -> translation -> one persisted chat turn, exactly like the
  // voice flow: creates the topic on first send, reloads it afterwards, and
  // refunds nothing client-side — the route only charges for detected text.
  async function sendImage(file: File) {
    analytics.track("Click", "Attach image");
    setError(null);
    setAttachOpen(false);
    setImageBusy(true);
    let createdId: string | null = null;
    try {
      if (!(await ensurePass())) throw new Error("turnstile_failed");
      if (!topic) createdId = await createTopic(directionTarget, direction);
      const topicId = topic?.id ?? (createdId as string);
      const fd = new FormData();
      fd.append("image", file);
      fd.append("topicId", topicId);
      // Tell the OCR engine which script it is about to read.
      fd.append(
        "recLang",
        guessRecLang(direction, directionTarget),
      );
      const send = () => apiFetch("/api/translate-image", { method: "POST", body: fd });
      let res = await send();
      // The pass cookie expired between the local check and the request:
      // solve once more and resend rather than surfacing an error.
      if (res.status === 403) {
        invalidatePass();
        if (!(await ensurePass())) throw new Error("turnstile_failed");
        res = await send();
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "error");
      analytics.track("Translate", `Image ${trackPair()}`);
      await loadTopic(topicId);
      await loadTopics();
      window.dispatchEvent(new Event(QUOTA_EVENT));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error";
      // Nothing was translated, so the thread this send just opened is empty.
      if (createdId) await discardTopic(createdId);
      if (msg === "insufficient_credits") setQuotaModal(true);
      else {
        analytics.track("Show", `Translate error image: ${trackError(msg)}`);
        setError(friendlyError(msg, t));
      }
    } finally {
      setImageBusy(false);
    }
  }

  function onAttachFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void sendImage(file);
    // Allow re-picking the same file next time.
    e.target.value = "";
  }

  async function startRec() {
    analytics.track("Click", "Mic start");
    setAttachOpen(false);
    setError(null);
    setMicError(null);
    try {
      const res = await apiFetch("/api/quota");
      if (res.ok) {
        const q = await res.json();
        secondsLeftRef.current = typeof q.seconds === "number" ? q.seconds : null;
        if (q.seconds <= 0) {
          setQuotaModal(true);
          return;
        }
      }
    } catch {
      secondsLeftRef.current = null;
    }
    try {
      const rec = new WavRecorder();
      await rec.start();
      recRef.current = rec;
      setStatus("recording");
      // Solve while the user is still speaking — by the time the recording
      // is sent the pass is usually already there.
      void ensurePass();
    } catch (e) {
      // Don't lump every failure into one "denied": say what actually broke
      // and give the user a way to fix it (see classifyMicError).
      const kind = await classifyMicError(e);
      analytics.track("Show", micErrorEvent(kind));
      setMicError(kind);
    }
  }

  // Re-run the whole start flow. The browser will NOT reopen the permission
  // prompt (that only happens the first time per site), so retrying just
  // re-probes getUserMedia: once the user actually allows the mic in the
  // browser's site settings, the next retry succeeds and recording starts.
  function retryMic() {
    setMicError(null);
    void startRec();
  }

  // Stop = send: the recording goes straight through STT + translation in
  // one request (no intermediate editable transcript step).
  async function stopRec(auto = false) {
    const rec = recRef.current;
    if (!rec) return;
    const pair = trackPair();
    analytics.track("Click", auto ? "Mic auto-stop (quota reached)" : "Mic stop");
    setStatus("processing");
    let createdId: string | null = null;
    try {
      const blob = await rec.stop();
      recRef.current = null;
      if (!(await ensurePass())) throw new Error("turnstile_failed");
      if (!topic) createdId = await createTopic(directionTarget, direction);
      const topicId = topic?.id ?? (createdId as string);
      const fd = new FormData();
      fd.append("audio", blob, "speech.wav");
      fd.append("topicId", topicId);
      const send = () => apiFetch("/api/translate-voice", { method: "POST", body: fd });
      let res = await send();
      if (res.status === 403) {
        invalidatePass();
        if (!(await ensurePass())) throw new Error("turnstile_failed");
        res = await send();
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "error");
      }

      // Recognising speech and translating it are two engines on the Mac, so
      // the transcript arrives on its own frame and is shown while the
      // translation is still being generated.
      let failure: string | null = null;
      let streamed = "";
      await readSse(res, ({ event, data }) => {
        const payload = (data ?? {}) as { text?: string; error?: string };
        if (event === "transcript") {
          setPending({ transcript: payload.text ?? "", translation: "" });
        } else if (event === "delta") {
          streamed += payload.text ?? "";
          setPending((prev) => (prev ? { ...prev, translation: streamed } : prev));
        } else if (event === "error") {
          failure = payload.error ?? "error";
        }
      });
      if (failure) throw new Error(failure);

      analytics.track("Translate", `Voice ${pair}`);
      await loadTopic(topicId);
      setPending(null);
      await loadTopics();
      window.dispatchEvent(new Event(QUOTA_EVENT));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error";
      setPending(null);
      // Nothing was transcribed, so the thread this send just opened is empty.
      if (createdId) await discardTopic(createdId);
      if (msg === "insufficient_credits") setQuotaModal(true);
      else {
        analytics.track("Show", `Translate error voice: ${trackError(msg)}`);
        setError(friendlyError(msg, t));
      }
    } finally {
      setStatus("idle");
    }
  }

  useEffect(() => {
    if (status !== "recording") return;
    const start = Date.now();
    // Stop 1s early: the server bills seconds with Math.ceil, so a recording
    // that runs a hair past the quota (30.1s -> 31) would 402 and lose the
    // take. Cutting a second short guarantees the file fits the remaining
    // balance, and the auto-stop SENDS the take (stopRec) instead of dropping
    // it like cancelRec used to.
    let autoStopped = false;
    const tick = setInterval(() => {
      const secs = Math.floor((Date.now() - start) / 1000);
      setElapsed(secs);
      const left = secondsLeftRef.current;
      if (autoStopped) return;
      if (left !== null && secs >= Math.max(1, left - 1)) {
        autoStopped = true;
        void stopRec(true);
      }
    }, 250);
    return () => {
      clearInterval(tick);
      setElapsed(0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Stamp every event fired from here with the conversation it happened in;
  // the server drops the id unless the caller really owns that topic.
  useEffect(() => {
    analytics.setTopic(topic?.id ?? null);
    return () => analytics.setTopic(null);
  }, [topic?.id]);

  // Close the attachment menu on any tap outside the composer island (its own
  // button/menu live inside it; a pointerdown inside keeps it open so the
  // file picker button stays reachable).
  useEffect(() => {
    if (!attachOpen) return;
    const closeOnOutside = (e: PointerEvent) => {
      const node = composerIslandRef.current;
      if (node && e.target instanceof Node && node.contains(e.target)) return;
      setAttachOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutside);
    return () => document.removeEventListener("pointerdown", closeOnOutside);
  }, [attachOpen]);

  // iOS keyboard geometry. WebKit keeps the layout viewport full-height when
  // the keyboard opens (which is why the pane is sized from the *visual*
  // viewport via --app-vh, see Taskbar) and answers a focus by scrolling the
  // focused field into view itself. Resizing the pane live while that reveal
  // scroll runs made the composer jump and left it unreachable — two
  // mechanisms fighting over the same field, and re-clamping the scroll after
  // the fact was janky and race-dependent. Here the roles are split instead:
  //   * while a widget field is focused on iOS the pane is frozen
  //     (html[data-freeze-vh]; Taskbar's sync skips --app-vh) — the composer's
  //     geometry is static, so WebKit's own reveal scroll is one smooth,
  //     deterministic move (the native behaviour, like any chat page);
  //   * once the keyboard has settled, if the field is still below the keys
  //     (WebKit did not scroll far enough), one corrective smooth scroll
  //     closes the gap;
  //   * when the field loses focus and the keyboard has fully closed, the page
  //     eases back to the position it had before the field was focused, so the
  //     widget returns to its full "one screen" state.
  // Android is unaffected: Chrome resizes the layout viewport for the keyboard,
  // so there the live --app-vh shrink is correct and no reveal scroll fires.
  useEffect(() => {
    if (!IS_IOS) return;
    const root = rootRef.current;
    if (!root) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const doc = document.documentElement;
    let scroller = document.querySelector<HTMLElement>(".page-scroll");
    let focused = false;
    let pendingUnfreeze = false;
    let base = 0;
    let settle = 0;

    const isField = (node: EventTarget | null) =>
      node instanceof HTMLElement && (node.tagName === "INPUT" || node.tagName === "TEXTAREA");
    // Keyboard up = the visual viewport is markedly shorter than the layout
    // viewport (same heuristic as Modal.tsx); on iOS the layout viewport does
    // not shrink for the keyboard.
    const keyboardUp = () => vv.height < window.innerHeight - 80;
    const findScroller = () => (scroller ??= document.querySelector<HTMLElement>(".page-scroll"));

    const onFocusIn = (e: FocusEvent) => {
      if (!isField(e.target) || !root.contains(e.target as Node)) return;
      const el = findScroller();
      base = el?.scrollTop ?? 0;
      focused = true;
      pendingUnfreeze = false;
      doc.dataset.freezeVh = "1";
    };

    const onFocusOut = (e: FocusEvent) => {
      const next = e.relatedTarget;
      // Moving between widget fields (composer → picker search) keeps the
      // freeze — the keyboard never closes across that transition.
      if (next instanceof Node && root.contains(next) && isField(next)) return;
      focused = false;
      if (keyboardUp()) {
        // Keyboard still open/closing: WebKit revealed the field by scrolling
        // the page. Once the keyboard has fully closed, drop the freeze and
        // ease back to where the widget was when the field gained focus (no-op
        // when nothing moved), restoring the "one screen" state.
        pendingUnfreeze = true;
      } else {
        // No keyboard involved — the pane was never resized nor the page
        // scrolled, so just release the freeze.
        delete doc.dataset.freezeVh;
      }
    };

    const onVv = () => {
      if (pendingUnfreeze && !focused && !keyboardUp()) {
        pendingUnfreeze = false;
        delete doc.dataset.freezeVh;
        const el = findScroller();
        if (el && Math.abs(el.scrollTop - base) > 4) {
          el.scrollTo({ top: base, behavior: "smooth" });
        }
        return;
      }
      if (!focused || !keyboardUp()) return;
      // Keyboard animating: once it (and WebKit's reveal scroll) has settled,
      // make sure the active field really sits above the keys. This only
      // corrects a shortfall — a deficit ≤ 0 means WebKit already revealed it.
      window.clearTimeout(settle);
      settle = window.setTimeout(() => {
        const ae = document.activeElement;
        if (!(ae instanceof HTMLElement) || !root.contains(ae)) return;
        const visibleBottom = vv.offsetTop + vv.height;
        const deficit = ae.getBoundingClientRect().bottom - (visibleBottom - 8);
        if (deficit > 1) {
          const el = findScroller();
          el?.scrollBy({ top: deficit, behavior: "smooth" });
        }
      }, 220);
    };

    window.addEventListener("focusin", onFocusIn, true);
    window.addEventListener("focusout", onFocusOut, true);
    vv.addEventListener("resize", onVv);
    vv.addEventListener("scroll", onVv);
    return () => {
      window.removeEventListener("focusin", onFocusIn, true);
      window.removeEventListener("focusout", onFocusOut, true);
      vv.removeEventListener("resize", onVv);
      vv.removeEventListener("scroll", onVv);
      window.clearTimeout(settle);
      delete doc.dataset.freezeVh;
    };
  }, []);

  // One event wherever the out-of-quota modal comes up — it is opened from
  // four places (text, voice, mic start, mid-recording cut).
  useEffect(() => {
    if (quotaModal) analytics.track("Show", "Quota modal");
  }, [quotaModal]);

  // Both halves of the pair as they are shown in the header: the writing
  // direction on the left, the language it is translated into on the right.
  const targetLanguage = useMemo(() => getLanguage(directionTarget), [directionTarget]);
  const rows = topic ? [...topic.translations].reverse() : [];

  // History is global across all language pairs: every thread is listed
  // together (newest first, as the server returns them).

  // Composer half of the omnibar — text field, a mic separated by a left
  // border, and the accent translate CTA hugging the field edge.
  const showSend = status === "idle" && text.trim().length > 0;
  const busy = status !== "idle" || imageBusy;
  const busyLabel = status === "recording" ? t.recording : status === "processing" ? t.recognizing : (t.imageReading ?? "Reading image…");
  const addLabel = t.add ?? "Add";
  const addImageLabel = t.addImage ?? "Image";
  // Whether the mic may be offered at all: the spoken half of the pair is the
  // writing direction, and the speech engine only knows its own list of codes
  // (lib/languages.ts). For the rest the recording would come back as some
  // other language with no error to show, so the button is not drawn — typing
  // and photos still work, those go to the translation model.
  const voiceAvailable = supportsVoice(direction);
  const micOrSend = status === "recording" ? () => stopRec(false) : showSend ? translateText : startRec;

  const composerRow = (
    <div className="flex min-w-0 w-full items-center gap-2">
      {/* Turnstile render target. Empty (zero-height) unless Cloudflare
          decides this visitor has to interact with the challenge. */}
      <div ref={turnstileRef} className="empty:hidden" />
      {!busy && (
        <>
          {/* "Add" trigger — context menu of attachable inputs. Disabled while
              a send is in flight so two flows never race the same topic. */}
          <button
            type="button"
            onClick={() => {
              analytics.track("Click", "Attach menu open");
              setAttachOpen(true);
            }}
            aria-label={addLabel}
            aria-haspopup="menu"
            aria-expanded={attachOpen}
            title={addLabel}
            disabled={textBusy}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--taskbar-bg)] text-hint transition-colors hover:bg-accent hover:text-text active:scale-90 disabled:opacity-40"
          >
            <Plus className="h-5 w-5" />
          </button>
          {attachOpen && (
            <div
              role="menu"
              aria-label={addLabel}
              className="absolute bottom-full left-2 z-10 mb-1 w-48 overflow-hidden rounded-lg bg-[var(--window-bg)] py-1 shadow-xl"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  analytics.track("Click", "Attach image");
                  setAttachOpen(false);
                  attachFileRef.current?.click();
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-text/90 transition-colors hover:bg-accent hover:text-text"
              >
                <ImageIcon size={16} className="shrink-0 text-hint" />
                {addImageLabel}
              </button>
            </div>
          )}
        </>
      )}
      {busy ? (
        <div className="flex min-w-0 flex-1 items-center self-center gap-2 px-2 text-sm text-hint">
          {status === "recording" ? (
            <>
              <span className="flex h-4 items-end gap-0.5">
                {[0, 150, 300, 450, 300, 150].map((delay, i) => (
                  <span
                    key={i}
                    className="h-4 w-1 origin-bottom animate-wave rounded-full bg-red-500"
                    style={{ animationDelay: `${delay}ms` }}
                  />
                ))}
              </span>
              {t.recording} · {fmtTime(elapsed)}
            </>
          ) : (
            <>
              <Loader2 size={14} className="animate-spin" /> {busyLabel}
            </>
          )}
        </div>
      ) : (
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onInput={autosize}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) translateText();
          }}
          placeholder={t.typePlaceholder}
          rows={1}
          name="translator-source-text"
          autoComplete="off"
          data-lpignore="true"
          data-1p-ignore
          data-bwignore
          data-form-type="other"
          style={{ height: 40, maxHeight: TEXTAREA_MAX_H }}
          className="min-w-0 flex-1 resize-none border-0 bg-transparent px-2 py-2 text-base leading-6 outline-none"
        />
      )}
      {/* Square CTA — stays a fixed square (never stretches with the field);
          the input grows on its own. With nothing typed and no voice for this
          language there is no action left to offer, so the button is dropped
          rather than drawn dead. */}
      {status === "idle" && !showSend && !voiceAvailable ? null : (
        <button
          onClick={() => {
            setAttachOpen(false);
            void micOrSend();
          }}
          disabled={status === "processing" || imageBusy || (showSend && textBusy)}
          aria-label={status === "recording" ? t.stopAria : showSend ? t.translateAria : t.recordAria}
          className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-button font-semibold text-button-text transition-all hover:opacity-90 active:scale-[0.99] disabled:opacity-40 ${
            status === "recording" ? "animate-pulse-ring" : ""
          }`}
        >
          {status === "processing" || imageBusy ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : status === "recording" ? (
            <Square className="h-4 w-4" fill="currentColor" />
          ) : showSend ? (
            textBusy ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <ArrowUp className="h-5 w-5" />
            )
          ) : (
            <Mic className="h-5 w-5" />
          )}
        </button>
      )}
      {/* Hidden file input — opened by the "Image" menu item. accept list must
          match the server's ALLOWED_MIME (and 15MB sidecar cap). */}
      <input
        ref={attachFileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={onAttachFileChange}
        className="hidden"
        tabIndex={-1}
      />
    </div>
  );

  // Every half is a concrete language now (auto-detect is gone), so both
  // labels always resolve to a name.
  const sourceLanguageLabel = getLanguage(direction)?.nameNative ?? direction;
  const targetLanguageLabel = targetLanguage?.nameNative ?? directionTarget;

  // Topic rows — the shared history across every pair. Each topic is a plain
  // row (no card background): just the thread title at text-sm, with the
  // delete control on the right.
  const topicsList = (onPick: () => void) =>
    topics.length === 0 ? (
      <div
        className="flex min-h-full w-full flex-col items-center justify-center gap-2 px-2 text-center text-[15px] opacity-50"
        style={{ color: "var(--hint)" }}
      >
        <BookOpen size={30} />
        <span>{t.noTopicsYet}</span>
      </div>
    ) : (
      <div className="flex w-full flex-col">
        {topics.map((tp) => {
          const active = tp.id === topic?.id;
          return (
            <div key={tp.id} className="flex w-full items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  switchTopic(tp.id);
                  onPick();
                }}
                className={`min-w-0 flex-1 px-2 py-2 text-left text-sm leading-normal transition active:scale-[0.99] ${
                  active ? "text-text" : "text-hint hover:text-text"
                }`}
              >
                <span
                  className={`block w-full truncate ${
                    active ? "font-medium" : ""
                  }`}
                >
                  {tp.title || t.newTopic}
                </span>
              </button>
              <button
                type="button"
                onClick={() => deleteTopic(tp.id)}
                aria-label={t.deleteTopic}
                className="shrink-0 rounded-lg p-2 text-hint transition hover:text-red-500 active:scale-90"
              >
                <Trash2 size={15} />
              </button>
            </div>
          );
        })}
      </div>
    );

  return (
    <div ref={rootRef} className="relative h-full min-h-0 w-full overflow-hidden sm:flex sm:flex-row sm:gap-2">
      {/* Two-pane layout: [history] [translator].
          Mobile — the panes are two full-width screens stacked over each
          other: the translator is active by default, the history sits fully
          off-screen to the left. Opening the history slides the panes (each
          is 100% of the widget width), so the translator moves off-screen to
          the right and the history takes its place — no half-width panes.
          Desktop — no sliding: history column on the left (40%), the
          translator on the right (flex). */}
      {/* Pane 1 — history of saved threads. Always present as its own panel;
          shows the placeholder when there are no threads yet. */}
      <div
        className={`absolute inset-0 flex h-full w-full flex-col overflow-hidden rounded-lg bg-[var(--window-bg)] transition-transform duration-300 ease-out sm:static sm:w-[40%] sm:shrink-0 sm:translate-x-0 ${
          topicsOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Panel header — only once there is something to list: the history
            title on the left; a "New translation" CTA and the mobile back
            control on the right. An empty history shows just the placeholder,
            with only the mobile back control on top. */}
        {topics.length > 0 ? (
          <div className="flex shrink-0 items-center justify-between gap-2 px-3 pt-3">
            <span className="truncate text-sm font-semibold text-text">{t.topics}</span>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => setTopicsOpen(false)}
                aria-label={t.close}
                title={t.close}
                className="rounded-lg p-1.5 text-hint transition hover:text-text active:scale-90 sm:hidden"
              >
                <X size={15} />
              </button>
              <button
                type="button"
                onClick={() => newTopic()}
                aria-label={t.newTopic}
                title={t.newTopic}
                className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-text transition hover:bg-accent active:scale-90"
              >
                <Plus size={15} />
                <span>{t.newTopic}</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="flex shrink-0 items-center justify-end px-3 pt-3 sm:hidden">
            <button
              type="button"
              onClick={() => setTopicsOpen(false)}
              aria-label={t.close}
              title={t.close}
              className="rounded-lg p-1.5 text-hint transition hover:text-text active:scale-90"
            >
              <X size={15} />
            </button>
          </div>
        )}
        <div className="fade-scroll min-h-0 flex-1 overflow-y-auto p-3">
          {topicsList(() => setTopicsOpen(false))}
        </div>
      </div>

      {/* Pane 2 — the translator, three rows: languages, conversation,
          composer. */}
      <div
        className={`absolute inset-0 flex h-full w-full flex-col overflow-hidden transition-transform duration-300 ease-out sm:static sm:min-w-0 sm:flex-1 sm:translate-x-0 ${
          topicsOpen ? "translate-x-full" : "translate-x-0"
        }`}
        style={{ gap: LAYOUT_GAP }}
      >
        {/* Row 1 — the two languages as separate blocks side by side with the
            swap button between them, each block carrying a header-style
            chevron on the right of the label hinting at the dropdown. The
            mobile history toggle keeps its own small block on the left. */}
        <div className="relative z-10 flex h-12 shrink-0 items-stretch gap-2">
          <button
            type="button"
            onClick={() => {
              analytics.track("Click", `Topics ${topicsOpen ? "close" : "open"}`);
              setTopicsOpen((v) => !v);
            }}
            aria-label={t.topics}
            aria-expanded={topicsOpen}
            title={t.topics}
            className="flex w-12 shrink-0 items-center justify-center rounded-lg bg-[var(--window-bg)] text-hint transition hover:bg-accent active:scale-[0.99] sm:hidden"
          >
            <BookOpen size={16} />
          </button>
          <button
            type="button"
            onClick={() => {
              analytics.track("Click", `Language picker source ${pickerFor === "source" ? "close" : "open"}`);
              setPickerFor((cur) => (cur === "source" ? null : "source"));
            }}
            title={sourceLanguageLabel}
            className="flex h-full min-w-0 flex-1 items-center justify-center overflow-hidden rounded-lg bg-[var(--window-bg)] px-2 text-sm font-medium leading-normal text-text transition-colors hover:bg-accent active:scale-[0.99]"
          >
            <span className="flex min-w-0 items-center justify-center gap-1">
              <span className="min-w-0 truncate">{sourceLanguageLabel}</span>
              <ChevronDown
                className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${
                  pickerFor === "source" ? "rotate-180 opacity-100" : "opacity-70"
                }`}
                aria-hidden="true"
              />
            </span>
          </button>
          {/* Swap — the direction of the pair, between its two halves: the
              left block is the language you write in, the right one is what
              it is translated into. Pressing it exchanges them, which is how
              the other person in a two-language conversation answers without
              anyone having to guess the language of a message. */}
          <button
            type="button"
            onClick={() => void swapDirection()}
            aria-label={t.swapAria}
            title={t.swapAria}
            className="flex w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--window-bg)] text-hint transition hover:bg-accent hover:text-text active:scale-90"
          >
            <ArrowLeftRight size={16} />
          </button>
          <button
            type="button"
            onClick={() => {
              analytics.track("Click", `Language picker target ${pickerFor === "target" ? "close" : "open"}`);
              setPickerFor((cur) => (cur === "target" ? null : "target"));
            }}
            title={targetLanguageLabel}
            className="flex h-full min-w-0 flex-1 items-center justify-center overflow-hidden rounded-lg bg-[var(--window-bg)] px-2 text-sm font-medium leading-normal text-text transition-colors hover:bg-accent active:scale-[0.99]"
          >
            <span className="flex min-w-0 items-center justify-center gap-1">
              <span className="min-w-0 truncate">{targetLanguageLabel}</span>
              <ChevronDown
                className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${
                  pickerFor === "target" ? "rotate-180 opacity-100" : "opacity-70"
                }`}
                aria-hidden="true"
              />
            </span>
          </button>
        </div>

        {/* Row 2 — the conversation of the current thread. While a language
            is being picked, the picker panel replaces this block in place,
            with the same height. */}
        {/* Row 2 — the conversation, or the language picker in its place.
            While the picker is open the wrapper has no background of its own:
            only the picker's search/list blocks paint, so the gap between
            them stays background-free. */}
        <div
          className={
            pickerFor
              ? "relative z-0 min-h-0 flex-1"
              : "relative z-0 min-h-0 flex-1 overflow-hidden rounded-lg bg-[var(--window-bg)]"
          }
        >
          {pickerFor ? (
            <LanguagePickerModal
              current={pickerFor === "source" ? direction : directionTarget}
              texts={t}
              onClose={() => setPickerFor(null)}
              onSelect={pickerFor === "source" ? selectSource : selectTarget}
            />
          ) : (
            <div className="flex h-full min-h-0 flex-col">
              <div ref={chatScrollRef} className="fade-scroll min-h-0 flex-1 overflow-y-auto p-3">
                {loadingTopic ? (
                  <div className="flex justify-center py-10 text-hint">
                    <Loader2 size={20} className="animate-spin" />
                  </div>
                ) : (
                  <History
                    rows={rows}
                    pending={
                      pending
                        ? {
                            id: "pending",
                            sourceLang: direction,
                            transcript: pending.transcript,
                            translation: pending.translation,
                            createdAt: "",
                          }
                        : null
                    }
                    langA={topic?.sourceLang ?? ""}
                    langB={topic?.targetLang ?? ""}
                    texts={texts.history}
                  />
                )}
              </div>
              {/* Remaining quota — always visible at the bottom of the chat
                  pane (it does not scroll with the messages); the scroll fades
                  into it. Three quiet counters — voice minutes, characters and
                  photo translations left — each an icon plus the amount. Icons
                  and figures are both gray (same tone as the hint text), so
                  the strip reads as a footer, not a set of buttons; the full
                  meaning lives in each chip's tooltip. The row wraps instead
                  of stacking on narrow screens. */}
              <div className="flex shrink-0 flex-wrap items-center justify-center gap-x-4 gap-y-1 px-3 py-1.5 text-xs leading-normal text-hint">
                <span
                  role="img"
                  aria-label={quota ? `${texts.account.minutesLeft}: ${quotaSeconds}` : texts.account.minutesLeft}
                  className="flex items-center gap-1 tabular-nums"
                  title={quota ? `${texts.account.minutesLeft}: ${quotaSeconds}` : undefined}
                >
                  <Mic size={14} aria-hidden="true" />
                  {quotaSeconds}
                </span>
                <span
                  role="img"
                  aria-label={quota ? `${texts.account.charsLeft}: ${quotaChars}` : texts.account.charsLeft}
                  className="flex items-center gap-1 tabular-nums"
                  title={quota ? `${texts.account.charsLeft}: ${quotaChars}` : undefined}
                >
                  <Type size={14} aria-hidden="true" />
                  {quotaChars}
                </span>
                <span
                  role="img"
                  aria-label={quota ? `${texts.account.imagesLeft}: ${quotaImages}` : texts.account.imagesLeft}
                  className="flex items-center gap-1 tabular-nums"
                  title={quota ? `${texts.account.imagesLeft}: ${quotaImages}` : undefined}
                >
                  <ImageIcon size={14} aria-hidden="true" />
                  {quotaImages}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Row 3 — composer: resting height h-14 with the text vertically
            centred; it grows once the input needs more lines. The action
            button stays a fixed square, always centred. */}
        <div ref={composerIslandRef} className="relative z-10 flex min-h-14 shrink-0 flex-col justify-center rounded-lg bg-[var(--window-bg)] px-2">
          {composerRow}
        </div>
      </div>


      {error && (
        <Modal
          title={error}
          onClose={() => setError(null)}
          closeAria={t.close}
          footer={
            <button
              onClick={() => setError(null)}
              className="inline-flex h-9 flex-1 items-center justify-center whitespace-nowrap rounded-lg bg-button px-4 text-sm font-semibold text-button-text transition-all hover:opacity-90 active:scale-[0.99]"
            >
              {t.close}
            </button>
          }
        >
          {null}
        </Modal>
      )}

      {micError && (
        <Modal
          title={micErrorTitle(t, micError)}
          onClose={() => setMicError(null)}
          closeAria={t.close}
          footer={
            <div className="flex w-full gap-2">
              <button
                onClick={() => setMicError(null)}
                className="inline-flex h-9 flex-1 items-center justify-center whitespace-nowrap rounded-lg border border-border px-4 text-sm font-semibold transition-all hover:opacity-90 active:scale-[0.99]"
                style={{ color: "var(--hint)" }}
              >
                {t.close}
              </button>
              <button
                onClick={retryMic}
                className="inline-flex h-9 flex-1 items-center justify-center whitespace-nowrap rounded-lg bg-button px-4 text-sm font-semibold text-button-text transition-all hover:opacity-90 active:scale-[0.99]"
              >
                {t.micRetry}
              </button>
            </div>
          }
        >
          <div className="px-5 py-4 text-sm text-hint">
            {micError === "blocked" && <p className="mb-3">{t.micBlockedDesc}</p>}
            {micError === "blocked" && (
              <p className="rounded-lg border border-border bg-card px-4 py-3 leading-relaxed">
                {t.micBlockedHow}
              </p>
            )}
          </div>
        </Modal>
      )}

      {quotaModal && (
        <Modal
          title={texts.account.upgrade}
          onClose={() => setQuotaModal(false)}
          closeAria={t.close}
          footer={
            <a
              href={pricingHref}
              onClick={() => {
                analytics.track("Click", "Quota modal upgrade");
                analytics.flush();
              }}
              className="inline-flex h-9 flex-1 items-center justify-center whitespace-nowrap rounded-lg bg-button px-4 text-sm font-semibold text-button-text transition-all hover:opacity-90 active:scale-[0.99]"
            >
              {t.pricingLink}
            </a>
          }
        >
          <div className="px-5 py-4 text-sm text-hint">{t.errors.insufficientCredits}</div>
        </Modal>
      )}


    </div>
  );
}
