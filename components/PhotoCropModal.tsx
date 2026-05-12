"use client";

/**
 * Circular photo crop / zoom modal.
 *
 * Built on react-easy-crop (LAW #28 — battle-tested OSS for pan/pinch/zoom).
 * Output is a square 600×600 JPEG; the circular look comes from CSS
 * `border-radius: 50%` wherever the photo is displayed.
 */

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Cropper, { type Area } from "react-easy-crop";
import { X as XIcon, ZoomIn, ZoomOut, Check } from "lucide-react";
import { useLang } from "@/components/LangContext";

const OUTPUT_SIZE = 600;
const ZOOM_STEP = 0.2;
const MIN_ZOOM = 1;
const MAX_ZOOM = 6;

async function cropToDataUrl(src: string, area: Area): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = src;
  });
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D unavailable");
  ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
  return canvas.toDataURL("image/jpeg", 0.92);
}

export function PhotoCropModal({
  src, onSave, onCancel,
}: {
  src: string;
  onSave: (dataUrl: string) => void;
  onCancel: () => void;
}) {
  const { lang, t: gT } = useLang();
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [areaPixels, setAreaPixels] = useState<Area | null>(null);
  const [saving, setSaving] = useState(false);

  const onCropComplete = useCallback((_: Area, pixels: Area) => {
    setAreaPixels(pixels);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onCancel]);

  async function save() {
    if (!areaPixels || saving) return;
    setSaving(true);
    try {
      const dataUrl = await cropToDataUrl(src, areaPixels);
      onSave(dataUrl);
    } finally {
      setSaving(false);
    }
  }

  if (typeof document === "undefined") return null;

  const labels = lang === "de"
    ? { title: "Foto zuschneiden", sub: "Verschieben und zoomen, um den Bildausschnitt zu wählen.", save: "Speichern", cancel: "Abbrechen" }
    : lang === "fr"
    ? { title: "Recadrer la photo", sub: "Glissez et zoomez pour ajuster le cadrage.", save: "Enregistrer", cancel: "Annuler" }
    : { title: "Crop your photo", sub: "Drag to position, pinch or scroll to zoom.", save: "Save", cancel: "Cancel" };

  return createPortal(
    <div className="fixed inset-x-0 bottom-0 top-[58px] z-[1150] flex items-center justify-center p-4 bv-photo-crop-outer"
      style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(8px)", animation: "bvFadeRise 0.22s var(--ease-out)" }}>
      <style>{`
        @media (max-width: 639.98px) {
          .bv-photo-crop-outer { padding-bottom: calc(1rem + 72px) !important; }
        }
      `}</style>
      <div className="w-full max-w-[420px] flex flex-col"
        style={{ background: "var(--card)", border: "1px solid var(--border)",
                 borderRadius: "var(--r-2xl)", boxShadow: "var(--shadow-lg)",
                 paddingBottom: "env(safe-area-inset-bottom)" }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5"
          style={{ borderBottom: "1px solid var(--border)" }}>
          <div className="min-w-0">
            <p className="text-[14px] font-semibold tracking-tight" style={{ color: "var(--w)" }}>{labels.title}</p>
            <p className="text-[11.5px] mt-0.5" style={{ color: "var(--w3)" }}>{labels.sub}</p>
          </div>
          <button onClick={onCancel} aria-label={gT.miClose}
            className="bv-icon-btn w-8 h-8 rounded-full flex items-center justify-center"
            style={{ color: "var(--w3)" }}>
            <XIcon size={14} strokeWidth={1.8} />
          </button>
        </div>

        {/* Crop area */}
        <div className="relative w-full"
          style={{ height: 320, background: "var(--bg)" }}>
          <Cropper
            image={src}
            crop={crop}
            zoom={zoom}
            aspect={1}
            cropShape="round"
            showGrid={false}
            minZoom={MIN_ZOOM}
            maxZoom={MAX_ZOOM}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
            objectFit="cover"
          />
        </div>

        {/* Zoom slider */}
        <div className="flex items-center gap-3 px-5 py-3" style={{ borderTop: "1px solid var(--border)" }}>
          <button onClick={() => setZoom(z => Math.max(MIN_ZOOM, z - ZOOM_STEP))}
            aria-label="Zoom out" title="Zoom out"
            className="bv-icon-btn w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ color: "var(--w2)" }}>
            <ZoomOut size={13} strokeWidth={1.8} />
          </button>
          <input type="range" min={MIN_ZOOM} max={MAX_ZOOM} step={0.01} value={zoom}
            onChange={e => setZoom(Number(e.target.value))}
            className="flex-1"
            style={{ accentColor: "var(--gold)" }} />
          <button onClick={() => setZoom(z => Math.min(MAX_ZOOM, z + ZOOM_STEP))}
            aria-label="Zoom in" title="Zoom in"
            className="bv-icon-btn w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ color: "var(--w2)" }}>
            <ZoomIn size={13} strokeWidth={1.8} />
          </button>
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-end gap-2 px-5 py-3" style={{ borderTop: "1px solid var(--border)" }}>
          <button onClick={onCancel}
            className="text-[12.5px] font-medium px-4 py-2 transition-colors"
            style={{ background: "transparent", color: "var(--w3)" }}>
            {labels.cancel}
          </button>
          <button onClick={save} disabled={!areaPixels || saving}
            className="inline-flex items-center gap-1.5 text-[13px] font-semibold px-5 py-2 transition-all hover:-translate-y-0.5 hover:opacity-95 disabled:opacity-40"
            style={{ background: "var(--gold)", color: "#131312",
                     borderRadius: "var(--r-md)",
                     boxShadow: "0 4px 14px var(--border-gold), 0 0 0 1px var(--border-gold)" }}>
            <Check size={13} strokeWidth={2} />
            {labels.save}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
