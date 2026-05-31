"use client";

/**
 * Native PDF frame — renders a PDF through the BROWSER'S built-in PDF viewer
 * (PDFium) in an <iframe>, with the native toolbar shown. The browser's own
 * viewer renders / zooms / rotates / scrolls every PDF correctly (horizontal or
 * vertical), so we avoid the endless custom-viewer rotation / zoom bugs.
 *
 * The native toolbar is cross-origin, so we can't hide individual buttons from
 * inside it. Instead we lay flat blank patches over the unwanted clusters:
 *   • LEFT  — hamburger (☰) + filename
 *   • RIGHT — Google Lens, download, print, ⋮ overflow
 * Each patch is a DOM node stacked on top of the iframe, so it also swallows the
 * click — the button beneath is dead. The kept tools in the middle (page-nav,
 * zoom, rotate, draw, undo/redo) stay visible and clickable.
 *
 * RESPONSIVE: the native toolbar reflows with width — on a phone the filename
 * truncates and the clusters pack tighter, so the DESKTOP pixel widths would
 * blanket the whole bar. We measure the container with a ResizeObserver and use
 * a separate, smaller mask set below NARROW_BP.
 *
 * Bytes are never mutated (LAW #39). `onRotate` / `initialRotation` accepted for
 * call-site compatibility but unused (native rotation is view-only).
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";

/* ── TUNABLES ──
 * TOOLBAR — flat grey of the PDF toolbar (the masked clusters are painted EXACTLY
 *           this single value so the bar reads as one colour).
 * BAR_H   — toolbar height in px; patches span it so each button is covered.
 * NARROW_BP — container width (px) below which the phone mask set is used.
 *
 * Two mask sets, measured against the toolbar's edges:
 *   *_RIGHT_MASKS — right-anchored action buttons (offset from the RIGHT edge).
 *   *_LEFT_W      — width of the single left patch (hamburger + filename), from
 *                   the LEFT edge, stopping before the page number.
 * The _M (mobile) values are deliberately smaller; calibrate from a phone shot.
 */
const TOOLBAR = "#3c3c3c";
const BAR_H = 50;
const NARROW_BP = 640;

// Desktop / wide toolbar
const RIGHT_MASKS = [
  { key: "more", right: 6, width: 44 }, // ⋮ overflow
  { key: "print", right: 50, width: 44 }, // print
  { key: "download", right: 94, width: 44 }, // download ↓
  { key: "lens", right: 138, width: 44 }, // Google Lens
];
const LEFT_W = 230;

// Phone / narrow toolbar — kept small so the middle tools (zoom/rotate) are
// never covered. Calibrate the exact extents from a mobile screenshot.
const RIGHT_MASKS_M = [
  { key: "more", right: 4, width: 44 }, // ⋮ overflow
];
const LEFT_W_M = 64;

export function IosPdfFrame({
  src,
  title,
}: {
  src: string;
  title?: string;
  onRotate?: () => void;
  initialRotation?: number;
}) {
  // Per-open cache-bust so a freshly re-generated / replaced file is never
  // served stale. blob: URLs are looked up by EXACT string — a `?_v=` query
  // breaks them — so leave blobs untouched.
  const bustRef = useRef(Date.now());
  const bustedSrc = src.startsWith("blob:")
    ? src
    : src + (src.includes("?") ? "&" : "?") + "_v=" + bustRef.current;

  // Pick the mask set from the ACTUAL container width (the toolbar is exactly
  // this wide), not the viewport — so a narrow side-by-side pane on desktop and
  // a phone both get the small set.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState<boolean>(
    () => (typeof window !== "undefined" ? window.innerWidth < NARROW_BP : false),
  );
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const apply = (w: number) => {
      if (w > 0) setNarrow(w < NARROW_BP);
    };
    apply(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) apply(e.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rightMasks = narrow ? RIGHT_MASKS_M : RIGHT_MASKS;
  const leftW = narrow ? LEFT_W_M : LEFT_W;

  // Every patch is the SAME flat colour, full toolbar height. Default
  // pointer-events eats the click, disabling the button beneath.
  const patch: CSSProperties = {
    position: "absolute",
    top: 0,
    height: BAR_H,
    background: TOOLBAR,
    zIndex: 2,
  };

  return (
    <div ref={wrapRef} style={{ position: "absolute", inset: 0, overflow: "hidden", background: TOOLBAR }}>
      <iframe
        title={title ?? "PDF"}
        src={bustedSrc}
        style={{ width: "100%", height: "100%", border: "none", background: TOOLBAR }}
      />
      {leftW > 0 && <div aria-hidden style={{ ...patch, left: 0, width: leftW }} />}
      {rightMasks.map((m) => (
        <div key={m.key} aria-hidden style={{ ...patch, right: m.right, width: m.width }} />
      ))}
    </div>
  );
}
