"use client";

import { useRef, useState, useEffect } from "react";
import { Spinner } from "@/components/ui/states";

export type SigZone = {
  page: number; // 1-indexed
  x: number;    // normalized 0-1 from left
  y: number;    // normalized 0-1 from top
  w: number;    // normalized 0-1
  h: number;    // normalized 0-1
};

function defaultZone(page: number): SigZone {
  return { page, x: 0.48, y: 0.74, w: 0.44, h: 0.13 };
}

// Lazy singleton so the worker is configured only once
let _pdfjs: typeof import("pdfjs-dist") | null = null;
async function getPdfJs() {
  if (_pdfjs) return _pdfjs;
  const lib = await import("pdfjs-dist");
  lib.GlobalWorkerOptions.workerSrc =
    `https://unpkg.com/pdfjs-dist@${lib.version}/build/pdf.worker.min.mjs`;
  _pdfjs = lib;
  return lib;
}

type Props = {
  pdfBase64: string;         // raw base64, no "data:" prefix
  onChange: (z: SigZone) => void;
};

export function PdfZonePicker({ pdfBase64, onChange }: Props) {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdfDoc, setPdfDoc]     = useState<import("pdfjs-dist").PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(1);
  const [page, setPage]         = useState(1);
  const [loading, setLoading]   = useState(true);
  const [zone, setZone]         = useState<SigZone>(defaultZone(1));

  const drawRef = useRef<{ sx: number; sy: number } | null>(null);
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);

  // Load PDF from base64
  useEffect(() => {
    if (!pdfBase64) return;
    let active = true;
    (async () => {
      try {
        const lib   = await getPdfJs();
        const bytes = Uint8Array.from(atob(pdfBase64), c => c.charCodeAt(0));
        const doc   = await lib.getDocument({ data: bytes }).promise;
        if (!active) return;
        const pc = doc.numPages;
        setPdfDoc(doc);
        setPageCount(pc);
        setPage(pc);
        const z = defaultZone(pc);
        setZone(z);
        onChange(z);
      } catch (e) {
        console.error("[PdfZonePicker] load error", e);
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [pdfBase64]); // eslint-disable-line react-hooks/exhaustive-deps

  // Render current page when doc or page changes
  useEffect(() => {
    if (!pdfDoc) return;
    let active = true;
    setLoading(true);
    (async () => {
      try {
        const pg        = await pdfDoc.getPage(page);
        if (!active) return;
        const container = containerRef.current;
        const canvas    = canvasRef.current;
        if (!canvas || !container) return;
        const cw        = container.clientWidth || 400;
        const baseVp    = pg.getViewport({ scale: 1 });
        const vp        = pg.getViewport({ scale: cw / baseVp.width });
        canvas.width    = vp.width;
        canvas.height   = vp.height;
        const ctx       = canvas.getContext("2d")!;
        ctx.clearRect(0, 0, vp.width, vp.height);
        await pg.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
        if (active) setLoading(false);
      } catch {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [pdfDoc, page]);

  function relPos(e: React.MouseEvent) {
    const r = canvasRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top)  / r.height)),
    };
  }

  function inZone(px: number, py: number) {
    return px >= zone.x && px <= zone.x + zone.w
        && py >= zone.y && py <= zone.y + zone.h;
  }

  function emit(z: SigZone) {
    setZone(z);
    onChange(z);
  }

  function onDown(e: React.MouseEvent) {
    e.preventDefault();
    const p = relPos(e);
    if (inZone(p.x, p.y)) {
      dragRef.current = { sx: p.x, sy: p.y, ox: zone.x, oy: zone.y };
    } else {
      drawRef.current = { sx: p.x, sy: p.y };
    }
  }

  function onMove(e: React.MouseEvent) {
    const p = relPos(e);
    if (dragRef.current) {
      const dx = p.x - dragRef.current.sx;
      const dy = p.y - dragRef.current.sy;
      emit({
        ...zone,
        x: Math.max(0, Math.min(1 - zone.w, dragRef.current.ox + dx)),
        y: Math.max(0, Math.min(1 - zone.h, dragRef.current.oy + dy)),
        page,
      });
    } else if (drawRef.current) {
      const x = Math.min(drawRef.current.sx, p.x);
      const y = Math.min(drawRef.current.sy, p.y);
      const w = Math.abs(p.x - drawRef.current.sx);
      const h = Math.abs(p.y - drawRef.current.sy);
      if (w > 0.03 && h > 0.02) emit({ page, x, y, w, h });
    }
  }

  function onUp() {
    drawRef.current = null;
    dragRef.current = null;
  }

  function changePage(p: number) {
    setPage(p);
    const z = { ...defaultZone(p), page: p };
    setZone(z);
    onChange(z);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px]" style={{ color: "var(--w3)" }}>
          Drag to draw the zone · Move the gold box to reposition
        </span>
        {pageCount > 1 && (
          <div className="flex gap-1">
            {Array.from({ length: pageCount }, (_, i) => i + 1).map(p => (
              <button key={p} type="button" onClick={() => changePage(p)}
                className="w-6 h-6 rounded text-[10px] font-bold transition-colors"
                style={{
                  background: p === page ? "var(--gold)" : "var(--bg2)",
                  color:      p === page ? "#131312"     : "var(--w3)",
                }}>
                {p}
              </button>
            ))}
          </div>
        )}
      </div>

      <div ref={containerRef} className="relative select-none rounded-xl"
        style={{ border: "1.5px solid var(--border-gold)" }}>
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.55)" }}>
            <Spinner size="md" />
          </div>
        )}

        <canvas
          ref={canvasRef}
          style={{ display: "block", width: "100%", height: "auto", cursor: "crosshair" }}
          onMouseDown={onDown}
          onMouseMove={onMove}
          onMouseUp={onUp}
          onMouseLeave={onUp}
        />

        {/* Zone overlay */}
        <div className="absolute pointer-events-none" style={{
          left:       `${zone.x * 100}%`,
          top:        `${zone.y * 100}%`,
          width:      `${zone.w * 100}%`,
          height:     `${zone.h * 100}%`,
          border:     "2px solid var(--gold)",
          background: "var(--gdim)",
          borderRadius: 4,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <span style={{
            fontSize: 10, color: "var(--gold)", fontWeight: 700,
            textShadow: "0 1px 3px rgba(0,0,0,0.7)",
          }}>
            ✍ Sign here
          </span>
        </div>
      </div>
    </div>
  );
}
