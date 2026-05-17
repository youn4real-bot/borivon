"use client";

/**
 * iOS-only PDF viewer.
 *
 * pdf.js renders to a <canvas>, which Apple's WebKit refuses to paint on
 * iPhone/iPad (grey screen) — every iOS browser is WebKit, so this affects
 * Safari AND Chrome AND Firefox on iOS. The only thing that reliably shows a
 * PDF on iOS is the OS-native PDF engine, reached via an <iframe> to the
 * file URL. Pinch-zoom + scroll are then built in by iOS itself.
 *
 * This component re-creates the desktop PdfViewer's toolbar feel on top of
 * that native frame:
 *   - Rotate: INSTANT CSS transform (no network, no reload) — smooth.
 *   - Zoom −/+ : CSS scale on the frame (on top of native pinch).
 *   - Reset.
 * The floating toolbar matches PdfViewer 1:1 visually.
 */

import { useRef, useState, useLayoutEffect } from "react";
import { ZoomIn, ZoomOut, RotateCw } from "lucide-react";

const MIN = 1;
const MAX = 5;
const STEP = 0.25;

export function IosPdfFrame({
  src,
  title,
  onRotate,
}: {
  src: string;
  title?: string;
  /** Fired once per rotate (always +90°). Parent persists the delta
   *  server-side (same API as the desktop viewer) so the orientation
   *  survives close/reopen — instant CSS rotation gives the live feedback. */
  onRotate?: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [rot, setRot] = useState(0);     // 0 | 90 | 180 | 270
  const [scale, setScale] = useState(1);
  // iOS Safari aggressively caches the PDF inside an iframe — on reopen it
  // would reuse the OLD (pre-rotation) copy instead of the freshly-baked
  // one. A per-open cache-bust forces a fresh fetch every time the popup
  // mounts, so a persisted rotation is always reflected on reopen.
  const bustRef = useRef(Date.now());
  const bustedSrc = src + (src.includes("?") ? "&" : "?") + "_v=" + bustRef.current;

  // Measure the available area so a 90°/270° rotation can swap W/H and still
  // fill the popup (instead of overflowing).
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const sideways = rot === 90 || rot === 270;
  // When sideways, the iframe is laid out at swapped dimensions then rotated
  // around its centre so it lands exactly inside the box.
  const fw = sideways ? box.h : box.w;
  const fh = sideways ? box.w : box.h;

  return (
    <div ref={wrapRef} style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#525659" }}>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: fw || "100%",
          height: fh || "100%",
          transform: `translate(-50%, -50%) rotate(${rot}deg) scale(${scale})`,
          transformOrigin: "center center",
          transition: "transform var(--dur-3) var(--ease)",
        }}
      >
        <iframe
          title={title ?? "PDF"}
          src={bustedSrc}
          style={{ width: "100%", height: "100%", border: "none", background: "#525659" }}
        />
      </div>

      {/* Toolbar — visually identical to the desktop PdfViewer toolbar. */}
      <div
        style={{
          position: "absolute",
          bottom: 16,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          gap: 2,
          padding: "6px 8px",
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          boxShadow: "0 4px 20px rgba(0,0,0,0.35)",
          whiteSpace: "nowrap",
        }}
      >
        <Btn onClick={() => setScale(s => Math.max(MIN, Math.round((s - STEP) * 100) / 100))} label="Zoom out">
          <ZoomOut size={15} strokeWidth={1.8} />
        </Btn>
        <span style={{ fontSize: 11, fontWeight: 600, minWidth: 38, textAlign: "center", color: "var(--w3)", userSelect: "none" }}>
          {Math.round(scale * 100)}%
        </span>
        <Btn onClick={() => setScale(s => Math.min(MAX, Math.round((s + STEP) * 100) / 100))} label="Zoom in">
          <ZoomIn size={15} strokeWidth={1.8} />
        </Btn>
        <div style={{ width: 1, height: 18, background: "var(--border)", margin: "0 4px" }} />
        <Btn onClick={() => { setRot(r => (r + 90) % 360); onRotate?.(); }} label="Rotate">
          <RotateCw size={15} strokeWidth={1.8} />
        </Btn>
      </div>
    </div>
  );
}

function Btn({ onClick, label, children }: { onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{
        width: 32, height: 32,
        display: "flex", alignItems: "center", justifyContent: "center",
        border: "none", background: "transparent", borderRadius: 8,
        color: "var(--w2)", cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
