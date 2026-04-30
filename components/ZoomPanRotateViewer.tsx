"use client";

/**
 * Generic zoom / pan / rotate wrapper, used to give image and DOCX previews
 * the same gestures as the PDF viewer.
 *
 * Controls (matches PdfViewer feel):
 *   - Mouse wheel + Cmd/Ctrl   → zoom centered on cursor
 *   - Trackpad pinch           → zoom (browsers expose this as wheel + ctrlKey)
 *   - Floating bottom toolbar  → −, %, +, ⟲ (rotate −90°), ⟳ (rotate +90°), ⟳ reset
 *   - Drag to pan when zoomed past 100%
 *   - Touch pinch              → zoom (two-finger gesture on mobile)
 *   - Double-click             → toggle fit/200%
 *
 * Renders the children inside a transformed container so any element tree
 * works (an <img>, a styled HTML page from mammoth, etc.).
 */

import { useEffect, useRef, useState } from "react";
import { ZoomIn, ZoomOut, RotateCw } from "lucide-react";

const MAX_SCALE = 6;
const ZOOM_STEP = 1.25;

/**
 * Reusable zoom / pan / rotate wrapper.
 *
 * Toolbar mirrors the PDF viewer's controls one-for-one: zoom-out, %
 * indicator, zoom-in, divider, rotate. No fit / extend button — same as PDF.
 *
 * `minScale` is configurable so DOCX previews can lock at 100% (zooming
 * out smaller than the page makes no sense for documents). Default 0.25
 * keeps image previews flexible.
 */
export function ZoomPanRotateViewer({
  children,
  minScale = 0.25,
}: {
  children: React.ReactNode;
  minScale?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale]       = useState(1);
  const [rotation, setRotation] = useState(0); // multiples of 90°
  const [pan, setPan]           = useState({ x: 0, y: 0 });
  const draggingRef             = useRef<{ startX: number; startY: number; startPanX: number; startPanY: number } | null>(null);
  const pinchRef                = useRef<{ startDist: number; startScale: number } | null>(null);

  function clamp(s: number) { return Math.min(MAX_SCALE, Math.max(minScale, s)); }

  function reset() {
    setScale(1); setRotation(0); setPan({ x: 0, y: 0 });
  }

  // Zoom anchored at a screen point (cursor or pinch center)
  function zoomAt(nextScale: number, anchorX: number, anchorY: number) {
    const el = containerRef.current;
    if (!el) { setScale(clamp(nextScale)); return; }
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width  / 2;
    const cy = rect.top  + rect.height / 2;
    const dx = anchorX - cx - pan.x;
    const dy = anchorY - cy - pan.y;
    const next = clamp(nextScale);
    const ratio = next / scale;
    setScale(next);
    setPan({
      x: anchorX - cx - dx * ratio,
      y: anchorY - cy - dy * ratio,
    });
  }

  // Wheel: Ctrl/⌘ + wheel = zoom; bare wheel = pan when zoomed in
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
        zoomAt(scale * factor, e.clientX, e.clientY);
      } else if (scale > 1) {
        e.preventDefault();
        setPan(p => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [scale, pan.x, pan.y]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mouse drag to pan (any zoom level, but only meaningful when > 1)
  function onMouseDown(e: React.MouseEvent) {
    if (scale <= 1 && rotation % 180 === 0) return;
    draggingRef.current = {
      startX: e.clientX, startY: e.clientY,
      startPanX: pan.x, startPanY: pan.y,
    };
  }
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = draggingRef.current;
      if (!d) return;
      setPan({ x: d.startPanX + (e.clientX - d.startX), y: d.startPanY + (e.clientY - d.startY) });
    };
    const onUp = () => { draggingRef.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  // Touch pinch (two fingers)
  function onTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchRef.current = { startDist: Math.hypot(dx, dy), startScale: scale };
    }
  }
  function onTouchMove(e: React.TouchEvent) {
    if (e.touches.length === 2 && pinchRef.current) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const next = pinchRef.current.startScale * (dist / pinchRef.current.startDist);
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      zoomAt(next, cx, cy);
    }
  }
  function onTouchEnd() {
    pinchRef.current = null;
  }

  // Double-click: toggle 100% ⇄ 200% (and reset rotation when collapsing back)
  function onDoubleClick(e: React.MouseEvent) {
    e.preventDefault();
    if (scale === 1 && rotation === 0) {
      zoomAt(2, e.clientX, e.clientY);
    } else {
      reset();
    }
  }

  const cursor = scale > 1 || rotation % 180 !== 0
    ? (draggingRef.current ? "grabbing" : "grab")
    : "default";

  return (
    <div ref={containerRef}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      style={{
        position: "absolute", inset: 0, overflow: "hidden",
        background: "#525659", touchAction: "none", cursor,
      }}>
      <div style={{
          position: "absolute", inset: 0, display: "flex",
          alignItems: "center", justifyContent: "center",
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale}) rotate(${rotation}deg)`,
          transformOrigin: "center center",
          transition: draggingRef.current || pinchRef.current ? "none" : "transform 120ms ease-out",
        }}>
        {children}
      </div>

      {/* Floating toolbar — mirrors the PDF viewer 1:1 */}
      <div
        onMouseDown={e => e.stopPropagation()}
        onDoubleClick={e => e.stopPropagation()}
        className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-1.5"
        style={{
          bottom: "1rem",
          background: "var(--card)",
          borderRadius: "9999px",
          border: "1px solid var(--border)",
          boxShadow: "0 4px 20px rgba(0,0,0,0.35)",
          whiteSpace: "nowrap",
        }}>
        <ToolBtn onClick={() => zoomAt(scale / ZOOM_STEP, window.innerWidth / 2, window.innerHeight / 2)} label="Zoom out">
          <ZoomOut size={15} strokeWidth={1.8} />
        </ToolBtn>
        <span style={{ fontSize: 11, fontWeight: 600, minWidth: 38, textAlign: "center", color: "var(--w3)", userSelect: "none" }}>
          {Math.round(scale * 100)}%
        </span>
        <ToolBtn onClick={() => zoomAt(scale * ZOOM_STEP, window.innerWidth / 2, window.innerHeight / 2)} label="Zoom in">
          <ZoomIn size={15} strokeWidth={1.8} />
        </ToolBtn>
        <div style={{ width: 1, height: 18, background: "var(--border)", margin: "0 4px" }} />
        <ToolBtn onClick={() => setRotation(r => r + 90)} label="Rotate">
          <RotateCw size={15} strokeWidth={1.8} />
        </ToolBtn>
      </div>
    </div>
  );
}

function ToolBtn({ onClick, label, children }: { onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="bv-icon-btn w-8 h-8 flex items-center justify-center rounded-full"
      style={{ color: "var(--w2)" }}>
      {children}
    </button>
  );
}
