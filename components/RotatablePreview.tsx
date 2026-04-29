"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ButtonHTMLAttributes } from "react";
import { RotateCw, Plus, Minus } from "lucide-react";

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.25;

export function useRotation() {
  const [rot, setRot] = useState(0);
  const [zoom, setZoom] = useState(1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const r = entries[0]?.contentRect;
      if (r) setDims({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rotated = rot % 180 !== 0;
  // CSS rotation only — zoom is handled via the PDF viewer's URL fragment
  // (`#zoom=NN`), so the page contents grow/shrink inside the iframe like
  // they do in Google Drive instead of the whole white canvas getting tiny.
  const innerStyle: CSSProperties = {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: rotated ? `${dims.h}px` : "100%",
    height: rotated ? `${dims.w}px` : "100%",
    transform: `translate(-50%, -50%) rotate(${rot}deg)`,
    transformOrigin: "center center",
  };

  function rotate() { setRot(r => (r + 90) % 360); }
  function zoomIn() { setZoom(z => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2))); }
  function zoomOut() { setZoom(z => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2))); }
  function reset() { setRot(0); setZoom(1); }

  // Wheel remap: when the iframe is rotated 90/180/270, the native PDF
  // viewer's wheel-handler scrolls along the PDF's natural axis, which
  // looks sideways/inverted in the rotated view. We intercept the wheel
  // event on the wrapper and call iframe.contentWindow.scrollBy with the
  // axis swapped so "wheel down" always feels like "scroll down".
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || rot === 0) return;
    const handler = (e: WheelEvent) => {
      const iframe = wrap.querySelector("iframe") as HTMLIFrameElement | null;
      const win = iframe?.contentWindow;
      if (!win) return;
      e.preventDefault();
      let dx = 0, dy = 0;
      if      (rot === 90)  { dx = -e.deltaY; dy = e.deltaX; }
      else if (rot === 180) { dx = -e.deltaX; dy = -e.deltaY; }
      else if (rot === 270) { dx = e.deltaY;  dy = -e.deltaX; }
      try { win.scrollBy({ left: dx, top: dy, behavior: "auto" }); } catch { /* cross-origin */ }
    };
    wrap.addEventListener("wheel", handler, { passive: false });
    return () => wrap.removeEventListener("wheel", handler);
  }, [rot]);

  return { rot, zoom, setRot, setZoom, rotate, zoomIn, zoomOut, reset, wrapRef, innerStyle };
}

export function RotateButton(
  { onClick, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>
) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Rotate 90°"
      aria-label="Rotate 90°"
      className="bv-icon-btn w-8 h-8 rounded-full flex items-center justify-center"
      style={{ color: "var(--w2)" }}
      {...rest}
    >
      <RotateCw size={14} strokeWidth={1.8} />
    </button>
  );
}

export function PdfControlBar({ zoom, onZoomIn, onZoomOut, onRotate }: {
  zoom: number; onZoomIn: () => void; onZoomOut: () => void; onRotate: () => void;
}) {
  const pct = Math.round(zoom * 100);
  return (
    <div className="absolute left-1/2 bottom-3 -translate-x-1/2 z-10 flex items-center gap-1 px-2 py-1.5 rounded-full"
      style={{ background: "rgba(20,20,20,0.85)", border: "1px solid var(--border)", backdropFilter: "blur(8px)", boxShadow: "0 4px 14px rgba(0,0,0,0.35)" }}>
      <button type="button" onClick={onZoomOut} aria-label="Zoom out" title="Zoom out"
        disabled={zoom <= ZOOM_MIN}
        className="bv-icon-btn w-7 h-7 rounded-full flex items-center justify-center disabled:opacity-40"
        style={{ color: "var(--w)" }}>
        <Minus size={13} strokeWidth={2} />
      </button>
      <span className="text-[11px] font-semibold tabular-nums select-none px-1.5"
        style={{ color: "var(--w2)", minWidth: 36, textAlign: "center" }}>
        {pct}%
      </span>
      <button type="button" onClick={onZoomIn} aria-label="Zoom in" title="Zoom in"
        disabled={zoom >= ZOOM_MAX}
        className="bv-icon-btn w-7 h-7 rounded-full flex items-center justify-center disabled:opacity-40"
        style={{ color: "var(--w)" }}>
        <Plus size={13} strokeWidth={2} />
      </button>
      <span className="mx-1 self-stretch" style={{ width: 1, background: "var(--border)" }} />
      <button type="button" onClick={onRotate} aria-label="Rotate 90°" title="Rotate 90°"
        className="bv-icon-btn w-7 h-7 rounded-full flex items-center justify-center"
        style={{ color: "var(--w)" }}>
        <RotateCw size={13} strokeWidth={1.9} />
      </button>
    </div>
  );
}
