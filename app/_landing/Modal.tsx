"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { lockScroll } from "@/lib/scroll-lock";

// The one modal shell: header (title + close) over a bottom border, scrollable
// unpadded content (each consumer brings its own padding — the language picker
// wants a flush full-width search field), and an optional footer above a top
// border whose CTA buttons all render h-9, same as the header CTAs. Portaled
// to <body> so no ancestor transform/backdrop-filter can trap it. Enter/exit
// are animated: the shell fades its backdrop and slides/scales the card, and
// close requests play the exit animation before calling onClose.
// The slice of the screen that is actually visible — on iOS the software
// keyboard does NOT shrink the layout viewport (100dvh stays full height) and
// Safari scrolls the page instead, so a `fixed inset-0` overlay ends up partly
// under the keyboard. visualViewport is the only source that reports both the
// shrunken height and how far Safari pushed the page (offsetTop/offsetLeft).
// Null until measured, and on browsers without the API — the dvh classes
// underneath stay the fallback.
export type ViewportBox = { height: number; top: number; left: number };

// Never-changing subscribe for the client-only flag below — the snapshot itself
// is what differs between the server and the browser.
const subscribeNothing = () => () => {};

/** False on the server and through hydration, true once the browser owns the
 *  tree. Portals have no DOM to target on the server, and reading the flag
 *  this way avoids the extra render a setState-in-effect would cost — which
 *  is also the only reason this hook exists (both full-screen overlays in
 *  _landing need it: the modal shell and the Turnstile gate). */
export function useMounted(): boolean {
  return useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
}

// Shared with the Turnstile gate, which is another full-screen overlay that has
// to sit inside the slice the keyboard leaves free (see Turnstile.tsx).
export function useVisualViewport(): ViewportBox | null {
  const [box, setBox] = useState<ViewportBox | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    // Coalesce into a frame: iOS fires resize/scroll in bursts while the
    // keyboard animates in, and each one would otherwise be its own render.
    let frame = 0;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        setBox({ height: vv.height, top: vv.offsetTop, left: vv.offsetLeft }),
      );
    };
    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
    };
  }, []);
  return box;
}

export function Modal({
  title,
  onClose,
  closeAria = "Close",
  maxWidth = "max-w-md",
  footer,
  children,
}: {
  title: string;
  onClose: () => void;
  closeAria?: string;
  maxWidth?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const mounted = useMounted();
  const [visible, setVisible] = useState(false);
  const box = useVisualViewport();
  useEffect(() => {
    // enter on the next frame so the initial (hidden) styles actually paint
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const close = () => {
    setVisible(false);
    setTimeout(onClose, 180);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    const release = lockScroll();
    return () => {
      document.removeEventListener("keydown", onKey);
      release();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!mounted) return null;

  // Keyboard up: the visible slice is far shorter than the layout viewport.
  // The card then takes all of it (minus the overlay's p-4); with no keyboard
  // it keeps the old 85% so the page still shows around it.
  const keyboardOpen = !!box && box.height + box.top < window.innerHeight - 80;
  const cardMaxHeight = box
    ? Math.max(box.height - 32, 160) * (keyboardOpen ? 1 : 0.85)
    : undefined;

  return createPortal(
    <div
      className={`fixed left-0 top-0 z-[60] flex w-full items-center justify-center bg-black/40 p-4 backdrop-blur-sm transition-opacity duration-200 ${
        visible ? "opacity-100" : "opacity-0"
      } ${box ? "" : "h-full"}`}
      style={
        box
          ? { height: box.height, transform: `translate(${box.left}px, ${box.top}px)` }
          : undefined
      }
      onClick={close}
    >
      <div
        className={`flex w-full ${maxWidth} flex-col overflow-hidden rounded-2xl border shadow-xl transition-all duration-200 ${
          box ? "" : "max-h-[85dvh]"
        } ${visible ? "translate-y-0 scale-100 opacity-100" : "translate-y-2 scale-95 opacity-0"}`}
        style={{ background: "var(--card)", borderColor: "var(--border)", maxHeight: cardMaxHeight }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            onClick={close}
            aria-label={closeAria}
            className="rounded-lg p-1.5 transition active:scale-90"
            style={{ color: "var(--hint)" }}
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
          {children}
        </div>
        {footer && (
          <div className="flex shrink-0 items-center gap-2 border-t border-border px-5 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
