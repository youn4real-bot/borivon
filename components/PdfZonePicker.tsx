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

let _pdfjs: typeof import("pdfjs-dist") | null = null;
async function getPdfJs() {
  if (_pdfjs) return _pdfjs;
  const lib = await import("pdfjs-dist");
  lib.GlobalWorkerOptions.workerSrc =
    `https://unpkg.com/pdfjs-dist@${lib.version}/build/pdf.worker.min.mjs`;
  _pdfjs = lib;
  return lib;
}

const T = {
  en: { hint: "Draw zone · Drag gold box to reposition · Drag to top/bottom edge to change page", signHere: "✍ Sign here", prevPage: "↑ Release → page", nextPage: "↓ Release → page" },
  fr: { hint: "Dessinez la zone · Déplacez le cadre · Glissez au bord pour changer de page", signHere: "✍ Signer ici", prevPage: "↑ Relâcher → page", nextPage: "↓ Relâcher → page" },
  de: { hint: "Zone zeichnen · Rahmen verschieben · An Rand ziehen für Seitenwechsel", signHere: "✍ Hier unterschreiben", prevPage: "↑ Loslassen → Seite", nextPage: "↓ Loslassen → Seite" },
} as const;

type Props = {
  pdfBase64: string;
  onChange: (z: SigZone) => void;
  onError?: () => void;
  lang?: keyof typeof T;
};

