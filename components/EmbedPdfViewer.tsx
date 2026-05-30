"use client";

/**
 * PDF preview = the BROWSER'S NATIVE PDF viewer (via IosPdfFrame), with its
 * built-in toolbar shown.
 *
 * History: this used to be a custom PDFium-WASM canvas viewer with our own
 * floating toolbar + gesture zoom + CSS rotation. That path produced an endless
 * stream of rotation/zoom/centering bugs (double-rotation "cross", squished
 * pages, zoom shooting to the left, intrinsically-landscape scans rendering
 * wrong). We replaced it with the browser's own PDF viewer, which renders,
 * zooms, rotates and scrolls EVERY PDF correctly — horizontal or vertical — for
 * free, because it is the same PDFium the browser ships.
 *
 * This component is now a thin wrapper kept only so the many call sites don't
 * need to change. The rotation-persistence props (docId / onRotate /
 * initialRotation) are accepted but unused — the native viewer's rotation is
 * view-only. Bytes are never mutated server-side (LAW #39).
 */

import { IosPdfFrame } from "@/components/IosPdfFrame";

type Props = {
  src: string;
  /** Accepted for call-site compatibility; unused with the native viewer. */
  docId?: string;
  onRotate?: () => void;
  initialRotation?: number;
  hideRotate?: boolean;
};

export function EmbedPdfViewer({ src }: Props) {
  return <IosPdfFrame src={src} title="document" />;
}
