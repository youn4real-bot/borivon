"use client";

import { useRef, useState, useEffect } from "react";
import { PdfViewer, PageOverlayFn } from "@/components/PdfViewer";
import { Spinner } from "@/components/ui/states";

export type SigZone = { page: number; x: number; y: number; w: number; h: number; party?: "admin" | "candidate" };

const T = {
  en: { signHere: "✍ Sign here" },
  fr: { signHere: "✍ Signer ici" },
  de: { signHere: "✍ Hier unterschreiben" },
} as const;

type Props = {
  pdfBase64: string;
  onChange: (zones: SigZone[]) => void;
  onError?: () => void;
  lang?: keyof typeof T;
};

const PARTY_COLORS = {
  candidate: { border: "var(--gold)", bg: "rgba(201,162,64,0.15)", text: "var(--gold)" },
  admin:     { border: "#5b9bd5",     bg: "rgba(91,155,213,0.15)",  text: "#5b9bd5"    },
};

type DragState =
  | { mode: "move"; idx: number; startClientX: number; startClientY: number; startCx: number; startCy: number; startZone: SigZone }
  | { mode: "resize"; idx: number; handle: string; startClientX: number; startClientY: number; startZone: SigZone; pageW: number; pageH: number; page: number }
  | { mode: "draw"; startClientX: number; startClientY: number; page: number };

const HANDLES = [
  { id: "nw", top: "0%",   left: "0%",   cursor: "nw-resize" },
  { id: "n",  top: "0%",   left: "50%",  cursor: "n-resize"  },
  { id: "ne", top: "0%",   left: "100%", cursor: "ne-resize" },
  { id: "e",  top: "50%",  left: "100%", cursor: "e-resize"  },
  { id: "se", top: "100%", left: "100%", cursor: "se-resize" },
  { id: "s",  top: "100%", left: "50%",  cursor: "s-resize"  },
  { id: "sw", top: "100%", left: "0%",   cursor: "sw-resize" },
  { id: "w",  top: "50%",  left: "0%",   cursor: "w-resize"  },
] as const;