export function PdfZonePicker({ pdfBase64, onChange, onError, lang = "en" }: Props) {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdfDoc, setPdfDoc]     = useState<import("pdfjs-dist").PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(1);
  const [page, setPage]           = useState(1);
  const [loading, setLoading]     = useState(true);
  const [zone, setZone]           = useState<SigZone>(defaultZone(1));
  const [edgeHint, setEdgeHint]   = useState<"prev" | "next" | null>(null);

  // Stable refs so global handlers never have stale closure state
  const zoneRef      = useRef(zone);
  const pageRef      = useRef(page);
  const pageCountRef = useRef(pageCount);
  const edgeHintRef  = useRef<"prev" | "next" | null>(null);
  const onChangeRef  = useRef(onChange);
  const drawRef = useRef<{ sx: number; sy: number } | null>(null);
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);

  useEffect(() => { onChangeRef.current = onChange; });
  useEffect(() => { zoneRef.current = zone; }, [zone]);
  useEffect(() => { pageRef.current = page; }, [page]);
  useEffect(() => { pageCountRef.current = pageCount; }, [pageCount]);

  // Load PDF
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
        pageCountRef.current = pc;
        setPage(pc);
        pageRef.current = pc;
        const z = defaultZone(pc);
        setZone(z);
        zoneRef.current = z;
        onChange(z);
      } catch (e) {
        console.error("[PdfZonePicker] load error", e);
        if (active) { setLoading(false); onError?.(); }
      }
    })();
    return () => { active = false; };
  }, [pdfBase64]); // eslint-disable-line react-hooks/exhaustive-deps

  // Render page
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

  // Get normalized position relative to canvas (raw = unclamped, for edge detection)
  function getRawPos(clientX: number, clientY: number) {
    const r = canvasRef.current!.getBoundingClientRect();
    return {
      x: (clientX - r.left) / r.width,
      y: (clientY - r.top)  / r.height,
    };
  }

  function emitZone(z: SigZone) {
    zoneRef.current = z;
    setZone(z);
    onChangeRef.current(z);
  }

  // Global handlers — active for the full lifecycle of a drag/draw.
  // Attaching to window (not canvas) means:
  //   - drag never dies if mouse briefly exits canvas
  //   - e.preventDefault() kills any parent scroll during drag
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragRef.current && !drawRef.current) return;
      e.preventDefault(); // block outer modal scroll during drag

      const canvas = canvasRef.current;
      if (!canvas) return;

      const raw = getRawPos(e.clientX, e.clientY);
      const px  = Math.max(0, Math.min(1, raw.x));
      const py  = Math.max(0, Math.min(1, raw.y));
      const z   = zoneRef.current;
      const cur = pageRef.current;
      const pc  = pageCountRef.current;

      if (dragRef.current) {
        const dx = px - dragRef.current.sx;
        const dy = py - dragRef.current.sy;

        // Edge zones: mouse above/below canvas → page flip hint
        if (raw.y < -0.08 && cur > 1) {
          edgeHintRef.current = "prev";
          setEdgeHint("prev");
        } else if (raw.y > 1.08 && cur < pc) {
          edgeHintRef.current = "next";
          setEdgeHint("next");
        } else {
          edgeHintRef.current = null;
          setEdgeHint(null);
          emitZone({
            ...z,
            x: Math.max(0, Math.min(1 - z.w, dragRef.current.ox + dx)),
            y: Math.max(0, Math.min(1 - z.h, dragRef.current.oy + dy)),
            page: cur,
          });
        }
      } else if (drawRef.current) {
        const x = Math.min(drawRef.current.sx, px);
        const y = Math.min(drawRef.current.sy, py);
        const w = Math.abs(px - drawRef.current.sx);
        const h = Math.abs(py - drawRef.current.sy);
        if (w > 0.03 && h > 0.02) emitZone({ page: cur, x, y, w, h });
      }
    }

    function onUp(e: MouseEvent) {
      if (!dragRef.current && !drawRef.current) return;

      const hint = edgeHintRef.current;
      const cur  = pageRef.current;
      const pc   = pageCountRef.current;
      const z    = zoneRef.current;

      // Page flip: place zone at the near edge of the new page
      if (dragRef.current && hint) {
        if (hint === "prev" && cur > 1) {
          const newPage = cur - 1;
          const newZ = { ...z, page: newPage, y: Math.min(0.85, 1 - z.h - 0.02) };
          pageRef.current = newPage;
          setPage(newPage);
          emitZone(newZ);
        } else if (hint === "next" && cur < pc) {
          const newPage = cur + 1;
          const newZ = { ...z, page: newPage, y: 0.02 };
          pageRef.current = newPage;
          setPage(newPage);
          emitZone(newZ);
        }
      }

      dragRef.current    = null;
      drawRef.current    = null;
      edgeHintRef.current = null;
      setEdgeHint(null);
      void e; // suppress lint
    }

    window.addEventListener("mousemove", onMove, { passive: false });
    window.addEventListener("mouseup",   onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function onCanvasDown(e: React.MouseEvent) {
    e.preventDefault();
    const raw = getRawPos(e.clientX, e.clientY);
    const px  = Math.max(0, Math.min(1, raw.x));
    const py  = Math.max(0, Math.min(1, raw.y));
    const z   = zoneRef.current;
    if (px >= z.x && px <= z.x + z.w && py >= z.y && py <= z.y + z.h) {
      dragRef.current = { sx: px, sy: py, ox: z.x, oy: z.y };
    } else {
      drawRef.current = { sx: px, sy: py };
    }
  }

  function changePage(p: number) {
    pageRef.current = p;
    setPage(p);
    // Preserve zone x/y/w/h — only page changes
    const z = { ...zoneRef.current, page: p };
    emitZone(z);
  }

  return (
    // onWheel stopPropagation prevents outer modal scroll when wheeling over the picker
    <div className="space-y-2" onWheel={e => e.stopPropagation()}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-[11px]" style={{ color: "var(--w3)" }}>
          {T[lang].hint}
        </span>
        {pageCount > 1 && (
          <div className="flex gap-1 flex-shrink-0">
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
        style={{ border: `1.5px solid ${edgeHint ? "var(--gold)" : "var(--border-gold)"}`, transition: "border-color 0.1s" }}>

        {/* Prev-page edge hint */}
        {edgeHint === "prev" && page > 1 && (
          <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-center py-1.5 pointer-events-none"
            style={{ background: "rgba(201,162,64,0.9)", borderRadius: "10px 10px 0 0" }}>
            <span className="text-[11px] font-bold" style={{ color: "#131312" }}>
              {T[lang].prevPage} {page - 1}
            </span>
          </div>
        )}

        {/* Next-page edge hint */}
        {edgeHint === "next" && page < pageCount && (
          <div className="absolute inset-x-0 bottom-0 z-20 flex items-center justify-center py-1.5 pointer-events-none"
            style={{ background: "rgba(201,162,64,0.9)", borderRadius: "0 0 10px 10px" }}>
            <span className="text-[11px] font-bold" style={{ color: "#131312" }}>
              {T[lang].nextPage} {page + 1}
            </span>
          </div>
        )}

        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.55)" }}>
            <Spinner size="md" />
          </div>
        )}

        <canvas
          ref={canvasRef}
          style={{ display: "block", width: "100%", height: "auto", cursor: "crosshair" }}
          onMouseDown={onCanvasDown}
        />

        {/* Signature zone overlay — shown only on current page */}
        {zone.page === page && (
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
            <span style={{ fontSize: 10, color: "var(--gold)", fontWeight: 700, textShadow: "0 1px 3px rgba(0,0,0,0.7)" }}>
              {T[lang].signHere}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
