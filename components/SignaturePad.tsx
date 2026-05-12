"use client";

import { useRef, useEffect, useState } from "react";
import SignaturePadLib from "signature_pad";
import { RotateCcw, Type, Pencil } from "lucide-react";
import { useLang } from "@/components/LangContext";

type Props = {
  width?:        number;
  height?:       number;
  defaultValue?: string | null;
  onCapture:     (dataUri: string | null) => void;
  clearLabel?:   string;
};

export function SignaturePad({
  width = 400, height = 140,
  defaultValue, onCapture,
  clearLabel = "Clear",
}: Props) {
  const { lang } = useLang();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef    = useRef<SignaturePadLib | null>(null);
  const [isEmpty, setIsEmpty] = useState(!defaultValue);
  const [mode, setMode]       = useState<"draw" | "type">("draw");
  const [typedName, setTypedName] = useState("");

  const labels = {
    draw:        lang === "de" ? "Hier unterschreiben" : lang === "fr" ? "Signez ici" : "Draw your signature here",
    typeMode:    lang === "de" ? "Tippen statt zeichnen" : lang === "fr" ? "Taper à la place" : "Type instead",
    drawMode:    lang === "de" ? "Zeichnen" : lang === "fr" ? "Dessiner" : "Draw",
    typedPh:     lang === "de" ? "Vollständigen Namen tippen" : lang === "fr" ? "Tapez votre nom complet" : "Type your full name",
    canvasLabel: lang === "de" ? "Unterschriftsfeld zum Zeichnen" : lang === "fr" ? "Zone de signature à dessiner" : "Signature drawing area",
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Retina scaling
    const dpr  = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || width;
    canvas.width  = cssW   * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.scale(dpr, dpr);

    const pad = new SignaturePadLib(canvas, {
      penColor:        "#0a0a0a",
      backgroundColor: "rgb(255,255,255)",
      minWidth:        0.8,
      maxWidth:        2.8,
      velocityFilterWeight: 0.7,
    });
    padRef.current = pad;

    pad.addEventListener("endStroke", () => {
      if (!pad.isEmpty()) {
        setIsEmpty(false);
        onCapture(pad.toDataURL("image/png"));
      }
    });

    if (defaultValue) {
      pad.fromDataURL(defaultValue, { width: cssW, height });
      setIsEmpty(false);
    }

    return () => { pad.off(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Enable/disable pad when switching modes
  useEffect(() => {
    if (!padRef.current) return;
    mode === "draw" ? padRef.current.on() : padRef.current.off();
  }, [mode]);

  // Re-render typed name into canvas whenever it changes
  useEffect(() => {
    if (mode !== "type") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr  = window.devicePixelRatio || 1;
    const cssW = canvas.width  / dpr;
    const cssH = canvas.height / dpr;
    ctx.clearRect(0, 0, cssW, cssH);
    if (!typedName.trim()) { setIsEmpty(true); onCapture(null); return; }
    ctx.fillStyle = "#0a0a0a";
    const fontSize = Math.min(48, Math.max(24, cssH * 0.5));
    ctx.font = `italic ${fontSize}px "Brush Script MT", "Lucida Handwriting", cursive`;
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(typedName.trim(), cssW / 2, cssH / 2);
    setIsEmpty(false);
    onCapture(canvas.toDataURL("image/png"));
  }, [typedName, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  function clear() {
    padRef.current?.clear();
    setTypedName("");
    setIsEmpty(true);
    onCapture(null);
  }

  function switchMode() {
    clear();
    setMode(m => m === "draw" ? "type" : "draw");
  }

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
      {mode === "type" && (
        <input
          type="text"
          value={typedName}
          onChange={e => setTypedName(e.target.value)}
          placeholder={labels.typedPh}
          className="absolute inset-0 w-full h-full opacity-0 cursor-text"
          style={{ pointerEvents: "auto" }}
          autoFocus
        />
      )}
      {isEmpty && mode === "draw" && (
        <span className="absolute inset-0 flex items-center justify-center text-[13px] pointer-events-none select-none"
          style={{ color: "rgba(0,0,0,0.18)" }}>
          {labels.draw}
        </span>
      )}
      <div className="absolute top-2 right-2 flex items-center gap-1.5">
        {!isEmpty && (
          <button type="button" onClick={clear} aria-label={clearLabel}
            className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full transition-opacity hover:opacity-80"
            style={{ background: "rgba(0,0,0,0.06)", color: "rgba(0,0,0,0.5)" }}>
            <RotateCcw size={10} strokeWidth={2} /> {clearLabel}
          </button>
        )}
        <button type="button" onClick={switchMode}
          className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full transition-opacity hover:opacity-80"
          style={{ background: "rgba(0,0,0,0.06)", color: "rgba(0,0,0,0.5)" }}>
          {mode === "draw"
            ? <><Type size={10} strokeWidth={2} /> {labels.typeMode}</>
            : <><Pencil size={10} strokeWidth={2} /> {labels.drawMode}</>}
        </button>
      </div>
    </div>
  );
}