export function PdfZonePicker({ pdfBase64, onChange, onError, lang = "en" }: Props) {
  const [blobUrl, setBlobUrl]     = useState<string | null>(null);
  const [zones, setZones]         = useState<SigZone[]>([{ page: 1, x: 0.48, y: 0.74, w: 0.44, h: 0.13, party: "candidate" }]);
  const [activeIdx, setActiveIdx] = useState<number | null>(0);
  const [pageCount, setPageCount] = useState(1);

  const zonesRef    = useRef(zones);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; });
  useEffect(() => { zonesRef.current = zones; }, [zones]);

  const pageElsRef = useRef<Map<number, HTMLElement>>(new Map());
  const dragRef    = useRef<DragState | null>(null);

  function emitZones(z: SigZone[]) {
    zonesRef.current = z;
    setZones(z);
    onChangeRef.current(z);
  }

  useEffect(() => {
    if (!pdfBase64) return;
    try {
      const bytes = Uint8Array.from(atob(pdfBase64), c => c.charCodeAt(0));
      const blob  = new Blob([bytes], { type: "application/pdf" });
      const url   = URL.createObjectURL(blob);
      setBlobUrl(url);
      return () => URL.revokeObjectURL(url);
    } catch {
      onError?.();
    }
  }, [pdfBase64]); // eslint-disable-line react-hooks/exhaustive-deps

  function pageFromClient(clientX: number, clientY: number): { pageNum: number; rect: DOMRect } | null {
    let best: { pageNum: number; rect: DOMRect; dist: number } | null = null;
    for (const [pageNum, el] of pageElsRef.current) {
      const rect = el.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        return { pageNum, rect };
      }
      const dy   = Math.max(rect.top - clientY, 0, clientY - rect.bottom);
      const dx   = Math.max(rect.left - clientX, 0, clientX - rect.right);
      const dist = Math.hypot(dx, dy);
      if (!best || dist < best.dist) best = { pageNum, rect, dist };
    }
    return best ? { pageNum: best.pageNum, rect: best.rect } : null;
  }

  useEffect(() => {
    const MIN_PX = 16;

    function onMove(e: MouseEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      e.preventDefault();
      const zs = zonesRef.current;

      if (drag.mode === "move") {
        const { idx, startClientX, startClientY, startCx, startCy, startZone } = drag;
        const dx  = e.clientX - startClientX;
        const dy  = e.clientY - startClientY;
        const hit = pageFromClient(startCx + dx, startCy + dy);
        if (!hit) return;
        const { pageNum, rect } = hit;
        const next = [...zs];
        next[idx] = {
          ...startZone,
          page: pageNum,
          x: Math.max(0, Math.min(1 - startZone.w, (startCx + dx - rect.left) / rect.width  - startZone.w / 2)),
          y: Math.max(0, Math.min(1 - startZone.h, (startCy + dy - rect.top)  / rect.height - startZone.h / 2)),
        };
        emitZones(next);

      } else if (drag.mode === "resize") {
        const { idx, handle, startClientX, startClientY, startZone, pageW, pageH, page } = drag;
        const dx = (e.clientX - startClientX) / pageW;
        const dy = (e.clientY - startClientY) / pageH;
        let { x, y, w, h } = startZone;
        if (handle.includes("n")) { y += dy; h -= dy; }
        if (handle.includes("s")) { h += dy; }
        if (handle.includes("w")) { x += dx; w -= dx; }
        if (handle.includes("e")) { w += dx; }
        const minW = MIN_PX / pageW, minH = MIN_PX / pageH;
        if (w < minW) { if (handle.includes("w")) x = startZone.x + startZone.w - minW; w = minW; }
        if (h < minH) { if (handle.includes("n")) y = startZone.y + startZone.h - minH; h = minH; }
        const next = [...zs];
        next[idx] = { ...startZone, page, x: Math.max(0, x), y: Math.max(0, y), w: Math.min(1 - Math.max(0, x), w), h: Math.min(1 - Math.max(0, y), h) };
        emitZones(next);

      } else if (drag.mode === "draw") {
        const { startClientX, startClientY, page } = drag;
        const el = pageElsRef.current.get(page);
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const x1 = (startClientX - rect.left) / rect.width;
        const y1 = (startClientY - rect.top)  / rect.height;
        const x2 = (e.clientX   - rect.left) / rect.width;
        const y2 = (e.clientY   - rect.top)  / rect.height;
        const x  = Math.min(x1, x2), y = Math.min(y1, y2);
        const w  = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
        const drawIdx = zs.length - 1;
        const next = [...zs];
        next[drawIdx] = { ...next[drawIdx], x: Math.max(0, x), y: Math.max(0, y), w: Math.min(1 - Math.max(0, x), w), h: Math.min(1 - Math.max(0, y), h) };
        emitZones(next);
      }
    }

    function onUp() {
      const drag = dragRef.current;
      dragRef.current = null;
      if (drag?.mode === "draw") {
        const zs = zonesRef.current;
        const drawIdx = zs.length - 1;
        const z = zs[drawIdx];
        if (z && (z.w < 0.02 || z.h < 0.01)) {
          const trimmed = zs.filter((_, i) => i !== drawIdx);
          emitZones(trimmed);
          setActiveIdx(trimmed.length > 0 ? trimmed.length - 1 : null);
        }
      }
    }

    window.addEventListener("mousemove", onMove, { passive: false });
    window.addEventListener("mouseup",   onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function addZone() {
    const zs = zonesRef.current;
    const newZone: SigZone = { page: pageCount, x: 0.08, y: 0.1, w: 0.44, h: 0.13, party: "candidate" };
    const next = [...zs, newZone];
    emitZones(next);
    setActiveIdx(next.length - 1);
  }

  function removeZone(i: number) {
    const zs = zonesRef.current;
    const next = zs.filter((_, idx) => idx !== i);
    emitZones(next);
    setActiveIdx(next.length > 0 ? Math.min(i, next.length - 1) : null);
  }

  function toggleParty(i: number) {
    const zs = zonesRef.current;
    const next = [...zs];
    next[i] = { ...next[i], party: next[i].party === "admin" ? "candidate" : "admin" };
    emitZones(next);
  }

  const pageOverlay: PageOverlayFn = ({ pageNum }) => {
    const zs = zones;
    return (
      <div
        ref={el => {
          if (el) pageElsRef.current.set(pageNum, el);
          else    pageElsRef.current.delete(pageNum);
        }}
        style={{ position: "absolute", inset: 0, cursor: "crosshair" }}
        onMouseDown={e => {
          if (e.button !== 0) return;
          e.preventDefault();
          const placeholder: SigZone = { page: pageNum, x: 0, y: 0, w: 0, h: 0, party: "candidate" };
          const next = [...zonesRef.current, placeholder];
          emitZones(next);
          setActiveIdx(next.length - 1);
          dragRef.current = { mode: "draw", startClientX: e.clientX, startClientY: e.clientY, page: pageNum };
        }}
      >
        {zs.map((z, i) => {
          if (z.page !== pageNum) return null;
          const colors   = PARTY_COLORS[z.party ?? "candidate"];
          const isActive = i === activeIdx;
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left:   `${z.x * 100}%`,
                top:    `${z.y * 100}%`,
                width:  `${z.w * 100}%`,
                height: `${z.h * 100}%`,
                border: `2.5px solid ${colors.border}`,
                background: colors.bg,
                borderRadius: 4,
                cursor: "move",
                boxSizing: "border-box",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: isActive ? 2 : 1,
              }}
              onMouseDown={e => {
                if (e.button !== 0) return;
                e.preventDefault();
                e.stopPropagation();
                setActiveIdx(i);
                const el = pageElsRef.current.get(pageNum);
                if (!el) return;
                const rect = el.getBoundingClientRect();
                dragRef.current = {
                  mode: "move",
                  idx: i,
                  startClientX: e.clientX,
                  startClientY: e.clientY,
                  startCx: rect.left + (z.x + z.w / 2) * rect.width,
                  startCy: rect.top  + (z.y + z.h / 2) * rect.height,
                  startZone: { ...z },
                };
              }}
            >
              <span style={{
                fontSize: 11, color: colors.text, fontWeight: 700,
                textShadow: "0 1px 4px rgba(0,0,0,0.8)",
                pointerEvents: "none", userSelect: "none",
              }}>
                {T[lang].signHere}
              </span>

              {/* Party pill — top-left, click to toggle */}
              <button
                style={{
                  position: "absolute", top: -1, left: -1,
                  fontSize: 9, fontWeight: 700, padding: "1px 5px",
                  borderRadius: "3px 0 3px 0",
                  background: colors.bg,
                  color: colors.text,
                  border: `1px solid ${colors.border}`,
                  cursor: "pointer", lineHeight: 1.5, zIndex: 3,
                }}
                onMouseDown={e => e.stopPropagation()}
                onClick={e => { e.stopPropagation(); toggleParty(i); }}
              >
                {z.party === "admin" ? "Admin" : (lang === "de" ? "Kandidat" : lang === "fr" ? "Candidat" : "Candidate")}
              </button>

              {/* Remove × — top-right */}
              <button
                style={{
                  position: "absolute", top: -1, right: -1,
                  width: 16, height: 16,
                  borderRadius: "0 3px 0 3px",
                  background: "rgba(0,0,0,0.65)",
                  color: "#fff", border: "none", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  zIndex: 3,
                }}
                onMouseDown={e => e.stopPropagation()}
                onClick={e => { e.stopPropagation(); removeZone(i); }}
              >
                <span style={{ fontSize: 9, fontWeight: 700, lineHeight: 1 }}>✕</span>
              </button>

              {/* Resize handles — only on active zone */}
              {isActive && HANDLES.map(h => (
                <div
                  key={h.id}
                  style={{
                    position: "absolute",
                    top: h.top, left: h.left,
                    transform: "translate(-50%, -50%)",
                    width: 10, height: 10,
                    background: colors.border,
                    border: "2px solid #131312",
                    borderRadius: 2,
                    cursor: h.cursor,
                    zIndex: 4,
                  }}
                  onMouseDown={e => {
                    if (e.button !== 0) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const el = pageElsRef.current.get(pageNum);
                    if (!el) return;
                    const rect = el.getBoundingClientRect();
                    dragRef.current = {
                      mode: "resize",
                      idx: i,
                      handle: h.id,
                      startClientX: e.clientX,
                      startClientY: e.clientY,
                      startZone: { ...z },
                      pageW: rect.width,
                      pageH: rect.height,
                      page: pageNum,
                    };
                  }}
                />
              ))}
            </div>
          );
        })}
      </div>
    );
  };

  if (!blobUrl) {
    return (
      <div style={{
        height: "62dvh", borderRadius: 12, overflow: "hidden",
        border: "1px solid var(--border)", background: "#525659",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <Spinner size="md" />
      </div>
    );
  }

  return (
    <div
      style={{ position: "relative", height: "62dvh", borderRadius: 12, overflow: "hidden", border: "1px solid var(--border)" }}
      onWheel={e => e.stopPropagation()}
    >
      <PdfViewer
        src={blobUrl}
        hideRotate
        pageOverlay={pageOverlay}
        onPagesLoaded={count => {
          setPageCount(count);
          const z: SigZone = { page: count, x: 0.48, y: 0.74, w: 0.44, h: 0.13, party: "candidate" };
          emitZones([z]);
          setActiveIdx(0);
        }}
      />
      {/* "+" button rendered after PdfViewer so it naturally sits on top in stacking order */}
      <button
        onClick={addZone}
        onMouseDown={e => e.stopPropagation()}
        style={{
          position: "absolute", top: 10, right: 10, zIndex: 100,
          width: 28, height: 28, borderRadius: 8,
          background: "var(--gold)", color: "#131312",
          border: "none", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontWeight: 800, fontSize: 16, lineHeight: 1,
          boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
        }}
        title="Add signature zone"
      >
        +
      </button>
    </div>
  );
}
