"use client";

import { RefObject, useEffect } from "react";

/**
 * Dismiss-on-outside-press + Esc-to-close hook.
 *
 * Replaces the hand-rolled "addEventListener mousedown + keydown" blocks that
 * were duplicated four times across the candidate/admin notification bells
 * and the candidate/admin chat dropdowns. Single source of truth, proper
 * touch handling (touchstart for mobile dismiss), and an open-only gate so
 * we're not attaching listeners while the popover is closed.
 *
 * Usage:
 *   const ref = useRef<HTMLDivElement>(null);
 *   const [open, setOpen] = useState(false);
 *   useDismiss(ref, open, () => setOpen(false));
 *
 * Pass `skipMobile: true` to bail on phones — used by the bell + chat
 * dropdowns whose mobile variant is a bottom sheet with its own dedicated
 * backdrop / drag-to-close handle and doesn't want a global outside-press
 * to dismiss it.
 */
export function useDismiss(
  ref: RefObject<HTMLElement | null>,
  isOpen: boolean,
  onDismiss: () => void,
  opts: { skipMobile?: boolean } = {},
): void {
  useEffect(() => {
    if (!isOpen) return;
    const isMobile = () =>
      typeof window !== "undefined"
      && window.matchMedia("(max-width: 639.98px)").matches;

    const outside = (e: MouseEvent | TouchEvent) => {
      if (opts.skipMobile && isMobile()) return;
      const target = e.target as Node | null;
      if (ref.current && target && !ref.current.contains(target)) onDismiss();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };

    document.addEventListener("mousedown", outside);
    document.addEventListener("touchstart", outside, { passive: true });
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("touchstart", outside);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, isOpen, onDismiss, opts.skipMobile]);
}
