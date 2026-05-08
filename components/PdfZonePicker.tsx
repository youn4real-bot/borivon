"use client";

import { useRef, useState, useEffect } from "react";
import { PdfViewer, PageOverlayFn } from "@/components/PdfViewer";
import { Spinner } from "@/components/ui/states";

export type SigZone = { page: number; x: number; y: number; w: number; h: number };

const T = {
  en: { signHere: "✍ Sign here" },
  fr: { signHere: "✍ Signer ici" },
  de: { signHere: "✍ Hier unterschreiben" },
} as const;

type Props = {
  pdfBase64: string;
  onChange: (z: SigZone) => void;
  onError?: () => void;
  lang?: keyof typeof T;
};

type DragState =
  | { mode: "move"; startClientX: number; startClientY: number; startCenterClientX: number; startCenterClientY: number; startZone: SigZone }
  | { mode: "resize"; handle: string; startClientX: number; startClientY: number; startZone: SigZone; pageW: number; pageH: number; page: number }
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
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [zone,    setZone]    = useState<SigZone>({ page: 1, x: 0.48, y: 0.74, w: 0.44, h: 0.13 });

  const zoneRef     = useRef(zone);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; });
  useEffect(() => { zoneRef.current = zone; }, [zone]);

  // pageNum → overlay element (position: absolute, inset: 0 within each page div)
  const pageElsRef = useRef<Map<number, HTMLElement>>(new Map());
  const dragRef    = useRef<DragState | null>(null);

  function emitZone(z: SigZone) {
    zoneRef.current = z;
    setZone(z);
    onChangeRef.current(z);
  }

  // base64 → blob URL (avoids any URL/cookie auth issues for pdfjs)
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

  // Find which page overlay element the client point is on; nearest by distance during cross-page drag
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

  // Global drag handlers — window level prevents outer modal scroll hijack
  useEffect(() => {
    const MIN_PX = 16;

    function onMove(e: MouseEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      e.preventDefault();

      if (drag.mode === "move") {
        const dx    = e.clientX - drag.startClientX;
        const dy    = e.clientY - drag.startClientY;
        const newCx = drag.startCenterClientX + dx;
        const newCy = drag.startCenterClientY + dy;
        const hit   = pageFromClient(newCx, newCy);
        if (!hit) return;
        const { pageNum, rect } = hit;
        const z = zoneRef.current;
        emitZone({
          page: pageNum,
          x: Math.max(0, Math.min(1 - z.w, (newCx - rect.left) / rect.width  - z.w / 2)),
          y: Math.max(0, Math.min(1 - z.h, (newCy - rect.top)  / rect.height - z.h / 2)),
          w: z.w, h: z.h,
        });

      } else if (drag.mode === "resize") {
        const { handle, startClientX, startClientY, startZone, pageW, pageH, page } = drag;
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
        emitZone({ page, x: Math.max(0, x), y: Math.max(0, y), w: Math.min(1 - Math.max(0, x), w), h: Math.min(1 - Math.max(0, y), h) });

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
        if (w > 0.02 && h > 0.01) {
          emitZone({ page, x: Math.max(0, x), y: Math.max(0, y), w: Math.min(1 - Math.max(0, x), w), h: Math.min(1 - Math.max(0, y), h) });
        }
      }
    }

    function onUp() { dragRef.current = null; }

    window.addEventListener("mousemove", onMove, { passive: false });
    window.addEventListener("mouseup",   onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // pageOverlay — injected into PdfViewer's existing page overlay system
  const pageOverlay: PageOverlayFn = ({ pageNum }) => {
    const z = zone; // closes over current zone state (re-created on each zone change)
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
          dragRef.current = { mode: "draw", startClientX: e.clientX, startClientY: e.clientY, page: pageNum };
        }}
      >
        {z.page === pageNum && (
          <div
            style={{
              position: "absolute",
              left:   `${z.x * 100}%`,
              top:    `${z.y * 100}%`,
              width:  `${z.w * 100}%`,
              height: `${z.h * 100}%`,
              border: "2.5px solid var(--gold)",
              background: "rgba(201,162,64,0.15)",
              borderRadius: 4,
              cursor: "move",
              boxSizing: "border-box",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            onMouseDown={e => {
              if (e.button !== 0) return;
              e.preventDefault();
              e.stopPropagation();
              const el = pageElsRef.current.get(pageNum);
              if (!el) return;
              const rect = el.getBoundingClientRect();
              dragRef.current = {
                mode: "move",
                startClientX: e.clientX,
                startClientY: e.clientY,
                startCenterClientX: rect.left + (z.x + z.w / 2) * rect.width,
                startCenterClientY: rect.top  + (z.y + z.h / 2) * rect.height,
                startZone: { ...z },
              };
            }}
          >
            <span style={{
              fontSize: 11, color: "var(--gold)", fontWeight: 700,
              textShadow: "0 1px 4px rgba(0,0,0,0.8)",
              pointerEvents: "none", userSelect: "none",
            }}>
              {T[lang].signHere}
            </span>

            {HANDLES.map(h => (
              <div
                key={h.id}
                style={{
                  position: "absolute",
                  top: h.top, left: h.left,
                  transform: "translate(-50%, -50%)",
                  width: 10, height: 10,
                  background: "var(--gold)",
                  border: "2px solid #131312",
                  borderRadius: 2,
                  cursor: h.cursor,
                  zIndex: 1,
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
        )}
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
      style={{ height: "62dvh", borderRadius: 12, overflow: "hidden", border: "1px solid var(--border)" }}
      onWheel={e => e.stopPropagation()}
    >
      <PdfViewer
        src={blobUrl}
        hideRotate
        pageOverlay={pageOverlay}
        onPagesLoaded={count => {
          const z: SigZone = { page: count, x: 0.48, y: 0.74, w: 0.44, h: 0.13 };
          emitZone(z);
        }}
      />
    </div>
  );
}
