"use client";

/**
 * Desktop PDF preview = pdf.js (`PdfViewer`): zoom −/+, % readout, rotate,
 * trackpad/touch pinch — the proven viewer. (iOS uses `IosPdfFrame` directly:
 * the native iframe with our own floating CSS zoom/rotate toolbar, because
 * WebKit won't paint the pdf.js canvas on iPhone/iPad.)
 *
 * This is a thin wrapper so the many existing call sites keep importing
 * `EmbedPdfViewer` unchanged — it forwards straight to `PdfViewer`.
 */

import { PdfViewer } from "@/components/PdfViewer";

type Props = {
  src: string;
  /** documents row id — keys the in-session rotation cache. */
  docId?: string;
  /** Fired once per +90° rotate; parent persists the delta. */
  onRotate?: () => void;
  /** Client-side seed rotation (passport docs, LAW #39 — bytes never re-saved). */
  initialRotation?: number;
  /** Hide the rotate button (e.g. coordinate-overlay tools). */
  hideRotate?: boolean;
};

export function EmbedPdfViewer({ src, docId, onRotate, initialRotation, hideRotate }: Props) {
  return (
    <PdfViewer
      src={src}
      docId={docId}
      onRotate={onRotate}
      initialRotation={initialRotation}
      hideRotate={hideRotate}
    />
  );
}
