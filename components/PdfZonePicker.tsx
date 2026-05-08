"use client";

import { useEffect, useRef, useState } from "react";
import { FilePen } from "@/components/PortalIcons";
import { PdfViewer } from "@/components/PdfViewer";

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

type Props = {
  pdfBase64: string;         // raw base64, no "data:" prefix
  onChange: (z: SigZone) => void;
  onError?: () => void;
};

export function PdfZonePicker({ pdfBase64, onChange, onError }: Props) {
  const [pdfUrl, setPdfUrl] = useState<string>("");
  const [zone, setZone]     = useState<SigZone>(defaultZone(1));
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // base64 → blob URL (PdfViewer expects a URL src). Revoke on unmount/swap.
  useEffect(() => {
    if (!pdfBase64) return;
    try {
      const bytes = Uint8Array.from(atob(pdfBase64), c => c.charCodeAt(0));
      const blob  = new Blob([bytes], { type: "application/pdf" });
      const url   = URL.createObjectURL(blob);
      setPdfUrl(url);
      return () => URL.revokeObjectURL(url);
    } catch (e) {
      console.error("[PdfZonePicker] base64 decode error", e);
      onError?.();
    }
  }, [pdfBase64, onError]);

  // Push initial zone to parent
  useEffect(() => {
    onChangeRef.current(zone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function emit(z: SigZone) {
    setZone(z);
    onChangeRef.current(z);
  }

  return (
    <div>
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-[11px]" style={{ color: "var(--w3)" }}>
          Drag to draw · Move the gold box · Resize via handles
        </span>
      </div>

      <div style={{
        height: "62dvh",
        borderTop: "1px solid var(--border)",
        borderBottom: "1px solid var(--border)",
      }}>
        {pdfUrl && (
          <PdfViewer
            src={pdfUrl}
            hideRotate
            pageOverlay={({ pageNum }) => (
              <ZoneLayer
                pageNum={pageNum}
                zone={zone.page === pageNum ? zone : null}
                onZone={emit}
              />
            )}
          />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ZoneLayer — full-page transparent overlay; renders gold zone box if
// this page owns the active zone. Handles draw/drag/resize via window
// listeners so the gesture survives mouse moves outside the page.
// ─────────────────────────────────────────────────────────────────────────────

type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

type Gesture =
  | { type: "draw"; sx: number; sy: number }
  | { type: "drag"; sx: number; sy: number; ox: number; oy: number }
  | { type: "resize"; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number; handle: ResizeHandle };

function ZoneLayer({
  pageNum, zone, onZone,
}: {
  pageNum: number;
  zone: SigZone | null;
  onZone: (z: SigZone) => void;
}) {
  const layerRef   = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const zoneRef    = useRef<SigZone | null>(zone);
  zoneRef.current  = zone;

  function relPos(clientX: number, clientY: number) {
    const r = layerRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (clientY - r.top)  / r.height)),
    };
  }

  function inZone(px: number, py: number, z: SigZone) {
    return px >= z.x && px <= z.x + z.w && py >= z.y && py <= z.y + z.h;
  }

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const g = gestureRef.current;
      if (!g) return;
      e.preventDefault();
      const p = relPos(e.clientX, e.clientY);

      if (g.type === "drag") {
        const z = zoneRef.current!;
        onZone({
          ...z,
          page: pageNum,
          x: Math.max(0, Math.min(1 - z.w, g.ox + p.x - g.sx)),
          y: Math.max(0, Math.min(1 - z.h, g.oy + p.y - g.sy)),
        });
      } else if (g.type === "draw") {
        const x = Math.min(g.sx, p.x);
        const y = Math.min(g.sy, p.y);
        const w = Math.abs(p.x - g.sx);
        const h = Math.abs(p.y - g.sy);
        if (w > 0.03 && h > 0.02) onZone({ page: pageNum, x, y, w, h });
      } else if (g.type === "resize") {
        const dx = p.x - g.sx;
        const dy = p.y - g.sy;
        const MIN = 0.04;
        let nx = g.ox, ny = g.oy, nw = g.ow, nh = g.oh;
        if (g.handle.includes("w")) { nx = Math.min(g.ox + g.ow - MIN, g.ox + dx); nw = g.ow - (nx - g.ox); }
        if (g.handle.includes("e")) { nw = Math.max(MIN, g.ow + dx); }
        if (g.handle.includes("n")) { ny = Math.min(g.oy + g.oh - MIN, g.oy + dy); nh = g.oh - (ny - g.oy); }
        if (g.handle.includes("s")) { nh = Math.max(MIN, g.oh + dy); }
        if (nx < 0) { nw += nx; nx = 0; }
        if (ny < 0) { nh += ny; ny = 0; }
        if (nx + nw > 1) nw = 1 - nx;
        if (ny + nh > 1) nh = 1 - ny;
        onZone({ page: pageNum, x: nx, y: ny, w: nw, h: nh });
      }
    }
    function onUp() { gestureRef.current = null; }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageNum]);

  function onLayerDown(e: React.MouseEvent) {
    e.preventDefault();
    const p = relPos(e.clientX, e.clientY);
    const z = zoneRef.current;
    if (z && inZone(p.x, p.y, z)) {
      gestureRef.current = { type: "drag", sx: p.x, sy: p.y, ox: z.x, oy: z.y };
    } else {
      gestureRef.current = { type: "draw", sx: p.x, sy: p.y };
    }
  }

  function startResize(e: React.MouseEvent, handle: ResizeHandle) {
    e.preventDefault();
    e.stopPropagation();
    const z = zoneRef.current;
    if (!z) return;
    const p = relPos(e.clientX, e.clientY);
    gestureRef.current = { type: "resize", sx: p.x, sy: p.y, ox: z.x, oy: z.y, ow: z.w, oh: z.h, handle };
  }

  return (
    <div
      ref={layerRef}
      onMouseDown={onLayerDown}
      style={{
        position: "absolute", inset: 0,
        cursor: zone ? "crosshair" : "crosshair",
        userSelect: "none",
      }}
    >
      {zone && (
        <div
          onMouseDown={e => {
            e.preventDefault();
            e.stopPropagation();
            const p = relPos(e.clientX, e.clientY);
            gestureRef.current = { type: "drag", sx: p.x, sy: p.y, ox: zone.x, oy: zone.y };
          }}
          style={{
            position: "absolute",
            left:       `${zone.x * 100}%`,
            top:        `${zone.y * 100}%`,
            width:      `${zone.w * 100}%`,
            height:     `${zone.h * 100}%`,
            border:     "2px solid var(--gold)",
            background: "var(--gdim)",
            borderRadius: 6,
            boxShadow:  "0 4px 14px rgba(201,162,64,0.18)",
            display:    "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor:     "move",
          }}
        >
          <span className="inline-flex items-center gap-1.5 tracking-tight pointer-events-none"
            style={{
              fontSize: 11, color: "var(--gold)", fontWeight: 700,
              textShadow: "0 1px 3px rgba(0,0,0,0.55)",
              letterSpacing: "0.01em",
            }}>
            <FilePen size={12} strokeWidth={2} style={{ color: "var(--gold)" }} />
            Sign here
          </span>

          {(["nw","n","ne","e","se","s","sw","w"] as const).map(h => {
            const pos: React.CSSProperties = { position: "absolute", pointerEvents: "auto" };
            const sz = 10;
            const half = sz / 2;
            if (h.includes("n")) pos.top    = -half;
            if (h.includes("s")) pos.bottom = -half;
            if (h.includes("w")) pos.left   = -half;
            if (h.includes("e")) pos.right  = -half;
            if (h === "n" || h === "s") pos.left = `calc(50% - ${half}px)`;
            if (h === "e" || h === "w") pos.top  = `calc(50% - ${half}px)`;
            const cursorMap: Record<typeof h, string> = {
              nw: "nwse-resize", se: "nwse-resize",
              ne: "nesw-resize", sw: "nesw-resize",
              n: "ns-resize",   s: "ns-resize",
              e: "ew-resize",   w: "ew-resize",
            };
            return (
              <div key={h}
                onMouseDown={e => startResize(e, h)}
                style={{
                  ...pos,
                  width: sz, height: sz,
                  background: "var(--gold)",
                  border: "1.5px solid #fff",
                  borderRadius: 3,
                  boxShadow: "0 1px 3px rgba(0,0,0,0.35)",
                  cursor: cursorMap[h],
                }} />
            );
          })}
        </div>
      )}

    </div>
  );
}
