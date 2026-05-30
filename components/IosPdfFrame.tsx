"use client";

/**
 * Native PDF frame — renders a PDF through the BROWSER'S built-in PDF viewer
 * (PDFium, the same engine as Chrome/Edge and as the downloaded file) in an
 * <iframe>, WITH the FULL native toolbar SHOWN (every original button: the
 * thumbnails hamburger, filename, page-nav, zoom −/+, rotate, draw, undo/redo,
 * Google Lens, download, print and the ⋮ overflow). The browser's own viewer
 * renders, zooms, rotates and scrolls every PDF correctly — horizontal or
 * vertical uploads, scanned agency forms, anything — because it IS the
 * browser's engine. We deliberately use this instead of a custom canvas viewer
 * to avoid the endless rotation/zoom/centering bugs.
 *
 * No button masking — the toolbar is shown exactly as the browser ships it.
 * Bytes are never mutated (LAW #39). Zoom/rotate are the native viewer's own
 * (rotation is view-only). `onRotate` / `initialRotation` are accepted for
 * call-site compatibility but intentionally unused.
 */

import { useRef } from "react";

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

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#525659" }}>
      <iframe
        title={title ?? "PDF"}
        src={bustedSrc}
        style={{ width: "100%", height: "100%", border: "none", background: "#525659" }}
      />
    </div>
  );
}
