"use client";

/**
 * Native PDF frame — renders a PDF through the BROWSER'S built-in PDF viewer
 * (PDFium, the same engine as Chrome/Edge and as the downloaded file) in an
 * <iframe>, with the native toolbar SHOWN. The browser's own viewer renders,
 * zooms, rotates and scrolls every PDF correctly — horizontal or vertical
 * uploads, scanned agency forms, anything — because it IS the browser's engine.
 *
 * The native toolbar is cross-origin (chrome-extension://) so we cannot hide
 * individual buttons from inside it. Instead we lay a SEPARATE blank patch over
 * each unwanted button. Because the patch is a real DOM node stacked ON TOP of
 * the iframe, it also swallows the click — so the button underneath is dead
 * (its function is removed), and the user just sees blank toolbar-coloured
 * space. Every button we want to keep (page-nav, zoom −/+, rotate, draw,
 * undo/redo) stays fully visible and clickable.
 *
 * Bytes are never mutated (LAW #39). Zoom/rotate are the native viewer's own
 * (rotation is view-only). `onRotate` / `initialRotation` are accepted for
 * call-site compatibility but intentionally unused.
 */

import { useRef, type CSSProperties } from "react";

/* ───────────────────────── TUNABLES ─────────────────────────
 * If a patch doesn't blend or doesn't sit dead-centre on its button, every
 * number you need is right here — no other code changes.
 *
 * TOOLBAR  — the toolbar grey. Fresh side-by-side shots show the real bar is
 *            clearly DARKER than the patch even at #474b4e and #323639, so the
 *            old "#3c4043 too dark" read was unreliable (stale deploy). Set to
 *            Chromium's documented PDF-toolbar grey #323639 (rgb 50,54,57).
 *            Too dark -> raise toward #3c4043; too light -> lower. Exact match:
 *            eyedropper the real bar and paste me the hex.
 * BAR_H    — toolbar height in px; each patch spans this so the whole button
 *            (top to bottom) is covered.
 * RIGHT_MASKS — buttons to kill, measured from the toolbar's RIGHT edge. They
 *            sit contiguously so the cluster reads as one clean blank space,
 *            but each is its own node: drop an entry and that single button
 *            comes back, untouched.
 */
const TOOLBAR = "#323639";
const BAR_H = 50;
const RIGHT_MASKS: { key: string; right: number; width: number }[] = [
  { key: "more", right: 6, width: 44 }, // ⋮ overflow menu
  { key: "print", right: 50, width: 44 }, // print
  { key: "download", right: 94, width: 44 }, // download ↓
  { key: "lens", right: 138, width: 44 }, // Google Lens
];
/* ─────────────────────────────────────────────────────────── */

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
  // served from the iframe's stale cache. blob: URLs are looked up by EXACT
  // string — a `?_v=` query breaks them — so leave blobs untouched.
  const bustRef = useRef(Date.now());
  const bustedSrc = src.startsWith("blob:")
    ? src
    : src + (src.includes("?") ? "&" : "?") + "_v=" + bustRef.current;

  const patch: CSSProperties = {
    position: "absolute",
    top: 0,
    height: BAR_H,
    background: TOOLBAR,
    zIndex: 2,
    // default pointer-events: auto → the patch eats the click, so the native
    // button beneath never fires. This is what "removes the function".
  };

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#323639" }}>
      <iframe
        title={title ?? "PDF"}
        src={bustedSrc}
        style={{ width: "100%", height: "100%", border: "none", background: "#323639" }}
      />
      {RIGHT_MASKS.map((m) => (
        <div key={m.key} aria-hidden style={{ ...patch, right: m.right, width: m.width }} />
      ))}
    </div>
  );
}
