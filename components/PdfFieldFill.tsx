"use client";

import { useCallback } from "react";
import { PdfViewer, PageOverlayFn } from "@/components/PdfViewer";
import { FormField } from "@/lib/pdfFieldEmbed";

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
};

export function PdfFieldFill({ pdfUrl, fields, values, onChange, disabled = false }: Props) {
  const pageOverlay: PageOverlayFn = useCallback(({ pageNum, dispH }) => {
    const pageFields = fields.filter(f => f.page === pageNum);
    if (pageFields.length === 0) return null;

    return (
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
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
  }, [fields, values, onChange, disabled]);

  return (
    <div style={{ position: "relative", height: "62dvh", borderRadius: 12, overflow: "hidden", border: "1px solid var(--border)" }}>
      <PdfViewer src={pdfUrl} hideRotate pageOverlay={pageOverlay} />
    </div>
  );
}
