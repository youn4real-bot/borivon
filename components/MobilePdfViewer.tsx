"use client";

/**
 * iPhone/iPad PDF preview with the SAME controls as the laptop.
 *
 * Why this exists: iOS's native PDF viewer (WebKit/PDFKit) has NO zoom, rotate
 * or page buttons — only Lens/download/print, which we hide. So on iOS we
 * render our OWN pdf.js viewer (`PdfViewer`: zoom −/+, %, rotate, pinch) to
 * match the desktop bar. As a bonus, rotation persists on iOS too (PdfViewer
 * rotates the canvas client-side, LAW #39-safe).
 *
 * Risk + fallback: iOS WebKit has historically painted the pdf.js canvas blank
 * for some PDFs. If pdf.js fails to LOAD, we auto-fall-back to the native frame
 * (`IosPdfFrame`). If it LOADS but paints blank (no error thrown), the small
 * "basic view" toggle drops to the native frame so the document is never stuck
 * invisible.
 */

import { useState } from "react";
import { PdfViewer } from "@/components/PdfViewer";
import { IosPdfFrame } from "@/components/IosPdfFrame";
import { useLang } from "@/components/LangContext";

export function MobilePdfViewer({
  src,
  docId,
  title,
  initialRotation,
  onRotate,
}: {
  src: string;
  docId?: string;
  title?: string;
  /** Client-side view rotation (preview is served un-baked, LAW #39). */
  initialRotation?: number;
  /** Persist a +90° rotate (parent PATCHes the row). */
  onRotate?: () => void;
}) {
  const { lang } = useLang();
  const [native, setNative] = useState(false);

  if (native) {
    return <IosPdfFrame src={src} title={title} initialRotation={initialRotation} onRotate={onRotate} />;
  }

  const blankLabel =
    lang === "de" ? "Leer? Einfache Ansicht"
    : lang === "fr" ? "Vide ? Vue simple"
    : "Blank? Basic view";

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <PdfViewer
        src={src}
        docId={docId}
        initialRotation={initialRotation}
        onRotate={onRotate}
        onError={() => setNative(true)}
      />
      {/* Escape hatch for the iOS blank-canvas case (loads but doesn't paint —
          pdf.js throws nothing, so we can't auto-detect it). One tap drops to
          the native frame. Unobtrusive; ignored when the page renders fine. */}
      <button
        type="button"
        onClick={() => setNative(true)}
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          zIndex: 6,
          fontSize: 11,
          lineHeight: 1,
          padding: "6px 9px",
          borderRadius: 999,
          background: "rgba(0,0,0,0.55)",
          color: "#fff",
          border: "1px solid rgba(255,255,255,0.28)",
          WebkitBackdropFilter: "blur(4px)",
          backdropFilter: "blur(4px)",
        }}
      >
        {blankLabel}
      </button>
    </div>
  );
}
