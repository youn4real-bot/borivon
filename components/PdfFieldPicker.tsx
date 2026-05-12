"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { PdfViewer, PageOverlayFn } from "@/components/PdfViewer";
import { Spinner } from "@/components/ui/states";
import { FormField } from "@/lib/pdfFieldEmbed";
import { Trash2 } from "lucide-react";

export type { FormField };

const TYPE_COLORS: Record<FormField["type"], { border: string; bg: string; text: string; label: string }> = {
  text:     { border: "var(--gold)",  bg: "rgba(201,162,64,0.10)", text: "var(--gold)",  label: "Text"     },
  date:     { border: "#5b9bd5",      bg: "rgba(91,155,213,0.10)", text: "#5b9bd5",      label: "Date"     },
  checkbox: { border: "#4ade80",      bg: "rgba(74,222,128,0.10)", text: "#4ade80",      label: "Checkbox" },
};

const TYPES: FormField["type"][] = ["text", "date", "checkbox"];

const HANDLES = [
  { id: "nw", top: "0%",   left: "0%",   cursor: "nw-resize" },
  { id: "ne", top: "0%",   left: "100%", cursor: "ne-resize" },
  { id: "sw", top: "100%", left: "0%",   cursor: "sw-resize" },
  { id: "se", top: "100%", left: "100%", cursor: "se-resize" },
] as const;

type DragState =
  | { mode: "move";   idx: number; startCX: number; startCY: number; startCx: number; startCy: number; startField: FormField }
  | { mode: "resize"; idx: number; handle: string; startCX: number; startCY: number; startField: FormField; pageW: number; pageH: number; page: number }
  | { mode: "draw";   startCX: number; startCY: number; page: number };

type Props = {
  pdfBase64: string;
  fields: FormField[];
  onChange: (fields: FormField[]) => void;
  onError?: () => void;
};

