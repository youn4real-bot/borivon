"use client";

import { useCallback, useEffect, useRef } from "react";
import { PdfViewer, PageOverlayFn } from "@/components/PdfViewer";
import { FormField } from "@/lib/pdfFieldEmbed";
import type { SigZone } from "@/components/PdfZonePicker";

const TYPE_COLORS: Record<FormField["type"], { border: string; bg: string }> = {
  text:     { border: "var(--gold)",  bg: "rgba(201,162,64,0.08)"   },
  date:     { border: "#5b9bd5",      bg: "rgba(91,155,213,0.08)"   },
  checkbox: { border: "#4ade80",      bg: "rgba(74,222,128,0.08)"   },
};

type Props = {
  pdfUrl: string;
  fields: FormField[];
  values: Record<string, string>;
  onChange: (fieldId: string, value: string) => void;
  disabled?: boolean;
  /** Optional candidate signature zone — when set, renders a "Sign here"
   *  overlay (or the supplied preview image) on the matching page. */
  signatureZone?: SigZone | null;
  /** Data URI of the signed signature image to render inside the zone.
   *  Null = not yet signed (shows "Sign here" prompt). */
  signaturePreview?: string | null;
  /** Called when the candidate taps the empty signature zone. */
  onSignClick?: () => void;
  /** When true, scroll the PDF to the signature zone and pulse-animate it
   *  for a few seconds. Used by the bell deep-link (LAW #22) so candidates
   *  arrive directly at the spot that needs their action. */
  highlightSigZone?: boolean;
};

export function PdfFieldFill({ pdfUrl, fields, values, onChange, disabled = false, signatureZone, signaturePreview, onSignClick, highlightSigZone = false }: Props) {
  const sigZoneRef = useRef<HTMLDivElement | null>(null);

  // When highlightSigZone flips true, wait for the PDF page to render
  // (the sig zone overlay only mounts after the page is laid out) then
  // smooth-scroll into view + apply the bv-sig-pulse animation class.
  useEffect(() => {
    if (!highlightSigZone) return;
    const tryScroll = (attempt: number) => {
      const el = sigZoneRef.current;
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("bv-sig-pulse");
        // Animation duration ~3.6s (3 pulses × 1.2s); clean up after.
        setTimeout(() => el.classList.remove("bv-sig-pulse"), 3600);
      } else if (attempt < 20) {
        // PDF page not laid out yet — retry briefly.
        setTimeout(() => tryScroll(attempt + 1), 150);
      }
    };
    // Small initial delay so PDF render kicks off first.
    const t = setTimeout(() => tryScroll(0), 400);
    return () => clearTimeout(t);
  }, [highlightSigZone, pdfUrl]);
  const pageOverlay: PageOverlayFn = useCallback(({ pageNum, dispH }) => {
    const pageFields = fields.filter(f => f.page === pageNum);
    const showSig = signatureZone && signatureZone.page === pageNum;
    if (pageFields.length === 0 && !showSig) return null;

    return (
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        {showSig && (
          <div
            ref={sigZoneRef}
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
            {signaturePreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={signaturePreview} alt="Your signature"
                style={{ width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none" }} />
            ) : (
              <span style={{
                fontSize: Math.max(9, Math.min(13, signatureZone.h * dispH * 0.32)),
                color: "var(--gold)", fontWeight: 700, pointerEvents: "none",
                textShadow: "0 1px 4px rgba(0,0,0,0.4)",
              }}>
                ✍️ Sign here
              </span>
            )}
          </div>
        )}
        {pageFields.map(f => {
          const pxH    = f.h * dispH;
          const fs     = Math.max(7, Math.min(14, pxH * 0.52));
          const colors = TYPE_COLORS[f.type];

          if (f.type === "checkbox") {
            return (
              <div
                key={f.id}
                style={{
                  position: "absolute",
                  left: `${f.x * 100}%`, top: `${f.y * 100}%`,
                  width: `${f.w * 100}%`, height: `${f.h * 100}%`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  pointerEvents: disabled ? "none" : "auto",
                }}
              >
                <input
                  type="checkbox"
                  checked={values[f.id] === "true"}
                  disabled={disabled}
                  onChange={e => onChange(f.id, e.target.checked ? "true" : "")}
                  style={{
                    width: Math.max(12, pxH * 0.6),
                    height: Math.max(12, pxH * 0.6),
                    cursor: disabled ? "default" : "pointer",
                    accentColor: colors.border,
                  }}
                />
              </div>
            );
          }

          return (
            <input
              key={f.id}
              type={f.type === "date" ? "date" : "text"}
              value={values[f.id] ?? ""}
              disabled={disabled}
              onChange={e => onChange(f.id, e.target.value)}
              placeholder={f.label}
              style={{
                position: "absolute",
                left: `${f.x * 100}%`, top: `${f.y * 100}%`,
                width: `${f.w * 100}%`, height: `${f.h * 100}%`,
                fontSize: fs,
                fontFamily: "Helvetica, Arial, sans-serif",
                padding: "0 4px",
                boxSizing: "border-box",
                background: colors.bg,
                border: `1.5px solid ${colors.border}88`,
                borderRadius: 3,
                color: "var(--w)",
                outline: "none",
                pointerEvents: disabled ? "none" : "auto",
                cursor: disabled ? "default" : "text",
                backdropFilter: "none",
              }}
              onFocus={e => {
                e.currentTarget.style.borderColor = colors.border;
                e.currentTarget.style.background  = colors.bg.replace("0.08", "0.18");
              }}
              onBlur={e => {
                e.currentTarget.style.borderColor = colors.border + "88";
                e.currentTarget.style.background  = colors.bg;
              }}
            />
          );
        })}
      </div>
    );
  }, [fields, values, onChange, disabled, signatureZone, signaturePreview, onSignClick]);

  return (
    <div style={{ position: "relative", height: "62dvh", borderRadius: 12, overflow: "hidden", border: "1px solid var(--border)" }}>
      <PdfViewer src={pdfUrl} hideRotate pageOverlay={pageOverlay} />
      <style>{`
        /* LAW #22 deep-link: pulse + glow the signature zone after auto-scroll
           so candidate sees exactly where they need to act. */
        @keyframes bvSigPulse {
          0%   { box-shadow: 0 0 0 0 rgba(201,162,64,0.95), 0 0 0 0 rgba(201,162,64,0.55); transform: scale(1); }
          40%  { box-shadow: 0 0 0 14px rgba(201,162,64,0.0),  0 0 22px 8px rgba(201,162,64,0.55); transform: scale(1.035); }
          100% { box-shadow: 0 0 0 0 rgba(201,162,64,0.0),  0 0 0 0 rgba(201,162,64,0.0);  transform: scale(1); }
        }
        .bv-sig-pulse {
          animation: bvSigPulse 1.2s ease-out 3;
          z-index: 5;
        }
      `}</style>
    </div>
  );
}
