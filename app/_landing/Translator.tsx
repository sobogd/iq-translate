"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight, ArrowUp, ChevronDown, Loader2, Mic, Square, Trash2, X } from "lucide-react";
import { WavRecorder } from "@/lib/recorder";
import { History } from "@/components/History";
import { apiFetch, readSse } from "@/lib/client";
import type { ConversationDetail } from "@/lib/types";
import { LANGUAGES, getLanguage, supportsVoice } from "@/lib/languages";
import { Modal } from "./Modal";
import { LAYOUT_GAP } from "./desktop/layout";
import { useSession } from "./session";
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
}) {
  const t = texts.translator;
  // Signed-in visitors are never bot-challenged (see lib/turnstile.ts).
  const { signedIn } = useSession();
  // Seeded pair, normalised once — the two states below are then edited
  // independently (and the cookie/localStorage may replace both on mount).
  const seed = seedPair(presetSource ?? initialSource ?? null, presetTarget ?? initialTarget ?? DEFAULT_TO);
  const [defaultTarget, setDefaultTarget] = useState(seed.target);
  // Language the visitor writes in while no conversation row exists yet —
  // mirrored by the swap button and carried into the row created on the first
  // send.
  const [draftSourceLang, setDraftSourceLang] = useState(seed.source);
  // The pair's history (or a synthetic empty row for a pair never used).
  const [conversation, setConversation] = useState<ConversationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [pickerFor, setPickerFor] = useState<"source" | "target" | null>(null);
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

  // Reads one pair's history (or a synthetic empty row). Never throws: a
  // failed read is treated as "no history" rather than blocking the widget.
  const fetchConversation = useCallback(
    async (source: string, target: string): Promise<ConversationDetail | null> => {
      const res = await apiFetch(
        `/api/conversation?source=${encodeURIComponent(source)}&target=${encodeURIComponent(target)}`,
      );
      if (!res.ok) return null;
      return (await res.json()) as ConversationDetail;
    },
    [],
  );

  // Switch the widget to another pair: remember it, reset the draft, load its
  // history. The page's own labels follow from `conversation`, not from the
  // draft, so setting all three keeps them consistent.
  const openPair = useCallback(
    async (source: string, target: string) => {
      rememberPair(source, target);
      setDraftSourceLang(source);
      setDefaultTarget(target);
      setText("");
      setPending(null);
      setError(null);
      setConversation(await fetchConversation(source, target));
    },
    [fetchConversation],
  );

  // Bootstrap once: load the history of the seeded pair. A pair never used
  // comes back with id: null — the row is only created on the first send.
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const loaded = await fetchConversation(seed.source, seed.target);
      if (!alive) return;
      setConversation(loaded);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keep the newest turn in view — the chat column is its own scroll box now
  // (fixed-height desktop layout), not page content, so it scrolls itself.
  const turnCount = conversation?.translations.length ?? 0;
  const chatMounted = !pickerFor;
  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [turnCount, conversation?.id, chatMounted]);

  // Creates the pair row if it does not exist yet and returns its id — the
  // only write the widget makes before a send. The server canonicalises the
  // pair, so the id keeps working whichever side the visitor writes from.
  const ensureConversation = useCallback(
    async (source: string, target: string, writeLang: string): Promise<string> => {
      const res = await apiFetch("/api/conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceLang: source, targetLang: target, writeLang }),
      });
      const created = await res.json();
      if (!res.ok) throw new Error((created as { error?: string }).error || "error");
      return (created as { id: string }).id;
    },
    [],
  );

  // Empties the current pair's history; the row itself stays so the pair and
  // direction are remembered.
  async function clearHistory() {
    if (!conversation?.id) return;
    if (!confirm(t.clearHistoryConfirm)) return;
    analytics.track("Click", "History clear");
    const res = await apiFetch(`/api/conversation/${conversation.id}`, { method: "DELETE" });
    if (res.ok) setConversation({ ...conversation, translations: [] });
    else setError(t.errors.generic);
  }

  // Both pickers list every language, including the one already selected on
  // the other side. The two halves of a pair must differ (there is no
  // auto-detect to fall back on), so picking the language that already sits on
  // the other side swaps them instead of hiding the option.
  function selectSource(code: string) {
    analytics.track("Click", `Language source ${code}`);
    setPickerFor(null);
    // Picking the language already on the other side swaps the pair.
    if (code === directionTarget) void openPair(directionTarget, direction);
    else void openPair(code, directionTarget);
  }

  function selectTarget(code: string) {
    analytics.track("Click", `Language target ${code}`);
    setPickerFor(null);
    if (code === direction) void openPair(directionTarget, direction);
    else void openPair(direction, code);
  }

  // Direction of the pair the visitor is looking at: the half they write in.
  // The conversation's A side (sourceLang) never moves — that is what the chat
  // bubbles align by — while this follows the swap button.
  const direction = conversation ? conversation.writeLang : draftSourceLang;
  const directionTarget = conversation
    ? direction === conversation.sourceLang
      ? conversation.targetLang
      : conversation.sourceLang
    : defaultTarget;

  // Caps at 3 lines: leading-6 (24px) × 3 + the textarea's own py-2.5 (20px).
  // One line is 44px — the resting height of the field — and the island adds
  // its p-1.5 and border on top of that. Anything longer grows the island.
  const TEXTAREA_MAX_H = 96;

  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  // Language pair of whatever is about to be sent, as one locale-stable token
  // ("es-en") — the analytics name, never a translated label. It follows the
  // current direction, so a swapped thread reports the swap.
  const trackPair = () => `${direction}-${directionTarget}`;

  // Swap button between the two language blocks. In a draft it just exchanges
  // the halves; in a stored conversation it persists the new writing direction
  // on the row (writeLang) rather than exchanging sourceLang/targetLang, which
  // would flip every bubble of the history to the other side.
  async function swapDirection() {
    analytics.track("Click", "Language swap");
    setPickerFor(null);
    if (!conversation || !conversation.id) {
      await openPair(directionTarget, direction);
      return;
    }
    const writeLang = directionTarget;
    // Shown immediately; the PATCH below only has to make it survive a reload.
    setConversation({ ...conversation, writeLang });
    const res = await apiFetch(`/api/conversation/${conversation.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ writeLang }),
    });
    if (!res.ok) {
      // Fall back to what the server still believes rather than showing a
      // direction the next message will not use.
      setConversation(conversation);
      setError(t.errors.generic);
    }
    rememberPair(conversation.sourceLang, conversation.targetLang);
  }

  function autosize() {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_H)}px`;
  }

  async function translateText() {
    if (!text.trim() || textBusy) return;
    const source = direction;
    const target = directionTarget;
    const pair = trackPair();
    analytics.track("Click", "Send text");
    setError(null);
    setTextBusy(true);
    // Text stays in the input while busy (not cleared up front) — that's
    // what keeps the composer CTA showing its spinner instead of falling
    // back to the mic icon (showSend needs non-empty text).
    const sent = text;
    try {
      if (!(await ensurePass())) throw new Error("turnstile_failed");
      const conversationId = conversation?.id ?? (await ensureConversation(source, target, source));
      const send = () =>
        apiFetch("/api/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: sent, conversationId }),
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
      setConversation(await fetchConversation(source, target));
      setPending(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error";
      setPending(null);
      analytics.track("Show", `Translate error text: ${trackError(msg)}`);
      setError(friendlyError(msg, t));
    } finally {
      setTextBusy(false);
    }
  }

  async function startRec() {
    analytics.track("Click", "Mic start");
    setError(null);
    setMicError(null);
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
  async function stopRec() {
    const rec = recRef.current;
    if (!rec) return;
    const source = direction;
    const target = directionTarget;
    const pair = trackPair();
    analytics.track("Click", "Mic stop");
    setStatus("processing");
    try {
      const blob = await rec.stop();
      recRef.current = null;
      if (!(await ensurePass())) throw new Error("turnstile_failed");
      const conversationId = conversation?.id ?? (await ensureConversation(source, target, source));
      const fd = new FormData();
      fd.append("audio", blob, "speech.wav");
      fd.append("conversationId", conversationId);
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
      setConversation(await fetchConversation(source, target));
      setPending(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error";
      setPending(null);
      analytics.track("Show", `Translate error voice: ${trackError(msg)}`);
      setError(friendlyError(msg, t));
    } finally {
      setStatus("idle");
    }
  }

  useEffect(() => {
    if (status !== "recording") return;
    const start = Date.now();
    const tick = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 250);
    return () => {
      clearInterval(tick);
      setElapsed(0);
    };
  }, [status]);

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

  // Both halves of the pair as they are shown in the header: the writing
  // direction on the left, the language it is translated into on the right.
  const targetLanguage = getLanguage(directionTarget);
  const rows = conversation ? [...conversation.translations].reverse() : [];

  // Composer half of the omnibar — text field, a mic separated by a left
  // border, and the accent translate CTA hugging the field edge.
  const showSend = status === "idle" && text.trim().length > 0;
  const busyLabel = status === "recording" ? t.recording : t.recognizing;
  // Whether the mic may be offered at all: the spoken half of the pair is the
  // writing direction, and the speech engine only knows its own list of codes
  // (lib/languages.ts). For the rest the recording would come back as some
  // other language with no error to show, so the button is not drawn — typing
  // still works, that goes to the translation model.
  const voiceAvailable = supportsVoice(direction);
  const micOrSend = status === "recording" ? stopRec : showSend ? translateText : startRec;
  const canClear = Boolean(conversation?.id) && rows.length > 0;

  const composerRow = (
    <div className="flex min-w-0 w-full items-center gap-2">
      {/* Turnstile render target. Empty (zero-height) unless Cloudflare
          decides this visitor has to interact with the challenge. */}
      <div ref={turnstileRef} className="empty:hidden" />
      {status !== "idle" ? (
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
          onClick={() => void micOrSend()}
          disabled={status === "processing" || (showSend && textBusy)}
          aria-label={status === "recording" ? t.stopAria : showSend ? t.translateAria : t.recordAria}
          className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-button font-semibold text-button-text transition-all hover:opacity-90 active:scale-[0.99] disabled:opacity-40 ${
            status === "recording" ? "animate-pulse-ring" : ""
          }`}
        >
          {status === "processing" ? (
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
    </div>
  );

  // Every half is a concrete language now (auto-detect is gone), so both
  // labels always resolve to a name.
  const sourceLanguageLabel = getLanguage(direction)?.nameNative ?? direction;
  const targetLanguageLabel = targetLanguage?.nameNative ?? directionTarget;

  return (
    <div ref={rootRef} className="relative flex h-full min-h-0 w-full flex-col" style={{ gap: LAYOUT_GAP }}>
      {/* Row 1 — the two languages as separate blocks side by side with the
          swap button between them, plus the clear-history control on the
          left. Clearing is the only history action left: there is one
          conversation per pair, no list to open. */}
      <div className="relative z-10 flex h-12 shrink-0 items-stretch gap-2">
        <button
          type="button"
          onClick={() => void clearHistory()}
          disabled={!canClear}
          aria-label={t.clearHistory}
          title={t.clearHistory}
          className="flex w-12 shrink-0 items-center justify-center rounded-lg bg-[var(--window-bg)] text-hint transition hover:bg-accent hover:text-text active:scale-[0.99] disabled:opacity-40 disabled:hover:bg-[var(--window-bg)]"
        >
          <Trash2 size={16} />
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

      {/* Row 2 — the conversation, or the language picker in its place. While
          the picker is open the wrapper has no background of its own: only the
          picker's search/list blocks paint, so the gap between them stays
          background-free. */}
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
          <div ref={chatScrollRef} className="fade-scroll h-full min-h-0 overflow-y-auto p-3">
            {loading ? (
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
                langA={conversation?.sourceLang ?? ""}
                langB={conversation?.targetLang ?? ""}
                texts={texts.history}
              />
            )}
          </div>
        )}
      </div>

      {/* Row 3 — composer: resting height h-14 with the text vertically
          centred; it grows once the input needs more lines. The action
          button stays a fixed square, always centred. */}
      <div className="relative z-10 flex min-h-14 shrink-0 flex-col justify-center rounded-lg bg-[var(--window-bg)] px-2">
        {composerRow}
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
    </div>
  );
}
