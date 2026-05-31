"use client";

/**
 * Native PDF frame — renders a PDF through the BROWSER'S built-in PDF viewer in
 * an <iframe>, with the native toolbar shown. The browser's own viewer renders
 * / zooms / rotates / scrolls every PDF correctly (horizontal or vertical), so
 * we avoid the endless custom-viewer rotation / zoom bugs.
 *
 * The native toolbar is cross-origin, so we can't hide individual buttons from
 * inside it. Instead we lay flat blank patches over the unwanted parts. The
 * toolbar layout differs hugely by platform, so the masks are RESPONSIVE
 * (chosen from the measured container width, not the viewport):
 *
 *   • DESKTOP (Chrome PDFium, wide bar): hamburger ☰ + filename on the LEFT,
 *     Lens / download / print / ⋮ on the RIGHT, with page-nav + zoom + rotate +
 *     draw + undo/redo kept in the middle. → precise left patch + 4 right patches.
 *
 *   • PHONE (iOS Safari / WebKit, narrow bar): the native toolbar carries ONLY
 *     the action buttons (Lens / download / print) — there is NO hamburger,
 *     filename, zoom, rotate or page-nav. Nothing in the middle to preserve, so
 *     we cover the WHOLE bar with one patch (hides the actions, leaves a clean
 *     strip). iOS zoom is pinch-to-zoom — it has no zoom buttons to keep.
 *
 * Each patch is a DOM node stacked on top of the iframe, so it also swallows the
 * click — the button beneath is dead.
 *
 * Bytes are never mutated (LAW #39). `onRotate` / `initialRotation` accepted for
 * call-site compatibility but unused (native rotation is view-only).
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";

/* ── TUNABLES ──
 * TOOLBAR   — flat grey painted over the masked parts (single value = one colour).
 * BAR_H     — desktop toolbar height in px.
 * BAR_H_M   — phone toolbar height in px (iOS bars run a little taller).
 * NARROW_BP — container width (px) below which the phone (whole-bar) mask is used.
 * RIGHT_MASKS / LEFT_W — desktop geometry, measured from the toolbar's edges.
 */
const TOOLBAR = "#3c3c3c";
const BAR_H = 50;
const BAR_H_M = 60;
const NARROW_BP = 640;

// Desktop / wide toolbar
const RIGHT_MASKS = [
  { key: "more", right: 6, width: 44 }, // ⋮ overflow
  { key: "print", right: 50, width: 44 }, // print
  { key: "download", right: 94, width: 44 }, // download ↓
  { key: "lens", right: 138, width: 44 }, // Google Lens
];
const LEFT_W = 230; // hamburger (☰) + filename, stops before the page number

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

  // Choose the mask layout from the ACTUAL container width (the toolbar is
  // exactly this wide), so a phone and a narrow desktop pane both get the
  // whole-bar phone mask.
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

  // Every patch is the SAME flat colour. Default pointer-events eats the click,
  // disabling the button beneath.
  const patch: CSSProperties = {
    position: "absolute",
    top: 0,
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
      {narrow ? (
        // Phone: one patch across the whole native bar (only Lens/download/print
        // live there; nothing else to keep).
        <div aria-hidden style={{ ...patch, left: 0, right: 0, height: BAR_H_M }} />
      ) : (
        // Desktop: precise per-cluster patches, middle tools stay visible.
        <>
          {LEFT_W > 0 && <div aria-hidden style={{ ...patch, left: 0, width: LEFT_W, height: BAR_H }} />}
          {RIGHT_MASKS.map((m) => (
            <div key={m.key} aria-hidden style={{ ...patch, right: m.right, width: m.width, height: BAR_H }} />
          ))}
        </>
      )}
    </div>
  );
}
