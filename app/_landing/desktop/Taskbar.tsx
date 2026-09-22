"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Globe2,
  ShieldCheck,
  Monitor,
  Sun,
  Moon,
  LogOut,
  ArrowRight,
} from "lucide-react";
import { LogoIcon } from "../LogoIcon";
import { localePath } from "@/lib/locale-paths";
import { localeSwitchHref } from "@/lib/locale-slug-overrides";
import { getLanguage } from "@/lib/languages";
import { defaultLocale, locales, type Locale } from "@/lib/locales";
import { analytics } from "@/lib/analytics";
import { useSession } from "../session";
import { SignInPanel } from "../SignInPanel";
import { applyResolvedTheme, getThemeChoice, setThemeChoice, subscribeTheme, type ThemeChoice } from "@/lib/theme";
import { LOCALE_COOKIE } from "@/lib/cookies";
import {
  DEFAULT_ACCOUNT_TEXTS,
  DEFAULT_TEXTS,
  type AccountTexts,
  type TaskbarTexts,
} from "./taskbar-texts";

export type { AccountTexts, TaskbarTexts };

export type FeatureRow = { href: string; label: string; routeKey: string };

// Legal documents are English-only and sit at the root (/privacy, /terms) —
// every locale's menu links to the same two pages.
const LEGAL_LINKS = [
  { href: "/privacy", labelKey: "legalPrivacy" as const, track: "Header privacy" },
  { href: "/terms", labelKey: "legalTerms" as const, track: "Header terms" },
];

const THEME_OPTIONS: { key: ThemeChoice; icon: React.ReactNode }[] = [
  { key: "system", icon: <Monitor className="h-4 w-4" /> },
  { key: "light", icon: <Sun className="h-4 w-4" /> },
  { key: "dark", icon: <Moon className="h-4 w-4" /> },
];

export type MenuKind = "features" | "languages" | "legal" | "theme";

const MENU_ROWS: { kind: MenuKind; label: (t: TaskbarTexts) => string }[] = [
  { kind: "features", label: (t) => t.translate },
  { kind: "languages", label: (t) => t.languages },
  { kind: "legal", label: (t) => t.legal },
  { kind: "theme", label: (t) => t.theme },
];

