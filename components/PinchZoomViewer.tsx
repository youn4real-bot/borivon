"use client";
import { useEffect, useRef } from "react";

/**
 * Renders a PDF (or any URL) inside an iframe with custom pinch-to-zoom
 * and single-touch pan — works on iOS Safari and Android Chrome.
 *
 * Strategy:
 *  - iframe is 300% the container height so multi-page PDFs are reachable
 *  - pointer-events: none on iframe → all touches fire on our wrapper div
 *  - We calculate pinch distance delta → CSS scale transform on the iframe
 *  - Single touch → pan Y (scroll through pages) and pan X when zoomed
 *  - No external dependencies
 */
export default function PinchZoomViewer({ src }: { src: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef    = useRef<HTMLIFrameElement>(null);

  // All gesture state lives in a ref — zero re-renders during touch
  const s = useRef({
    scale: 1, tx: 0, ty: 0,
    startScale: 1, startTx: 0, startTy: 0,
    p0dist: 0, p0mx: 0, p0my: 0,
    lx: 0, ly: 0,
    pinching: false,
  });

  useEffect(() => {
    const el  = containerRef.current;
    const ifr = iframeRef.current;
    if (!el || !ifr) return;

    const apply = () => {
      ifr.style.transform = `translate(${s.current.tx}px, ${s.current.ty}px) scale(${s.current.scale})`;
    };

    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

    const clampState = () => {
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      const iH = ifr.clientHeight; // 300% of container height
      // X: only pan when zoomed
      const maxX = (cw * (s.current.scale - 1)) / 2;
      s.current.tx = clamp(s.current.tx, -maxX, maxX);
      // Y: scroll from top (0) to bottom of tall iframe
      const maxDown = -(iH - ch);
      s.current.ty = clamp(s.current.ty, maxDown, 0);
    };

    const dist = (t: TouchList) => {
      const dx = t[0].clientX - t[1].clientX;
      const dy = t[0].clientY - t[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const onStart = (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches.length === 2) {
        s.current.pinching   = true;
        s.current.p0dist     = dist(e.touches);
        s.current.startScale = s.current.scale;
        s.current.startTx    = s.current.tx;
        s.current.startTy    = s.current.ty;
        s.current.p0mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        s.current.p0my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      } else if (e.touches.length === 1) {
        s.current.pinching = false;
        s.current.lx = e.touches[0].clientX;
        s.current.ly = e.touches[0].clientY;
      }
    };

    const onMove = (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches.length === 2) {
        const d  = dist(e.touches);
        s.current.scale = clamp(s.current.startScale * (d / s.current.p0dist), 1, 5);
        const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        s.current.tx = s.current.startTx + (mx - s.current.p0mx);
        s.current.ty = s.current.startTy + (my - s.current.p0my);
        clampState();
        apply();
      } else if (e.touches.length === 1 && !s.current.pinching) {
        s.current.tx += e.touches[0].clientX - s.current.lx;
        s.current.ty += e.touches[0].clientY - s.current.ly;
        s.current.lx  = e.touches[0].clientX;
        s.current.ly  = e.touches[0].clientY;
        clampState();
        apply();
      }
    };

    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) s.current.pinching = false;
      if (e.touches.length === 1) {
        // Transition from pinch back to single touch
        s.current.lx = e.touches[0].clientX;
        s.current.ly = e.touches[0].clientY;
        s.current.startScale = s.current.scale;
        s.current.startTx    = s.current.tx;
        s.current.startTy    = s.current.ty;
      }
      // Snap back to scale 1 if barely zoomed
      if (e.touches.length === 0 && s.current.scale < 1.08) {
        s.current.scale = 1;
        s.current.tx    = 0;
        clampState();
        apply();
      }
    };

    el.addEventListener("touchstart", onStart, { passive: false });
    el.addEventListener("touchmove",  onMove,  { passive: false });
    el.addEventListener("touchend",   onEnd,   { passive: true });

    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove",  onMove);
      el.removeEventListener("touchend",   onEnd);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        minHeight: "60vh",
        overflow: "hidden",
        touchAction: "none",
        userSelect: "none",
      }}
    >
      <iframe
        ref={iframeRef}
        src={src}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "300%",   // tall enough for multi-page PDFs
          border: "none",
          display: "block",
          transformOrigin: "top center",
          pointerEvents: "none", // our wrapper catches all touches
          willChange: "transform",
        }}
      />
    </div>
  );
}
