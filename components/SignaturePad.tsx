"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { RotateCcw } from "lucide-react";

type Props = {
  width?:        number;
  height?:       number;
  defaultValue?: string | null; // pre-fill with a saved signature (base64 PNG)
  onCapture:     (dataUri: string | null) => void;
  clearLabel?:   string;
};

export function SignaturePad({
  width = 400, height = 140,
  defaultValue, onCapture,
  clearLabel = "Clear",
}: Props) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const drawing    = useRef(false);
  const lastPos    = useRef<{ x: number; y: number } | null>(null);
  const [isEmpty, setIsEmpty] = useState(!defaultValue);

  // Initialise canvas size + DPR, then paint any saved default
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = width  * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = "#0a0a0a";
    ctx.lineWidth   = 2.2;
    ctx.lineCap     = "round";
    ctx.lineJoin    = "round";

    if (defaultValue) {
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        setIsEmpty(false);
        onCapture(defaultValue);
      };
      img.src = defaultValue;
    }
  }, [width, height]); // eslint-disable-line react-hooks/exhaustive-deps

  function getPos(e: MouseEvent | Touch, canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (width  / rect.width),
      y: (e.clientY - rect.top)  * (height / rect.height),
    };
  }

  const startDraw = useCallback((x: number, y: number) => {
    drawing.current = true;
    lastPos.current = { x, y };
    setIsEmpty(false);
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.beginPath();
    ctx.moveTo(x, y);
  }, []);

  const moveDraw = useCallback((x: number, y: number) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || !lastPos.current) return;
    ctx.quadraticCurveTo(
      lastPos.current.x, lastPos.current.y,
      (x + lastPos.current.x) / 2, (y + lastPos.current.y) / 2,
    );
    ctx.stroke();
    lastPos.current = { x, y };
  }, []);

  const endDraw = useCallback(() => {
    if (!drawing.current) return;
    drawing.current = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    onCapture(canvas.toDataURL("image/png"));
  }, [onCapture]);

  // Mouse events
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const down = (e: MouseEvent) => { e.preventDefault(); const p = getPos(e, canvas); startDraw(p.x, p.y); };
    const move = (e: MouseEvent) => { e.preventDefault(); const p = getPos(e, canvas); moveDraw(p.x, p.y); };
    const up   = () => endDraw();
    canvas.addEventListener("mousedown", down);
    canvas.addEventListener("mousemove", move);
    canvas.addEventListener("mouseup",   up);
    window.addEventListener("mouseup",   up);
    return () => {
      canvas.removeEventListener("mousedown", down);
      canvas.removeEventListener("mousemove", move);
      canvas.removeEventListener("mouseup",   up);
      window.removeEventListener("mouseup",   up);
    };
  }, [startDraw, moveDraw, endDraw]); // eslint-disable-line react-hooks/exhaustive-deps

  // Touch events
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const tdown = (e: TouchEvent) => { e.preventDefault(); const p = getPos(e.touches[0], canvas); startDraw(p.x, p.y); };
    const tmove = (e: TouchEvent) => { e.preventDefault(); const p = getPos(e.touches[0], canvas); moveDraw(p.x, p.y); };
    const tup   = () => endDraw();
    canvas.addEventListener("touchstart", tdown, { passive: false });
    canvas.addEventListener("touchmove",  tmove, { passive: false });
    canvas.addEventListener("touchend",   tup);
    return () => {
      canvas.removeEventListener("touchstart", tdown);
      canvas.removeEventListener("touchmove",  tmove);
      canvas.removeEventListener("touchend",   tup);
    };
  }, [startDraw, moveDraw, endDraw]); // eslint-disable-line react-hooks/exhaustive-deps

  function clear() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    setIsEmpty(true);
    onCapture(null);
  }

  return (
    <div className="relative w-full">
      <canvas
        ref={canvasRef}
        style={{
          width: "100%", height,
          display: "block",
          borderRadius: "12px",
          border: "1.5px solid var(--border)",
          background: "#fff",
          cursor: "crosshair",
          touchAction: "none",
        }}
      />
      {isEmpty && (
        <span className="absolute inset-0 flex items-center justify-center text-[13px] pointer-events-none select-none"
          style={{ color: "rgba(0,0,0,0.18)" }}>
          Draw your signature here
        </span>
      )}
      {!isEmpty && (
        <button type="button" onClick={clear}
          className="absolute top-2 right-2 inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full transition-opacity hover:opacity-80"
          style={{ background: "rgba(0,0,0,0.06)", color: "rgba(0,0,0,0.5)" }}>
          <RotateCcw size={10} strokeWidth={2} />
          {clearLabel}
        </button>
      )}
    </div>
  );
}
