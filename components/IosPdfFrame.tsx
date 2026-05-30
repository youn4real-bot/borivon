"use client";

/**
 * Native PDF frame — renders a PDF through the BROWSER'S built-in PDF viewer
 * (PDFium) in an <iframe>, with the native toolbar shown. The browser's own
 * viewer renders / zooms / rotates / scrolls every PDF correctly (horizontal or
 * vertical), so we avoid the endless custom-viewer rotation / zoom bugs.
 *
 * The native toolbar is cross-origin, so we can't hide individual buttons from
 * inside it. Instead we lay ONE FLAT blank patch over each unwanted button on
 * the right (Google Lens, download, print, ⋮). Each patch is a DOM node stacked
 * on top of the iframe, so it also swallows the click — the button beneath is
 * dead. Every kept button (page-nav, zoom, rotate, draw, undo/redo) stays
 * visible and clickable.
 *
 * Bytes are never mutated (LAW #39). `onRotate` / `initialRotation` are accepted
 * for call-site compatibility but unused (native rotation is view-only).
 */

import { useRef, type CSSProperties } from "react";

/* ── TUNABLES ──
 * TOOLBAR — the flat grey of the Chrome PDF toolbar. The masked side is painted
 *           EXACTLY this one value (no gradients / no fades) so it stays a
 *           single consistent colour. If it ever needs to match better, change
 *           this one hex.
 * BAR_H   — toolbar height in px; each patch spans it so the whole button is
 *           covered.
 * RIGHT_MASKS — buttons to kill, offset from the toolbar's RIGHT edge. They sit
 *           contiguously (no gaps) so the cluster is one uniform block; drop an
 *           entry to bring that single button back.
 */
const TOOLBAR = "#3c3c3c";
const BAR_H = 50;
const RIGHT_MASKS: { key: string; right: number; width: number }[] = [
  { key: "more", right: 6, width: 44 }, // ⋮ overflow menu
  { key: "print", right: 50, width: 44 }, // print
  { key: "download", right: 94, width: 44 }, // download ↓
  { key: "lens", right: 138, width: 44 }, // Google Lens
];

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
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: TOOLBAR }}>
      <iframe
        title={title ?? "PDF"}
        src={bustedSrc}
        style={{ width: "100%", height: "100%", border: "none", background: TOOLBAR }}
      />
      {RIGHT_MASKS.map((m) => (
        <div key={m.key} aria-hidden style={{ ...patch, right: m.right, width: m.width }} />
      ))}
    </div>
  );
}
