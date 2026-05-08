"use client";

import { useRef, useState, useEffect } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";
import { Spinner } from "@/components/ui/states";

export type SigZone = {
  page: number; // 1-indexed
  x: number;    // normalized 0-1 from left of page
  y: number;    // normalized 0-1 from top of page
  w: number;    // normalized 0-1
  h: number;    // normalized 0-1
};

// Matches PdfViewer layout constants exactly
const PADDING_TOP = 16;
const PAGE_GAP    = 12;
const MIN_SCALE   = 0.4;
const MAX_SCALE   = 4.0;
const SCALE_STEP  = 0.2;

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
  en: { signHere: "✍ Sign here" },
  fr: { signHere: "✍ Signer ici" },
  de: { signHere: "✍ Hier unterschreiben" },
} as const;

type AbsRect = { top: number; left: number; w: number; h: number };

type Props = {
  pdfBase64: string;
  onChange: (z: SigZone) => void;
  onError?: () => void;
  lang?: keyof typeof T;
};

export function PdfZonePicker({ pdfBase64, onChange, onError, lang = "en" }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pagesWrapRef = useRef<HTMLDivElement>(null);

  const [pdfDoc,     setPdfDoc]     = useState<import("pdfjs-dist").PDFDocumentProxy | null>(null);
  const [pageSizes,  setPageSizes]  = useState<{ w: number; h: number }[]>([]);
  const [scale,      setScale]      = useState(1.0);
  const [loading,    setLoading]    = useState(true);
  const [zone,       setZone]       = useState<SigZone>(defaultZone(1));

  // Refs so global handlers never read stale values
  const scaleRef      = useRef(scale);
  const zoneRef       = useRef(zone);
  const pageSizesRef  = useRef(pageSizes);
  const onChangeRef   = useRef(onChange);
  const containerWRef = useRef(0);

  // Drag / resize / draw state — pure refs (no re-render during drag)
  const dragRef = useRef<{
    mode: "move" | "resize";
    handle?: string;
    startMouse: { x: number; y: number };
    startAbs: AbsRect;
  } | null>(null);
  const drawStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => { scaleRef.current = scale; }, [scale]);
  useEffect(() => { zoneRef.current  = zone;  }, [zone]);
  useEffect(() => { pageSizesRef.current = pageSizes; }, [pageSizes]);
  useEffect(() => { onChangeRef.current  = onChange;  });

  // Track container clientWidth for page centering
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    containerWRef.current = el.clientWidth;
    const ro = new ResizeObserver(() => { containerWRef.current = el.clientWidth; });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Coordinate helpers (use only refs → safe inside effect closures) ────────

  function dispSizesOf(ps: { w: number; h: number }[], sc: number) {
    return ps.map(s => ({ w: Math.round(s.w * sc), h: Math.round(s.h * sc) }));
  }

  // Top of page[i] in pagesWrap scroll-content space
  function pageTopOf(i: number, ds: { w: number; h: number }[]) {
    let y = PADDING_TOP;
    for (let j = 0; j < i; j++) y += ds[j].h + PAGE_GAP;
    return y;
  }

  // Left offset of (uniformly-sized) pages — centered in container
  function pageLeftOf(ds: { w: number; h: number }[]) {
    if (!ds.length) return 12;
    const cw = containerWRef.current || (containerRef.current?.clientWidth ?? 400);
    return Math.max(12, (cw - ds[0].w) / 2);
  }

  // Client coords → pagesWrap scroll-content space
  function contentPos(clientX: number, clientY: number): { x: number; y: number } {
    const el = containerRef.current!;
    const r  = el.getBoundingClientRect();
    return { x: clientX - r.left + el.scrollLeft, y: clientY - r.top + el.scrollTop };
  }

  // SigZone → absolute pixel rect in pagesWrap
  function zoneToAbs(z: SigZone, ds: { w: number; h: number }[]): AbsRect | null {
    const pi = z.page - 1;
    if (pi < 0 || pi >= ds.length) return null;
    const pt = pageTopOf(pi, ds);
    const pl = pageLeftOf(ds);
    return {
      top:  pt + z.y * ds[pi].h,
      left: pl + z.x * ds[pi].w,
      w:    z.w * ds[pi].w,
      h:    z.h * ds[pi].h,
    };
  }

  // Absolute rect → SigZone (page chosen by zone center Y)
  function absToZone(abs: AbsRect, ds: { w: number; h: number }[]): SigZone {
    if (!ds.length) return zoneRef.current;
    const cy = abs.top + abs.h / 2;
    const pl = pageLeftOf(ds);
    const pw = ds[0].w;

    let pi = ds.length - 1, cumY = PADDING_TOP;
    for (let i = 0; i < ds.length; i++) {
      if (cy <= cumY + ds[i].h || i === ds.length - 1) { pi = i; break; }
      cumY += ds[i].h + PAGE_GAP;
    }
    const pt = pageTopOf(pi, ds);
    const ph = ds[pi].h;
    const MIN_W = 0.05, MIN_H = 0.03;

    const x = Math.max(0, Math.min(1 - MIN_W, (abs.left - pl) / pw));
    const y = Math.max(0, Math.min(1 - MIN_H, (abs.top  - pt) / ph));
    const w = Math.max(MIN_W, Math.min(1 - x, abs.w / pw));
    const h = Math.max(MIN_H, Math.min(1 - y, abs.h / ph));
    return { page: pi + 1, x, y, w, h };
  }

  function emitZone(z: SigZone) {
    zoneRef.current = z;
    setZone(z);
    onChangeRef.current(z);
  }

  // ── Load PDF ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!pdfBase64) return;
    let active = true;
    (async () => {
      try {
        const lib   = await getPdfJs();
        const bytes = Uint8Array.from(atob(pdfBase64), c => c.charCodeAt(0));
        const doc   = await lib.getDocument({ data: bytes }).promise;
        if (!active) return;
        const sizes: { w: number; h: number }[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const pg = await doc.getPage(i);
          const vp = pg.getViewport({ scale: 1.0 });
          sizes.push({ w: vp.width, h: vp.height });
        }
        if (!active) return;
        setPdfDoc(doc);
        setPageSizes(sizes);
        pageSizesRef.current = sizes;
        setLoading(false);
        const z = defaultZone(doc.numPages);
        setZone(z); zoneRef.current = z;
        onChange(z);
      } catch (e) {
        console.error("[PdfZonePicker] load error", e);
        if (active) { setLoading(false); onError?.(); }
      }
    })();
    return () => { active = false; };
  }, [pdfBase64]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Global mouse handlers (drag/resize/draw, prevents outer scroll) ─────────
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragRef.current && !drawStartRef.current) return;
      e.preventDefault();

      const pos = contentPos(e.clientX, e.clientY);
      const ds  = dispSizesOf(pageSizesRef.current, scaleRef.current);

      if (dragRef.current?.mode === "move") {
        const { startMouse, startAbs } = dragRef.current;
        emitZone(absToZone({
          top:  startAbs.top  + (pos.y - startMouse.y),
          left: startAbs.left + (pos.x - startMouse.x),
          w: startAbs.w, h: startAbs.h,
        }, ds));

      } else if (dragRef.current?.mode === "resize") {
        const { handle, startMouse, startAbs } = dragRef.current;
        const dx = pos.x - startMouse.x;
        const dy = pos.y - startMouse.y;
        const MIN_PX = 24;
        let { top, left, w, h } = startAbs;

        if (handle!.includes("n")) { top += dy; h -= dy; }
        if (handle!.includes("s")) { h  += dy; }
        if (handle!.includes("w")) { left += dx; w -= dx; }
        if (handle!.includes("e")) { w  += dx; }

        if (h < MIN_PX) { if (handle!.includes("n")) top = startAbs.top + startAbs.h - MIN_PX; h = MIN_PX; }
        if (w < MIN_PX) { if (handle!.includes("w")) left = startAbs.left + startAbs.w - MIN_PX; w = MIN_PX; }

        emitZone(absToZone({ top, left, w, h }, ds));

      } else if (drawStartRef.current) {
        const s = drawStartRef.current;
        const abs: AbsRect = {
          top:  Math.min(s.y, pos.y),
          left: Math.min(s.x, pos.x),
          w:    Math.abs(pos.x - s.x),
          h:    Math.abs(pos.y - s.y),
        };
        if (abs.w > 10 && abs.h > 10) emitZone(absToZone(abs, ds));
      }
    }

    function onUp() {
      dragRef.current    = null;
      drawStartRef.current = null;
    }

    window.addEventListener("mousemove", onMove, { passive: false });
    window.addEventListener("mouseup",   onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render ──────────────────────────────────────────────────────────────────
  const dispSizes = dispSizesOf(pageSizes, scale);
  const zoneAbs   = dispSizes.length > 0 ? zoneToAbs(zone, dispSizes) : null;

  const HANDLES = [
    { id: "nw", top: "0%",   left: "0%",   cursor: "nw-resize" },
    { id: "n",  top: "0%",   left: "50%",  cursor: "n-resize"  },
    { id: "ne", top: "0%",   left: "100%", cursor: "ne-resize" },
    { id: "e",  top: "50%",  left: "100%", cursor: "e-resize"  },
    { id: "se", top: "100%", left: "100%", cursor: "se-resize" },
    { id: "s",  top: "100%", left: "50%",  cursor: "s-resize"  },
    { id: "sw", top: "100%", left: "0%",   cursor: "sw-resize" },
    { id: "w",  top: "50%",  left: "0%",   cursor: "w-resize"  },
  ];

  return (
    // Outer shell matches PdfSignModal's zone viewer wrapper exactly
    <div style={{
      position: "relative", display: "flex", flexDirection: "column",
      background: "#525659", borderRadius: 12, overflow: "hidden",
      border: "1px solid var(--border)", height: "62dvh",
    }}>
      {/* Scrollable pages */}
      <div
        ref={containerRef}
        style={{ flex: 1, overflow: "auto", overscrollBehavior: "contain", cursor: "crosshair" }}
        onWheel={e => e.stopPropagation()}
        onMouseDown={e => {
          if (e.button !== 0) return;
          // Only start a draw when clicking on the background / page canvas
          // Zone box and handles use stopPropagation so they won't reach here
          e.preventDefault();
          drawStartRef.current = contentPos(e.clientX, e.clientY);
        }}
      >
        {loading && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
            <Spinner size="md" />
          </div>
        )}

        {!loading && pdfDoc && pageSizes.length > 0 && (
          <div
            ref={pagesWrapRef}
            style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              padding: `${PADDING_TOP}px 12px 96px`,
              gap: PAGE_GAP,
              position: "relative", // so absolute zone box is relative to this
              minHeight: "100%",
            }}
          >
            {/* All pages rendered simultaneously */}
            {pageSizes.map((_, i) => (
              <ZPickerPage
                key={i}
                pdf={pdfDoc}
                pageNum={i + 1}
                dispW={dispSizes[i]?.w ?? 0}
                dispH={dispSizes[i]?.h ?? 0}
                scale={scale}
              />
            ))}

            {/* Draggable + resizable zone overlay — single div spanning pagesWrap */}
            {zoneAbs && (
              <div
                style={{
                  position: "absolute",
                  top:    zoneAbs.top,
                  left:   zoneAbs.left,
                  width:  zoneAbs.w,
                  height: zoneAbs.h,
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
                  dragRef.current = {
                    mode: "move",
                    startMouse: contentPos(e.clientX, e.clientY),
                    startAbs:   { ...zoneAbs },
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

                {/* 8 resize handles */}
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
                      dragRef.current = {
                        mode: "resize",
                        handle: h.id,
                        startMouse: contentPos(e.clientX, e.clientY),
                        startAbs:   { ...zoneAbs },
                      };
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Zoom toolbar — identical to PdfViewer */}
      {!loading && pdfDoc && (
        <div style={{
          position: "absolute", bottom: 16, left: "50%",
          transform: "translateX(-50%)", zIndex: 10,
          display: "flex", alignItems: "center", gap: 2,
          padding: "6px 8px",
          background: "var(--card)", border: "1px solid var(--border)",
          borderRadius: 12, boxShadow: "0 4px 20px rgba(0,0,0,0.35)",
          whiteSpace: "nowrap",
        }}>
          <ZBtn onClick={() => setScale(s => Math.max(MIN_SCALE, +(s - SCALE_STEP).toFixed(1)))}>
            <ZoomOut size={15} strokeWidth={1.8} />
          </ZBtn>
          <span style={{ fontSize: 11, fontWeight: 600, minWidth: 38, textAlign: "center", color: "var(--w3)", userSelect: "none" }}>
            {Math.round(scale * 100)}%
          </span>
          <ZBtn onClick={() => setScale(s => Math.min(MAX_SCALE, +(s + SCALE_STEP).toFixed(1)))}>
            <ZoomIn size={15} strokeWidth={1.8} />
          </ZBtn>
        </div>
      )}
    </div>
  );
}

// ── Page renderer ─────────────────────────────────────────────────────────────

function ZPickerPage({ pdf, pageNum, dispW, dispH, scale }: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdf: any;
  pageNum: number;
  dispW: number;
  dispH: number;
  scale: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!dispW || !dispH) return;
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pdf.getPage(pageNum).then((page: any) => {
      if (cancelled) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vp  = page.getViewport({ scale: scale * dpr });
      const cw  = Math.round(dispW * dpr);
      const ch  = Math.round(dispH * dpr);
      canvas.width  = cw;
      canvas.height = ch;
      const ctx = canvas.getContext("2d");
      if (!ctx || cancelled) return;
      page.render({ canvasContext: ctx, viewport: vp }).promise.catch(() => {});
    });

    return () => { cancelled = true; };
  }, [pdf, pageNum, dispW, dispH, scale]);

  return (
    <div style={{ position: "relative", flexShrink: 0, width: dispW, height: dispH }}>
      <canvas
        ref={canvasRef}
        style={{
          display: "block", width: dispW, height: dispH,
          boxShadow: "0 2px 8px rgba(0,0,0,0.4)", borderRadius: 2,
        }}
      />
    </div>
  );
}

// ── Zoom button ───────────────────────────────────────────────────────────────

function ZBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 32, height: 32,
        display: "flex", alignItems: "center", justifyContent: "center",
        border: "none", background: "transparent", borderRadius: 8,
        color: "var(--w2)", cursor: "pointer", transition: "background 0.15s",
      }}
      onMouseEnter={e => (e.currentTarget.style.background = "var(--bg2)")}
      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
    >
      {children}
    </button>
  );
}
