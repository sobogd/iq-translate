"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { LOCALE_COOKIE, SIGNED_IN_COOKIE } from "@/lib/cookies";
import { PageTracker } from "./PageTracker";

// Client-side session state for the whole page.
//
// Every page here is prerendered at build time (no cookies() during render),
// so "is this visitor signed in" is resolved after hydration instead of during
// SSR. That keeps all 200+ SEO pages static and cacheable. The signed-in flag
// paints correctly on the first render (no "Sign in" flash) because the auth
// callbacks also drop a non-httpOnly hint cookie next to the httpOnly session
// cookie — see lib/auth-session.ts.

type SessionValue = {
  signedIn: boolean;
};

const SessionContext = createContext<SessionValue>({ signedIn: false });

export const useSession = () => useContext(SessionContext);

const readCookie = (name: string): string | null => {
  if (typeof document === "undefined") return null;
  const hit = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null;
};

export function SessionProvider({
  locale,
  page,
  children,
}: {
  /** Remembered so a later visit to "/" lands on the language actually used (proxy.ts). */
  locale: string;
  /** Locale-stable analytics page key ("Home", "Pair", "Pricing", "Legal").
   *  Every page component wraps itself in this provider, which makes it the one
   *  place the pageview/scroll tracker has to be mounted. */
  page: string;
  children: React.ReactNode;
}) {
  // useState initializer, not an effect: the very first paint already knows.
  const [signedIn] = useState(() => readCookie(SIGNED_IN_COOKIE) === "1");

  useEffect(() => {
    document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${400 * 86400}; samesite=lax`;
  }, [locale]);

  const value = useMemo(() => ({ signedIn }), [signedIn]);
  return (
    <SessionContext.Provider value={value}>
      <PageTracker page={page} />
      {children}
    </SessionContext.Provider>
  );
}
