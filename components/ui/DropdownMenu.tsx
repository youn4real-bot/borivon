"use client";

import { useEffect, useLayoutEffect, useRef, useState, ReactNode } from "react";
import { createPortal } from "react-dom";

// Layout effect runs synchronously AFTER DOM commit but BEFORE paint, so the
// menu's position is set in the very same frame as the click → it appears
// instantly with no one-frame "nothing then pop" gap. Falls back to useEffect
// during SSR (no window) to avoid the React server warning.
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

interface Props {
  open: boolean;
  onClose: () => void;
  anchor: HTMLElement | null;
  children: ReactNode;
  align?: "left" | "right";
  minWidth?: number;
  /**
   * Pre-measured position captured by the caller AT CLICK TIME (when the
   * trigger is guaranteed laid-out & valid). When provided, the menu renders
   * at exactly these fixed coords with ZERO later measurement — immune to the
   * captured node being replaced by re-render churn (the root cause of the
   * "click ⋯ and nothing shows" bug on the constantly-re-rendering admin
   * detail). `anchor` is then only used for the inside-click check.
   */
  anchorRect?: { top: number; left?: number; right?: number };
}

/**
 * Anchored dropdown, portaled to <body>.
 *
 * Why the rect is captured into STATE instead of read inline every render:
 * the admin candidate-detail view is enormous and re-renders constantly. The
 * old code did `if (!anchor.isConnected) return null` + read
 * getBoundingClientRect() on every render — so any unrelated re-render that
 * momentarily churned the anchor node made the menu vanish (the "three dots
 * don't work anywhere" bug). Now: we snapshot the position when it opens
 * (and on scroll/resize) and keep showing it regardless of later anchor
 * churn. The menu only closes on explicit outside-click / Escape / onClose.
 */
export function DropdownMenu({ open, onClose, anchor, children, align = "right", minWidth = 160, anchorRect }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number } | null>(null);
  // Last good position — so a later transient zero-rect (re-render churn) can
  // never make an already-open menu vanish, and a fresh open can fall back.
  const lastPosRef = useRef<{ top: number; left?: number; right?: number } | null>(null);

  // Snapshot / refresh position while open.
  //
  // CRITICAL: the admin candidate-detail view re-renders constantly. The old
  // code read the anchor rect ONCE on open and, if it was all-zero (the node
  // momentarily not laid out mid re-render), it bailed and NEVER retried —
  // pos stayed null forever → "click the ⋯ and nothing ever shows up". Now we
  // retry on animation frames until the anchor has a real rect, and if it
  // truly never does we fall back to the last good / a safe on-screen spot,
  // so the menu is ALWAYS visible when open. This is the permanent fix for
  // the recurring "three dots do nothing" bug across every menu in the app.
  // Runs as a LAYOUT effect → measured + positioned before the browser
  // paints the opened state, so the menu shows up the instant you click
  // (no perceptible delay), then the .16s fade just makes it smooth.
  useIsoLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    // FAST PATH — caller measured the trigger at click time. Render exactly
    // there, no DOM read, no node dependency, no race. This is what makes the
    // menu open INSTANTLY and never "show nothing".
    if (anchorRect) { lastPosRef.current = anchorRect; setPos(anchorRect); return; }
    if (!anchor) { setPos(null); return; }
    let raf = 0;
    let tries = 0;
    const apply = (r: DOMRect) => {
      const p = align === "right"
        ? { top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) }
        : { top: r.bottom + 4, left: Math.max(8, r.left) };
      lastPosRef.current = p;
      setPos(p);
    };
    const compute = (): boolean => {
      const r = anchor.getBoundingClientRect();
      if (r.width || r.height || r.top || r.left) { apply(r); return true; }
      return false;
    };
    if (!compute()) {
      const tick = () => {
        tries += 1;
        if (compute()) return;
        if (tries < 60) { raf = requestAnimationFrame(tick); return; }
        // Anchor never produced a real rect (truly detached). Never leave the
        // menu invisible — reuse the last good spot, else a safe corner.
        setPos(lastPosRef.current ?? { top: 80, right: 16 });
      };
      raf = requestAnimationFrame(tick);
    }
    const onWin = () => { compute(); };
    window.addEventListener("scroll", onWin, true);
    window.addEventListener("resize", onWin);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onWin, true);
      window.removeEventListener("resize", onWin);
    };
  }, [open, anchor, align, anchorRect]);

  // Outside-click + Escape close.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      if (anchor?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchor]);

  if (!open || !pos || typeof window === "undefined") return null;

  return createPortal(
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        top: pos.top,
        ...(pos.right !== undefined ? { right: pos.right } : { left: pos.left }),
        zIndex: 9999,
        minWidth,
        background: "var(--card)",
        border: "1px solid var(--border)",
        boxShadow: "var(--shadow-md)",
        borderRadius: "var(--r-md)",
        overflow: "hidden",
        transformOrigin: align === "right" ? "top right" : "top left",
        animation: "bvFadeRise .16s var(--ease-out) both",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
