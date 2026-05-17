"use client";

/**
 * Candidate-side fill component for PDFs whose fields are NATIVE AcroForm
 * widgets (authored externally in Acrobat etc.). Renders the PDF with
 * `PdfViewer` and overlays an editable text input on top of every empty,
 * still-mappable field. Fields the admin already filled show as static
 * read-only chips with the existing value.
 *
 * Differs from `PdfFieldFill` (legacy drawn fields) by reading positions
 * from `detectAcroFormFields()` instead of pre-stored `form_fields`.
 *
 * On submit, the caller fills the PDF via `fillAcroFormFields()` using the
 * collected `values` map.
 */

import { useCallback, useEffect, useState } from "react";
import { PdfViewer, type PageOverlayFn } from "@/components/PdfViewer";
import { detectAcroFormFields, type DetectedField } from "@/lib/pdfAcroFormFill";
import { Spinner } from "@/components/ui/states";
import type { SigZone } from "@/components/PdfZonePicker";

type Props = {
  /** Blob URL to the PDF. The component fetches the bytes from this URL to
   *  run pdf-lib detection — the caller keeps the URL alive. */
  pdfUrl: string;
  /** Field-name → typed value map managed by the parent. */
  values: Record<string, string>;
  /** Fired on every keystroke. */
  onChange: (name: string, value: string) => void;
  /** Locks every input. */
  disabled?: boolean;
  /** Optional candidate signature zone (passed through unchanged from the
   *  legacy fill flow — drawn in admin's wizard). */
  signatureZone?: SigZone | null;
  signaturePreview?: string | null;
  onSignClick?: () => void;
  highlightSigZone?: boolean;
  /** Called once detection finishes so the parent can compute completeness. */
  onDetectedFields?: (fields: DetectedField[]) => void;
};

export function PdfNativeFieldFill({
  pdfUrl, values, onChange, disabled = false,
  signatureZone, signaturePreview, onSignClick, highlightSigZone,
  onDetectedFields,
}: Props) {
  void highlightSigZone;
  const [detected, setDetected] = useState<DetectedField[] | null>(null);

  // Detect AcroForm fields once we have the bytes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(pdfUrl);
        if (!res.ok) return;
        const buf = await res.arrayBuffer();
        const fields = await detectAcroFormFields(buf);
        if (cancelled) return;
        setDetected(fields);
        onDetectedFields?.(fields);
      } catch (e) {
        console.warn("[PdfNativeFieldFill] detection failed:", e);
        if (!cancelled) setDetected([]);
      }
    })();
    return () => { cancelled = true; };
  }, [pdfUrl, onDetectedFields]);

  const pageOverlay: PageOverlayFn = useCallback(({ pageNum, dispW, dispH }) => {
    if (!detected) return null;
    const fieldsHere = detected.filter(d => d.page === pageNum && d.rect && d.pageSize);
    const showSig = !!signatureZone && signatureZone.page === pageNum;
    if (fieldsHere.length === 0 && !showSig) return null;

    return (
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        {showSig && signatureZone && (
          <div
            onClick={() => { if (!signaturePreview && !disabled) onSignClick?.(); }}
            style={{
              position: "absolute",
              left: `${signatureZone.x * 100}%`, top: `${signatureZone.y * 100}%`,
              width: `${signatureZone.w * 100}%`, height: `${signatureZone.h * 100}%`,
              display: "flex", alignItems: "center", justifyContent: "center",
              borderRadius: 4,
              border: signaturePreview ? "1.5px solid rgba(201,162,64,0.4)" : "1.5px dashed var(--gold)",
              background: signaturePreview ? "transparent" : "rgba(201,162,64,0.12)",
              pointerEvents: disabled ? "none" : "auto",
              cursor: signaturePreview ? "default" : "pointer",
              overflow: "hidden",
            }}>
            {signaturePreview && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={signaturePreview} alt="signature" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            )}
            {!signaturePreview && (
              <span className="text-[10px] font-semibold" style={{ color: "var(--gold)" }}>Sign here</span>
            )}
          </div>
        )}
        {fieldsHere.map(d => {
          if (!d.rect || !d.pageSize) return null;
          const sx = dispW / d.pageSize.w;
          const sy = dispH / d.pageSize.h;
          const left   = d.rect.x * sx;
          const top    = (d.pageSize.h - d.rect.y - d.rect.h) * sy;
          const width  = d.rect.w * sx;
          const height = d.rect.h * sy;
          if (d.kind !== "text") return null;
          return (
            <input
              key={d.name}
              type="text"
              value={values[d.name] ?? ""}
              onChange={e => onChange(d.name, e.target.value)}
              disabled={disabled}
              placeholder=""
              style={{
                position: "absolute",
                left, top, width, height,
                background: "rgba(201,162,64,0.08)",
                border: "1.5px solid rgba(201,162,64,0.5)",
                borderRadius: 3,
                color: "#131312",
                fontSize: Math.min(12, Math.max(9, height * 0.55)),
                padding: "0 4px",
                outline: "none",
                pointerEvents: "auto",
              }}
            />
          );
        })}
      </div>
    );
  }, [detected, values, onChange, disabled, signatureZone, signaturePreview, onSignClick]);

  if (!detected) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spinner size="sm" />
      </div>
    );
  }

  return <PdfViewer src={pdfUrl} hideRotate pageOverlay={pageOverlay} />;
}
