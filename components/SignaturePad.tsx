"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { RotateCcw, Type, Pencil } from "lucide-react";
import { useLang } from "@/components/LangContext";

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
  const { lang } = useLang();
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const drawing    = useRef(false);
  const lastPos    = useRef<{ x: number; y: number } | null>(null);
  const canvasW    = useRef<number>(width); // actual rendered CSS pixel width
  const [isEmpty, setIsEmpty] = useState(!defaultValue);
  // Keyboard / typed-name fallback — for users who can't draw with a pointer
  // (assistive tech, no touchscreen + no mouse, etc.). Renders the typed name
  // into the canvas as a cursive-styled signature on submit.
  const [mode, setMode]       = useState<"draw" | "type">("draw");
  const [typedName, setTypedName] = useState("");

  const labels = {
    draw:        lang === "de" ? "Hier unterschreiben" : lang === "fr" ? "Signez ici" : "Draw your signature here",
    typeMode:    lang === "de" ? "Tippen statt zeichnen" : lang === "fr" ? "Taper à la place" : "Type instead",
    drawMode:    lang === "de" ? "Zeichnen" : lang === "fr" ? "Dessiner" : "Draw",
    typedPh:     lang === "de" ? "Vollständigen Namen tippen" : lang === "fr" ? "Tapez votre nom complet" : "Type your full name",
    canvasLabel: lang === "de" ? "Unterschriftsfeld zum Zeichnen" : lang === "fr" ? "Zone de signature à dessiner" : "Signature drawing area",
  };

  // Initialise canvas size + DPR, then paint any saved default
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    // Use actual rendered CSS width so internal pixels match display pixels (no horizontal stretch)
    const cssW = canvas.clientWidth || width;
    canvasW.current = cssW;
    canvas.width  = cssW    * dpr;
    canvas.height = height  * dpr;
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
        const w = canvasW.current;
        ctx.clearRect(0, 0, w, height);
        const scale = Math.min(w / img.naturalWidth, height / img.naturalHeight);
        const dw = img.naturalWidth * scale;
        const dh = img.naturalHeight * scale;
        ctx.drawImage(img, (w - dw) / 2, (height - dh) / 2, dw, dh);
        setIsEmpty(false);
        onCapture(defaultValue);
      };
      img.src = defaultValue;
    }
  }, [width, height]); // eslint-disable-line react-hooks/exhaustive-deps

  function getPos(e: MouseEvent | Touch, canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvasW.current / rect.width),
      y: (e.clientY - rect.top)  * (height           / rect.height),
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
    ctx.clearRect(0, 0, canvasW.current, height);
    setIsEmpty(true);
    onCapture(null);
  }

  // Render the typed name as a cursive PNG into the canvas + emit it.
  function renderTypedName(name: string) {
    const canvas = canvasRef.current;
    if (!canvas || !name.trim()) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvasW.current;
    ctx.clearRect(0, 0, w, height);
    ctx.fillStyle = "#0a0a0a";
    // Use a cursive system font; fall back gracefully if unavailable.
    const fontSize = Math.min(48, Math.max(24, height * 0.5));
    ctx.font = `italic ${fontSize}px "Brush Script MT", "Lucida Handwriting", cursive`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(name.trim(), w / 2, height / 2);
    setIsEmpty(false);
    onCapture(canvas.toDataURL("image/png"));
  }

  // Whenever the typed name changes in type-mode, re-render the canvas
  // synchronously so what the user sees matches what's submitted.
  useEffect(() => {
    if (mode !== "type") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (!typedName.trim()) {
      ctx.clearRect(0, 0, width, height);
      setIsEmpty(true);
      onCapture(null);
      return;
    }
    renderTypedName(typedName);
  }, [typedName, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative w-full">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={labels.canvasLabel}
        style={{
          width: "100%", height,
          display: "block",
          borderRadius: "12px",
          border: "1.5px solid var(--border)",
          background: "#fff",
          cursor: mode === "draw" ? "crosshair" : "default",
          touchAction: "none",
          pointerEvents: mode === "draw" ? "auto" : "none",
        }}
      />
      {isEmpty && mode === "draw" && (
        <span className="absolute inset-0 flex items-center justify-center text-[13px] pointer-events-none select-none"
          style={{ color: "rgba(0,0,0,0.18)" }}>
          {labels.draw}
        </span>
      )}
      {!isEmpty && (
        <button type="button" onClick={clear}
          aria-label={clearLabel}
          className="absolute top-2 right-2 inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full transition-opacity hover:opacity-80"
          style={{ background: "rgba(0,0,0,0.06)", color: "rgba(0,0,0,0.5)" }}>
          <RotateCcw size={10} strokeWidth={2} aria-hidden="true" />
          {clearLabel}
        </button>
      )}
    </div>
  );
}
