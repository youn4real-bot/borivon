"use client";

/**
 * Native PDF frame — renders a PDF through the BROWSER'S built-in PDF viewer
 * (PDFium, the same engine as Chrome/Edge and as the downloaded file) in an
 * <iframe>, WITH the native toolbar SHOWN. The browser's own viewer renders,
 * zooms, rotates and scrolls every PDF correctly — horizontal or vertical
 * uploads, scanned agency forms, anything — because it IS the browser's engine.
 * We deliberately use this instead of a custom canvas viewer to avoid the
 * endless rotation/zoom/centering bugs.
 *
 * Bytes are never mutated (LAW #39). Zoom/rotate are the native viewer's own
 * (rotation is view-only). `onRotate` / `initialRotation` are accepted for
 * call-site compatibility but intentionally unused.
 */

import { useRef, type CSSProperties } from "react";

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
  // served from the iframe's stale cache.
  const bustRef = useRef(Date.now());
  // blob: URLs are looked up by EXACT string — a `?_v=` query breaks them, so
  // leave blobs untouched. Server URLs get the cache-bust. We NO LONGER append
  // `#toolbar=0` — the native PDF toolbar is shown.
  const bustedSrc = src.startsWith("blob:")
    ? src
    : src + (src.includes("?") ? "&" : "?") + "_v=" + bustRef.current;

  // The browser's PDF toolbar exposes no way to hide INDIVIDUAL buttons, so we
  // cover the unwanted clusters with strips matching the toolbar colour:
  //  • left  → hamburger (thumbnails) + the filename
  //  • right → Google Lens, download, print, ⋮ overflow
  // The centre (page-nav, zoom −/+, rotate) stays visible + clickable.
  // Caveats: cosmetic only (Ctrl+S / Ctrl+P keyboard shortcuts still work);
  // widths are tuned for desktop — very narrow widths may need adjustment.
  const TOOLBAR = "#525659"; // match Chrome's PDF toolbar medium-grey so the bar reads as ONE color
  const maskBase: CSSProperties = { position: "absolute", top: 0, height: 52, background: TOOLBAR, zIndex: 2 };

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#525659" }}>
      <iframe
        title={title ?? "PDF"}
        src={bustedSrc}
        style={{ width: "100%", height: "100%", border: "none", background: "#525659" }}
      />
      {/* mask left cluster: ☰ + filename — kept narrow so it never clips the
          "−" zoom-out button that sits just to its right */}
      <div style={{ ...maskBase, left: 0, width: 288 }} />
      {/* mask right cluster: Lens / download / print / ⋮ */}
      <div style={{ ...maskBase, right: 0, width: 232 }} />
    </div>
  );
}
