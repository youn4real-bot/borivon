"use client";

import { useEffect, useRef, useState, ReactNode } from "react";
import { createPortal } from "react-dom";

interface Props {
  open: boolean;
  onClose: () => void;
  anchor: HTMLElement | null;
  children: ReactNode;
  align?: "left" | "right";
  minWidth?: number;
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
export function DropdownMenu({ open, onClose, anchor, children, align = "right", minWidth = 160 }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number } | null>(null);

  // Snapshot / refresh position while open.
  useEffect(() => {
    if (!open || !anchor) { setPos(null); return; }
    const compute = () => {
      const r = anchor.getBoundingClientRect();
      // A detached node yields an all-zero rect — skip so we keep the last
      // good position instead of jumping to the top-left corner.
      if (r.width === 0 && r.height === 0 && r.top === 0 && r.left === 0) return;
      setPos(
        align === "right"
          ? { top: r.bottom + 4, right: window.innerWidth - r.right }
          : { top: r.bottom + 4, left: r.left },
      );
    };
    compute();
    window.addEventListener("scroll", compute, true);
    window.addEventListener("resize", compute);
    return () => {
      window.removeEventListener("scroll", compute, true);
      window.removeEventListener("resize", compute);
    };
  }, [open, anchor, align]);

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
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
