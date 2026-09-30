"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const SITE_KEY = process.env.NEXT_PUBLIC_TS_SITE ?? null;
const APP_SCHEME = "iqtranslate";

const SCRIPT_ID = "cf-turnstile-script";
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

// Challenge page for native app clients. The app opens this page in its own
// WebView (URL: <origin>/t/?app=1): the widget solves in execute mode, and the
// success handler hands the token back through a custom-scheme redirect that
// the app intercepts. A token minted here is accepted by /api/turnstile/verify
// because the hostname is this site's own.
//
// Opened in a plain browser the redirect goes nowhere; the token is then shown
// on screen instead so the page still makes sense.

type Status = "loading" | "ready" | "error" | "done";

export default function TurnstilePage() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [token, setToken] = useState("");
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const isApp = query.get("app") === "1";

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const applyDark = () => setDark(mq.matches);
    applyDark();
    mq.addEventListener("change", applyDark);

    let cancelled = false;
    let script: HTMLScriptElement | null = null;
    let existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;

    const finish = (t: string | null) => {
      if (cancelled) return;
      if (!t) {
        setStatus("error");
        return;
      }
      setToken(t);
      setStatus("done");
      window.location.href = `${APP_SCHEME}://done?token=${encodeURIComponent(t)}`;
    };

    const boot = () => {
      if (cancelled || !window.turnstile || !containerRef.current || !SITE_KEY) return;
      const settle = (t: string | null) => {
        window.turnstile?.removeWidget(widgetIdRef.current ?? undefined);
        widgetIdRef.current = null;
        finish(t);
      };
      try {
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: SITE_KEY,
          execution: "execute",
          theme: mq.matches ? "dark" : "light",
          callback: (t: string) => settle(t),
          "error-callback": () => settle(null),
          "timeout-callback": () => settle(null),
          "expired-callback": () => settle(null),
        });
        setStatus("ready");
      } catch {
        setStatus("error");
      }
    };

    if (existing) {
      if (window.turnstile) boot();
      else {
        existing.addEventListener("load", boot);
        existing.addEventListener("error", () => setStatus("error"));
      }
    } else {
      script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.src = SCRIPT_SRC;
      script.async = true;
      script.addEventListener("load", boot);
      script.addEventListener("error", () => setStatus("error"));
      document.head.appendChild(script);
    }

    return () => {
      cancelled = true;
      script?.remove();
    };
  }, []);

  const retry = useCallback(() => {
    window.location.reload();
  }, []);

  const bg = dark ? "#1d1d1d" : "#e9e9e9";
  const card = dark ? "rgb(30 31 35)" : "rgb(247 247 247)";
  const text = dark ? "rgb(250 250 250)" : "rgb(17 17 17)";
  const hint = dark ? "rgb(174 179 194)" : "rgb(102 102 102)";
  const border = dark ? "rgb(62 66 79)" : "rgb(208 208 208)";

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: bg,
        color: text,
        fontFamily: "system-ui, -apple-system, sans-serif",
        padding: 16,
      }}
    >
      <div
        style={{
          background: card,
          border: `1px solid ${border}`,
          borderRadius: 16,
          padding: 24,
          maxWidth: 360,
          width: "100%",
          textAlign: "center",
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 8 }}>IQ Translate</div>
        <div style={{ color: hint, fontSize: 14, marginBottom: 16 }}>
          {status === "loading" && "Подключаем проверку…"}
          {status === "ready" && "Подтвердите, что вы не робот"}
          {status === "error" && "Не удалось запустить проверку"}
          {status === "done" && "Готово — возвращаемся в приложение…"}
        </div>
        <div ref={containerRef} />
        {status === "error" && (
          <button
            onClick={retry}
            style={{
              marginTop: 16,
              background: "#d9534f",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "10px 24px",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Попробовать снова
          </button>
        )}
        {status === "done" && token !== "" && (
          <div style={{ color: hint, fontSize: 12, marginTop: 12, wordBreak: "break-all" }}>
            {token}
          </div>
        )}
      </div>
    </div>
  );
}

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: Record<string, unknown>,
      ) => string;
      removeWidget: (id?: string) => void;
    };
  }
}