export function PdfFieldPicker({ pdfBase64, fields, onChange, onError }: Props) {
  const [blobUrl,   setBlobUrl]   = useState<string | null>(null);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [pageCount, setPageCount] = useState(1);

  const fieldsRef   = useRef(fields);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; });
  useEffect(() => { fieldsRef.current = fields; }, [fields]);

  const pageElsRef = useRef<Map<number, HTMLElement>>(new Map());
  const dragRef    = useRef<DragState | null>(null);

  // Blob URL from base64
  useEffect(() => {
    if (!pdfBase64) return;
    try {
      const bytes = Uint8Array.from(atob(pdfBase64), c => c.charCodeAt(0));
      const blob  = new Blob([bytes], { type: "application/pdf" });
      const url   = URL.createObjectURL(blob);
      setBlobUrl(url);
      return () => URL.revokeObjectURL(url);
    } catch { onError?.(); }
  }, [pdfBase64]); // eslint-disable-line react-hooks/exhaustive-deps

  function emit(next: FormField[]) {
    fieldsRef.current = next;
    onChangeRef.current(next);
  }

  function pageFromClient(cx: number, cy: number): { pageNum: number; rect: DOMRect } | null {
    let best: { pageNum: number; rect: DOMRect; dist: number } | null = null;
    for (const [pageNum, el] of pageElsRef.current) {
      const rect = el.getBoundingClientRect();
      if (cx >= rect.left && cx <= rect.right && cy >= rect.top && cy <= rect.bottom)
        return { pageNum, rect };
      const dist = Math.hypot(Math.max(rect.left - cx, 0, cx - rect.right), Math.max(rect.top - cy, 0, cy - rect.bottom));
      if (!best || dist < best.dist) best = { pageNum, rect, dist };
    }
    return best ? { pageNum: best.pageNum, rect: best.rect } : null;
  }

  function getVisiblePage(): number {
    let bestPage = 1, bestArea = 0;
    for (const [pn, el] of pageElsRef.current) {
      const r = el.getBoundingClientRect();
      const area = Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0))
                 * Math.max(0, Math.min(r.right, window.innerWidth) - Math.max(r.left, 0));
      if (area > bestArea) { bestArea = area; bestPage = pn; }
    }
    return bestPage;
  }

  // Global mouse move + up
  useEffect(() => {
    const MIN = 16;

    function onMove(e: MouseEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      e.preventDefault();
      const fs = fieldsRef.current;

      if (drag.mode === "move") {
        const { idx, startCX, startCY, startCx, startCy, startField } = drag;
        const dx = e.clientX - startCX, dy = e.clientY - startCY;
        const hit = pageFromClient(startCx + dx, startCy + dy);
        if (!hit) return;
        const { pageNum, rect } = hit;
        const next = [...fs];
        next[idx] = {
          ...startField,
          page: pageNum,
          x: Math.max(0, Math.min(1 - startField.w, (startCx + dx - rect.left) / rect.width  - startField.w / 2)),
          y: Math.max(0, Math.min(1 - startField.h, (startCy + dy - rect.top)  / rect.height - startField.h / 2)),
        };
        emit(next);

      } else if (drag.mode === "resize") {
        const { idx, handle, startCX, startCY, startField, pageW, pageH, page } = drag;
        const dx = (e.clientX - startCX) / pageW, dy = (e.clientY - startCY) / pageH;
        const { x: sx, y: sy, w: sw, h: sh } = startField;
        const sf_w = handle.includes("w") ? (sw - dx) / sw : (sw + dx) / sw;
        const sf_h = handle.includes("n") ? (sh - dy) / sh : (sh + dy) / sh;
        const sc   = Math.max((sf_w + sf_h) / 2, Math.max(MIN / pageW / sw, MIN / pageH / sh));
        const nw   = sw * sc, nh = sh * sc;
        const nx   = handle.includes("w") ? sx + sw - nw : sx;
        const ny   = handle.includes("n") ? sy + sh - nh : sy;
        const next = [...fs];
        next[idx]  = { ...startField, page, x: Math.max(0, nx), y: Math.max(0, ny), w: Math.min(1 - Math.max(0, nx), nw), h: Math.min(1 - Math.max(0, ny), nh) };
        emit(next);

      } else if (drag.mode === "draw") {
        const { startCX, startCY, page } = drag;
        const el = pageElsRef.current.get(page);
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const x1 = (startCX - rect.left) / rect.width,  y1 = (startCY - rect.top) / rect.height;
        const x2 = (e.clientX - rect.left) / rect.width, y2 = (e.clientY - rect.top) / rect.height;
        const drawIdx = fs.length - 1;
        const next = [...fs];
        next[drawIdx] = { ...next[drawIdx],
          x: Math.max(0, Math.min(x1, x2)), y: Math.max(0, Math.min(y1, y2)),
          w: Math.min(1, Math.abs(x2 - x1)), h: Math.min(1, Math.abs(y2 - y1)),
        };
        emit(next);
      }
    }

    function onUp() {
      const drag = dragRef.current;
      dragRef.current = null;
      if (drag?.mode === "draw") {
        const fs = fieldsRef.current;
        const di = fs.length - 1;
        const f  = fs[di];
        if (f && (f.w < 0.02 || f.h < 0.01)) {
          const trimmed = fs.filter((_, i) => i !== di);
          emit(trimmed);
          setActiveIdx(trimmed.length > 0 ? trimmed.length - 1 : null);
        }
      }
    }

    window.addEventListener("mousemove", onMove, { passive: false });
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function addField() {
    const page = getVisiblePage();
    const id   = crypto.randomUUID();
    const next = [...fieldsRef.current, { id, page, x: 0.08, y: 0.1, w: 0.4, h: 0.06, label: "Field", type: "text" as const }];
    emit(next);
    setActiveIdx(next.length - 1);
  }

  function removeField(i: number) {
    const next = fieldsRef.current.filter((_, idx) => idx !== i);
    emit(next);
    setActiveIdx(next.length > 0 ? Math.min(i, next.length - 1) : null);
  }

  function updateActive(patch: Partial<FormField>) {
    if (activeIdx === null) return;
    const next = [...fieldsRef.current];
    next[activeIdx] = { ...next[activeIdx], ...patch };
    emit(next);
  }

  const activeField = activeIdx !== null ? fields[activeIdx] : null;

  const pageOverlay: PageOverlayFn = useCallback(({ pageNum }) => {
    return (
      <div
        ref={el => { if (el) pageElsRef.current.set(pageNum, el); else pageElsRef.current.delete(pageNum); }}
        style={{ position: "absolute", inset: 0, cursor: "crosshair" }}
        onMouseDown={e => {
          if (e.button !== 0) return;
          e.preventDefault();
          const id   = crypto.randomUUID();
          const placeholder: FormField = { id, page: pageNum, x: 0, y: 0, w: 0, h: 0, label: "Field", type: "text" };
          const next = [...fieldsRef.current, placeholder];
          emit(next);
          setActiveIdx(next.length - 1);
          dragRef.current = { mode: "draw", startCX: e.clientX, startCY: e.clientY, page: pageNum };
        }}
      >
        {fields.map((f, i) => {
          if (f.page !== pageNum) return null;
          const colors   = TYPE_COLORS[f.type];
          const isActive = i === activeIdx;
          const pageEl   = pageElsRef.current.get(pageNum);
          const pxW      = pageEl ? f.w * pageEl.offsetWidth : 200;
          const pxH      = pageEl ? f.h * pageEl.offsetHeight : 40;
          const sc       = Math.max(0.3, Math.min(1, pxW / 140, pxH / 36));

          return (
            <div key={f.id}
              style={{
                position: "absolute",
                left: `${f.x * 100}%`, top: `${f.y * 100}%`,
                width: `${f.w * 100}%`, height: `${f.h * 100}%`,
                border: `1.5px solid ${isActive ? colors.border : colors.border + "88"}`,
                background: colors.bg,
                borderRadius: 4,
                cursor: "move",
                boxSizing: "border-box",
                display: "flex", alignItems: "center", justifyContent: "center",
                zIndex: isActive ? 2 : 1,
                boxShadow: isActive ? `0 0 0 1px ${colors.border}44, 0 2px 10px rgba(0,0,0,0.2)` : "none",
              }}
              onMouseDown={e => {
                if (e.button !== 0) return;
                e.preventDefault(); e.stopPropagation();
                setActiveIdx(i);
                const el = pageElsRef.current.get(pageNum);
                if (!el) return;
                const rect = el.getBoundingClientRect();
                dragRef.current = {
                  mode: "move", idx: i,
                  startCX: e.clientX, startCY: e.clientY,
                  startCx: rect.left + (f.x + f.w / 2) * rect.width,
                  startCy: rect.top  + (f.y + f.h / 2) * rect.height,
                  startField: { ...f },
                };
              }}
              onClick={e => e.stopPropagation()}
            >
              {/* Label */}
              <span style={{ fontSize: Math.max(8, Math.round(11 * sc)), color: colors.text, fontWeight: 700, pointerEvents: "none", userSelect: "none", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "90%", padding: "0 4px" }}>
                {f.type === "checkbox" ? "☐ " : f.type === "date" ? "📅 " : "T "}{f.label}
              </span>

              {/* Type pill + delete */}
              <div style={{ position: "absolute", top: -1, left: -1, display: "flex", alignItems: "stretch", zIndex: 5, borderRadius: "4px 4px 5px 0", boxShadow: "0 1px 6px rgba(0,0,0,0.35)" }}>
                <div style={{ fontSize: Math.max(6, Math.round(7 * sc)), fontWeight: 800, padding: `${Math.max(1, Math.round(2 * sc))}px ${Math.max(3, Math.round(6 * sc))}px`, borderRadius: "4px 0 0 0", background: colors.border, color: "#131312", lineHeight: 1.7, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                  {colors.label}
                </div>
                <button
                  style={{ padding: `${Math.max(1, Math.round(2 * sc))}px ${Math.max(3, Math.round(4 * sc))}px`, borderRadius: "0 4px 4px 0", background: "rgba(15,15,15,0.75)", color: "rgba(255,255,255,0.85)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: Math.max(7, Math.round(9 * sc)), lineHeight: 1 }}
                  onMouseDown={e => e.stopPropagation()}
                  onClick={e => { e.stopPropagation(); removeField(i); }}
                >✕</button>
              </div>

              {/* Resize handles */}
              {isActive && HANDLES.map(h => (
                <div key={h.id}
                  style={{ position: "absolute", top: h.top, left: h.left, transform: "translate(-50%,-50%)", width: Math.max(7, Math.round(14 * sc)), height: Math.max(7, Math.round(14 * sc)), background: "#fff", border: `${Math.max(1.5, 2.5 * sc)}px solid ${colors.border}`, borderRadius: "50%", cursor: h.cursor, zIndex: 4, boxShadow: `0 2px 8px rgba(0,0,0,0.5)` }}
                  onMouseDown={e => {
                    if (e.button !== 0) return;
                    e.preventDefault(); e.stopPropagation();
                    const el = pageElsRef.current.get(pageNum);
                    if (!el) return;
                    const rect = el.getBoundingClientRect();
                    dragRef.current = { mode: "resize", idx: i, handle: h.id, startCX: e.clientX, startCY: e.clientY, startField: { ...f }, pageW: rect.width, pageH: rect.height, page: pageNum };
                  }}
                />
              ))}
            </div>
          );
        })}
      </div>
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, activeIdx]);

  if (!blobUrl) {
    return (
      <div style={{ height: "62dvh", borderRadius: 12, overflow: "hidden", border: "1px solid var(--border)", background: "#525659", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Spinner size="md" />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button
          onClick={addField}
          className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold px-3 py-1.5 rounded-xl transition-colors"
          style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>
          + Add field
        </button>

        {activeField && (
          <>
            <div style={{ width: 1, height: 20, background: "var(--border)" }} />
            {/* Label input */}
            <input
              value={activeField.label}
              onChange={e => updateActive({ label: e.target.value })}
              onClick={e => e.stopPropagation()}
              placeholder="Field label"
              className="px-2.5 py-1 text-[12px] outline-none"
              style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--w)", minWidth: 120, maxWidth: 180 }}
            />
            {/* Type selector */}
            <div style={{ display: "flex", gap: 4 }}>
              {TYPES.map(tp => (
                <button key={tp} onClick={() => updateActive({ type: tp })}
                  className="text-[10.5px] font-semibold px-2 py-1 rounded-lg transition-all"
                  style={{ background: activeField.type === tp ? TYPE_COLORS[tp].border : "var(--bg2)", color: activeField.type === tp ? "#131312" : "var(--w3)", border: `1px solid ${activeField.type === tp ? TYPE_COLORS[tp].border : "var(--border)"}` }}>
                  {TYPE_COLORS[tp].label}
                </button>
              ))}
            </div>
            {/* Delete */}
            <button onClick={() => { removeField(activeIdx!); }}
              className="bv-icon-btn w-7 h-7 flex items-center justify-center rounded-full"
              style={{ color: "var(--danger)" }}>
              <Trash2 size={12} strokeWidth={1.8} />
            </button>
          </>
        )}

        {fields.length === 0 && (
          <span className="text-[11px]" style={{ color: "var(--w3)" }}>Draw boxes on the PDF to place form fields</span>
        )}
      </div>

      {/* PDF with overlay */}
      <div style={{ position: "relative", height: "58dvh", borderRadius: 12, overflow: "hidden", border: "1px solid var(--border)" }}>
        <PdfViewer src={blobUrl} hideRotate pageOverlay={pageOverlay} onPagesLoaded={n => setPageCount(n)} />
      </div>
      <p style={{ fontSize: 10, color: "var(--w3)", textAlign: "center" }}>
        {pageCount} page{pageCount !== 1 ? "s" : ""} · Drag to draw · Click to select · Drag corners to resize
      </p>
    </div>
  );
}