// PostHog's floating glass "island" taskbar: a capsule that floats over the
// wallpaper. Site navigation (language-pair features, languages, legal, theme)
// lives in the header now that the footer is gone; the right-edge red CTA
// brings the embedded translator widget back to the top of the content window.
export function Taskbar({
  homeHref = "/",
  locale = defaultLocale,
  texts = DEFAULT_TEXTS,
  accountTexts = DEFAULT_ACCOUNT_TEXTS,
  pricingHref,
  pairLinks = [],
  anyLanguage,
}: {
  homeHref?: string;
  locale?: Locale;
  texts?: TaskbarTexts;
  accountTexts?: AccountTexts;
  pricingHref?: string;
  /** The locale's language-pair links for the Features menu. */
  pairLinks?: FeatureRow[];
  /** The catch-all "translate to any language" row (routeKey "/"). */
  anyLanguage?: FeatureRow;
}) {
  const [openMenu, setOpenMenu] = useState<MenuKind | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileSub, setMobileSub] = useState<MenuKind | null>(null);
  // Email of the signed-in account, shown in the account dropdown. Fetched
  // when the dropdown opens: the header itself only knows the yes/no hint
  // cookie, and there is no quota endpoint to carry the email any more.
  const [email, setEmail] = useState<string | null>(null);

  const { signedIn } = useSession();

  // The theme choice shown in the header's Theme menu, as an external store so
  // it stays in sync with lib/theme.ts without local state/effects.
  const subscribeThemes = useCallback((cb: () => void) => subscribeTheme(() => cb()), []);
  const theme = useSyncExternalStore(subscribeThemes, () => getThemeChoice(), () => "system");
  const pathname = usePathname();

  // Materialise the stored/system theme on <html> (the resolved attribute is
  // what the CSS actually reads). Live updates come through subscribeThemes.
  useEffect(() => {
    applyResolvedTheme();
  }, []);

  // The translator pane is sized "one visible screen minus the header, minus
  // an 8px bottom inset" (see AppWindow). 100dvh does NOT shrink when the on-
  // screen keyboard opens (the layout viewport keeps its height), so publish
  // the *visual* viewport height as --app-vh and the header's measured height
  // as --header-h; AppWindow keeps static fallbacks until the first measure.
  useEffect(() => {
    const el = document.getElementById("top");
    const vv = window.visualViewport;
    const sync = () => {
      if (el) document.documentElement.style.setProperty("--header-h", `${el.offsetHeight}px`);
      // While a widget field is focused on iOS the Translator freezes the pane
      // (html[data-freeze-vh]) so its geometry stays static for WebKit's own
      // keyboard reveal scroll — racing that reveal with a live pane resize is
      // what made the composer jump (see the iOS keyboard effect in
      // Translator.tsx). Android never sets the flag: there the layout
      // viewport itself shrinks for the keyboard, so the live --app-vh shrink
      // is the correct and only mechanism.
      if (document.documentElement.dataset.freezeVh === "1") return;
      const vh = vv?.height ?? window.innerHeight;
      document.documentElement.style.setProperty("--app-vh", `${vh}px`);
    };
    sync();
    const ro = new ResizeObserver(sync);
    if (el) ro.observe(el);
    window.addEventListener("resize", sync);
    vv?.addEventListener("resize", sync);
    vv?.addEventListener("scroll", sync);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sync);
      vv?.removeEventListener("resize", sync);
      vv?.removeEventListener("scroll", sync);
    };
  }, []);

  // Load the account email when the dropdown opens.
  useEffect(() => {
    if (!signedIn || !authOpen) return;
    let alive = true;
    void fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { email?: string | null } | null) => {
        if (alive) setEmail(d?.email ?? null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [signedIn, authOpen]);

  async function logout() {
    analytics.track("Click", "Log out");
    analytics.flush();
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.reload();
  }

  const closeAll = () => {
    setOpenMenu(null);
    setAuthOpen(false);
    setMenuOpen(false);
    setMobileSub(null);
  };

  // Close any open desktop menu / sign-in dropdown on outside press or Escape.
  useEffect(() => {
    if (!openMenu && !authOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest?.("#top, [data-auth-modal]")) return;
      setOpenMenu(null);
      setAuthOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpenMenu(null);
        setAuthOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [openMenu, authOpen]);

  const menuRef = useRef<HTMLDivElement>(null);

  // Close the mobile menu on outside press / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setMenuOpen(false);
      setMobileSub(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        setMobileSub(null);
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  // ---- shared row builders (rendered inside the desktop popovers and the
  // mobile menu's second level; `onDone` closes whichever surface owns them) ----

  const featuresContent = (onDone: () => void) => (
    <div className="flex max-h-[min(70vh,440px)] w-full flex-col overflow-y-auto">
      {pairLinks.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          prefetch={false}
          className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm font-medium leading-normal transition-colors hover:bg-accent"
          onClick={() => {
            analytics.track("Click", `Header feature: ${l.routeKey}`);
            onDone();
          }}
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-hint">
            <Globe2 className="h-4 w-4" />
          </span>
          <span className="flex-1 truncate">{l.label}</span>
        </Link>
      ))}
      <div className="my-1 border-t border-border/60" />
      <Link
        href={anyLanguage?.href ?? homeHref}
        className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm font-medium leading-normal text-hint transition-colors hover:bg-accent hover:text-text"
        onClick={() => {
          analytics.track("Click", "Header feature: all languages");
          onDone();
        }}
      >
        <ArrowRight className="h-4 w-4 shrink-0" />
        <span className="flex-1">{anyLanguage?.label ?? texts.anyLanguageHint}</span>
      </Link>
    </div>
  );

  const languagesContent = (onDone: () => void) => (
    <ul className="flex max-h-[min(70vh,440px)] w-full flex-col overflow-y-auto">
      {locales.map((l) => {
        const active = l === locale;
        const name = getLanguage(l)?.nameNative ?? l;
        // Only registered routes translate across locales; everything else
        // (pair pages, pricing, English-only legal) falls back to the target
        // locale's home rather than a 404 slug (see localeSwitchHref).
        const href = active ? pathname : localeSwitchHref(pathname, locale, l);
        return (
          <li key={l}>
            {active ? (
              <span
                aria-current="true"
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-semibold leading-tight text-text"
              >
                <span className="min-w-0 flex-1 truncate">{name}</span>
                <span className="ml-auto h-1 w-1 shrink-0 rounded-full bg-button" aria-hidden="true" />
              </span>
            ) : (
              <Link
                href={href}
                prefetch={false}
                className="flex w-full items-center rounded-md px-2 py-1.5 text-sm leading-tight text-hint transition-colors hover:bg-accent hover:text-text"
                onClick={() => {
                  analytics.track("Click", `Header language ${l}`);
                  // Remember the explicit choice before the navigation lands on
                  // the English root: proxy.ts routes "/" by NEXT_LOCALE, and
                  // the old value (the page you're leaving) would bounce the
                  // English switch straight back to the current locale.
                  document.cookie = `${LOCALE_COOKIE}=${l}; path=/; max-age=${400 * 86400}; samesite=lax`;
                  onDone();
                }}
              >
                <span className="min-w-0 flex-1 truncate">{name}</span>
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );

  const legalContent = (onDone: () => void) => (
    <div className="flex flex-col">
      {LEGAL_LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm font-medium leading-normal transition-colors hover:bg-accent"
          onClick={() => {
            analytics.track("Click", l.track);
            onDone();
          }}
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-hint">
            <ShieldCheck className="h-4 w-4" />
          </span>
          <span className="flex-1">{texts[l.labelKey]}</span>
        </Link>
      ))}
    </div>
  );

  const themeContent = (onDone: () => void) => (
    <div className="flex flex-col">
      {THEME_OPTIONS.map((opt) => (
        <button
          key={opt.key}
          type="button"
          aria-pressed={theme === opt.key}
          className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm font-medium leading-normal transition-colors hover:bg-accent"
          onClick={() => {
            analytics.track("Click", `Header theme ${opt.key}`);
            setThemeChoice(opt.key);
            onDone();
          }}
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-hint">{opt.icon}</span>
          <span className="flex-1">
            {opt.key === "system" ? texts.themeSystem : opt.key === "light" ? texts.themeLight : texts.themeDark}
          </span>
          {theme === opt.key && (
            <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-button" aria-hidden="true" />
          )}
        </button>
      ))}
    </div>
  );

  // Signed-in dropdown: whose account it is, and the way out. No plan and no
  // counters — the service is free and unlimited for everyone.
  const accountContent = () => (
    <div className="flex w-full flex-col">
      <div className="flex flex-col gap-1 px-2 pb-2 pt-1">
        <span className="text-xs font-medium uppercase tracking-wide text-hint">{accountTexts.title}</span>
        {email && <p className="truncate text-sm text-hint">{email}</p>}
      </div>
      <div className="my-1 border-t border-border/60" />
      <button
        type="button"
        onClick={() => {
          closeAll();
          void logout();
        }}
        className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm font-medium leading-normal text-text transition-colors hover:bg-accent"
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-hint">
          <LogOut className="h-4 w-4" />
        </span>
        <span className="flex-1">{texts.logOut}</span>
      </button>
    </div>
  );

  const submenuTitle = (sub: MenuKind): string => {
    if (sub === "features") return texts.translate;
    if (sub === "languages") return texts.languages;
    if (sub === "legal") return texts.legal;
    return texts.theme;
  };

  // ---- desktop trigger button for the nav menus ----
  const trigger = (kind: MenuKind, label: string) => (
    <button
      type="button"
      onClick={() => {
        const next = openMenu === kind ? null : kind;
        setOpenMenu(next);
        setAuthOpen(false);
        analytics.track("Click", `Header ${kind}`);
      }}
      aria-expanded={openMenu === kind}
      className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-sm font-medium leading-normal transition-colors hover:bg-accent data-[state=open]:bg-accent"
    >
      {label}
      <ChevronDown className="h-3 w-3 opacity-60" />
    </button>
  );

  const menuByKind: Record<MenuKind, (onDone: () => void) => React.ReactNode> = {
    features: featuresContent,
    languages: languagesContent,
    legal: legalContent,
    theme: themeContent,
  };

  return (
    <header id="top" className="relative z-50 p-2 sm:p-2">
      <div className="taskbar-glass mx-auto flex h-12 w-full items-center justify-between gap-2 rounded-md px-2">
        {/* Brand mark: the red "IQ" square sized to leave 8px of the header's
            px-2 padding visible on both sides (h-12 capsule → 32px mark). */}
        <Link
          href={homeHref}
          className="shrink-0 rounded transition-colors hover:bg-accent"
          aria-label={texts.logo}
          onClick={() => analytics.track("Click", "Header logo")}
        >
          <LogoIcon className="h-8 w-8" />
        </Link>

        {/* Mobile: the site menu sits right next to the logo, as a pill that
            opens the same menus the desktop bar uses. */}
        <div className="mr-auto flex h-full items-center gap-1.5 sm:hidden">
          <div className="relative flex h-full items-center" ref={menuRef}>
            <button
              type="button"
              aria-label={texts.menu}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => {
                analytics.track("Click", `Header menu ${menuOpen ? "close" : "open"}`);
                if (!menuOpen) setMobileSub(null);
                setMenuOpen((v) => !v);
              }}
              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2.5 text-sm font-semibold leading-normal text-text transition-colors hover:bg-accent data-[state=open]:bg-accent"
            >
              <span className="whitespace-nowrap">{texts.menu}</span>
              <ChevronDown
                className={`h-3.5 w-3.5 text-text/60 transition-transform ${menuOpen ? "rotate-180" : ""}`}
              />
            </button>

            {menuOpen && (
              <div className="absolute left-0 top-full z-50 mt-2 max-h-[min(75vh,560px)] w-64 max-w-[calc(100vw-3.5rem)] overflow-y-auto rounded-lg bg-[var(--taskbar-bg)] p-1.5 shadow-xl">
                {mobileSub ? (
                  <div className="flex flex-col">
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-semibold leading-normal text-text transition-colors hover:bg-accent"
                      onClick={() => setMobileSub(null)}
                    >
                      <ChevronLeft className="h-4 w-4 text-hint" />
                      <span>{submenuTitle(mobileSub)}</span>
                    </button>
                    <div className="my-1 border-t border-border/60" />
                    {menuByKind[mobileSub](() => {
                      setMenuOpen(false);
                      setMobileSub(null);
                    })}
                  </div>
                ) : (
                  <div className="flex flex-col">
                    {MENU_ROWS.map((row) => (
                      <button
                        key={row.kind}
                        type="button"
                        className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-sm font-medium leading-normal text-text transition-colors hover:bg-accent"
                        onClick={() => setMobileSub(row.kind)}
                      >
                        <span>{row.label(texts)}</span>
                        <ChevronRight className="h-4 w-4 text-hint" />
                      </button>
                    ))}
                    <Link
                      href={pricingHref ?? localePath(locale, "pricing")}
                      className="flex w-full items-center rounded-md px-2 py-2 text-sm font-medium leading-normal text-text transition-colors hover:bg-accent"
                      onClick={() => {
                        analytics.track("Click", "Mobile menu pricing");
                        setMenuOpen(false);
                        setMobileSub(null);
                      }}
                    >
                      {texts.pricing}
                    </Link>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Desktop row: menu triggers first, Pricing at the end. Hidden below
            `sm` — on a phone these overflow the bar. */}
        <nav className="mr-auto hidden h-full items-center gap-0.5 pl-2 text-sm font-medium leading-normal sm:flex">
          {MENU_ROWS.map((row) => (
            <span key={row.kind} className="relative flex h-full items-center">
              {trigger(row.kind, row.label(texts))}
              {openMenu === row.kind && (
                <div
                  className={`absolute left-0 top-full mt-2 rounded-lg bg-[var(--taskbar-bg)] p-1.5 shadow-xl ${
                    row.kind === "languages" ? "w-64" : "w-[248px]"
                  }`}
                >
                  {menuByKind[row.kind](() => setOpenMenu(null))}
                </div>
              )}
            </span>
          ))}
          <Link
            href={pricingHref ?? localePath(locale, "pricing")}
            className="rounded py-1 pl-2 pr-2 transition-colors hover:bg-accent"
            onClick={() => analytics.track("Click", "Header pricing")}
          >
            {texts.pricing}
          </Link>
        </nav>

        {/* Right cluster — the account CTA: "Sign in" while signed out, the
            same accent button labelled "Account" once signed in. It opens the
            matching dropdown (providers / plan+quota+actions). */}
        <div className="ml-3 flex h-full shrink-0 items-center gap-2">
          <div className="relative flex h-full items-center">
            <button
              type="button"
              onClick={() => {
                setAuthOpen((v) => !v);
                setOpenMenu(null);
                analytics.track("Click", `${signedIn ? "Account" : "Sign in"} menu ${authOpen ? "close" : "open"}`);
              }}
              aria-expanded={authOpen}
              aria-haspopup="menu"
              className="header-open-editor ml-2 inline-flex h-8 shrink-0 items-center gap-1 rounded bg-button px-2.5 text-sm font-semibold leading-normal text-button-text transition-all hover:opacity-90 active:scale-[0.99] data-[state=open]:opacity-90"
            >
              {signedIn ? texts.account : texts.signIn}
            </button>
            {authOpen && (
              <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-lg bg-[var(--taskbar-bg)] p-1.5 shadow-xl">
                {signedIn ? accountContent() : <SignInPanel texts={texts} />}
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
