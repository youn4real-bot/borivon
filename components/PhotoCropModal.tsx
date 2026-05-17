"use client";

/**
 * Circular photo crop / zoom modal.
 *
 * Opens automatically right after a candidate selects a CV photo. The image
 * is shown inside a fixed circular viewport with a darkened overlay so the
 * user always sees what the final framing will look like. They can:
 *   - drag to pan
 *   - mouse-wheel / pinch / +/- buttons to zoom
 *   - Save → outputs a square 600×600 JPEG of the circle's contents
 *   - Cancel → drops the upload
 *
 * The output is square (the round look comes from CSS `border-radius: 50%`
 * on every render — CV PDF, ProfileIcon, public profile, etc).
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X as XIcon, ZoomIn, ZoomOut, Check } from "lucide-react";
import { useLang } from "@/components/LangContext";

const OUTPUT_SIZE = 600;       // saved JPEG size (high-DPI ready)
const VIEWPORT_DESKTOP = 320;  // displayed circle size on desktop
const VIEWPORT_MOBILE  = 240;  // displayed circle size on phones
const ZOOM_STEP = 1.18;
const MAX_USER_ZOOM = 6;       // 6× the cover-fit scale

export function PhotoCropModal({
  src, onSave, onCancel,
}: {
  src: string;
  onSave: (dataUrl: string) => void;
  onCancel: () => void;
}) {
  const { lang, t: gT } = useLang();
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [naturalW, setNaturalW] = useState(0);
  const [naturalH, setNaturalH] = useState(0);
  const [scale, setScale]       = useState(1);
  const [tx, setTx]             = useState(0); // image center offset from viewport center (px)
  const [ty, setTy]             = useState(0);

  // Pick viewport size based on screen width (initialized on client mount only)
  const [viewport, setViewport] = useState<number>(VIEWPORT_DESKTOP);
  useEffect(() => {
    const update = () => setViewport(window.innerWidth < 480 ? VIEWPORT_MOBILE : VIEWPORT_DESKTOP);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const dragRef  = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const pinchRef = useRef<{ dist: number; scale: number } | null>(null);

  // Load image to learn natural dimensions, then fit-cover into the circle.
  // Only re-runs when the source changes — resizing the window during a crop
  // session must NOT wipe the user's positioning. Viewport changes are
  // handled by the re-fit effect below.
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setNaturalW(img.naturalWidth);
      setNaturalH(img.naturalHeight);
      const fit = Math.max(viewport / img.naturalWidth, viewport / img.naturalHeight);
      setScale(fit);
      setTx(0); setTy(0);
      imgRef.current = img;
    };
    img.crossOrigin = "anonymous";
    img.src = src;
  }, [src]); // eslint-disable-line react-hooks/exhaustive-deps

  // When the viewport changes (rotation / window resize), re-clamp scale and
  // offset so the image still covers the new circle — preserves the user's
  // current framing instead of resetting to fit-cover with tx=ty=0.
  useEffect(() => {
    if (!naturalW || !naturalH) return;
    const c = clamp(scale, tx, ty);
    setScale(c.s); setTx(c.x); setTy(c.y);
  }, [viewport]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clamp scale + offset so the image always covers the circle
  function clamp(s: number, x: number, y: number) {
    if (!naturalW || !naturalH) return { s, x, y };
    const minScale = Math.max(viewport / naturalW, viewport / naturalH);
    const cs = Math.max(minScale, Math.min(minScale * MAX_USER_ZOOM, s));
    const halfW = (naturalW * cs) / 2;
    const halfH = (naturalH * cs) / 2;
    const maxX = halfW - viewport / 2;
    const maxY = halfH - viewport / 2;
    return {
      s: cs,
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y)),
    };
  }

  function setZoom(next: number) {
    const c = clamp(next, tx, ty);
    setScale(c.s); setTx(c.x); setTy(c.y);
  }

  // Mouse drag → pan
  function onMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    dragRef.current = { x: e.clientX, y: e.clientY, tx, ty };
  }
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const c = clamp(scale, d.tx + (e.clientX - d.x), d.ty + (e.clientY - d.y));
      setTx(c.x); setTy(c.y);
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [scale, naturalW, naturalH, viewport]); // eslint-disable-line react-hooks/exhaustive-deps

  // Touch drag + pinch
  function onTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchRef.current = { dist: Math.hypot(dx, dy), scale };
    } else if (e.touches.length === 1) {
      dragRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, tx, ty };
    }
  }
  function onTouchMove(e: React.TouchEvent) {
    if (e.touches.length === 2 && pinchRef.current) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      setZoom(pinchRef.current.scale * (dist / pinchRef.current.dist));
    } else if (e.touches.length === 1 && dragRef.current) {
      const d = dragRef.current;
      const c = clamp(scale, d.tx + (e.touches[0].clientX - d.x), d.ty + (e.touches[0].clientY - d.y));
      setTx(c.x); setTy(c.y);
    }
  }
  function onTouchEnd() { dragRef.current = null; pinchRef.current = null; }

  // Wheel → zoom
  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    setZoom(scale * (e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP));
  }

  function save() {
    if (!imgRef.current || !naturalW || !naturalH) return;
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Convert viewport coordinates back to image-pixel coordinates.
    // Image center in viewport: (viewport/2 + tx, viewport/2 + ty)
    // → viewport center in image coords:
    const imgCx = naturalW / 2 - tx / scale;
    const imgCy = naturalH / 2 - ty / scale;
    const halfSrc = (viewport / 2) / scale;

    ctx.drawImage(
      imgRef.current,
      imgCx - halfSrc, imgCy - halfSrc, halfSrc * 2, halfSrc * 2,
      0, 0, OUTPUT_SIZE, OUTPUT_SIZE,
    );
    onSave(canvas.toDataURL("image/jpeg", 0.92));
  }

  // Esc cancels
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onCancel]);

  if (typeof document === "undefined") return null;

  const minScale = naturalW && naturalH ? Math.max(viewport / naturalW, viewport / naturalH) : 1;
  const sliderPct = (() => {
    const range = minScale * MAX_USER_ZOOM - minScale;
    if (range <= 0) return 0;
    return ((scale - minScale) / range) * 100;
  })();

  const labels = lang === "de"
    ? { title: "Foto zuschneiden", sub: "Verschieben und zoomen, um den Bildausschnitt zu wählen.", save: "Speichern", cancel: "Abbrechen" }
    : lang === "fr"
    ? { title: "Recadrer la photo", sub: "Glissez et zoomez pour ajuster le cadrage.", save: "Enregistrer", cancel: "Annuler" }
    : { title: "Crop your photo", sub: "Drag to position, pinch or scroll to zoom.", save: "Save", cancel: "Cancel" };

  return createPortal(
    // z-[10050] — the crop modal is launched FROM other modals (the "My
    // profile" sheet sits at z-[10000], its photo menu at z-[10010]). At the
    // old z-[1150] it opened BEHIND them, so on phones it looked like
    // "tapping the photo does nothing / it's hidden". Must sit above every
    // modal that can spawn it.
    <div className="fixed inset-x-0 bottom-0 top-[58px] z-[10050] flex items-center justify-center p-4 bv-photo-crop-outer"
      style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(8px)",
               animation: "bvFadeRise 0.22s var(--ease-out)" }}>
      <style>{`
        @media (max-width: 639.98px) {
          .bv-photo-crop-outer { padding-bottom: calc(1rem + 72px) !important; }
        }
      `}</style>
      <div className="w-full max-w-[420px] flex flex-col overflow-y-auto"
        style={{ background: "var(--card)", border: "1px solid var(--border)",
                 borderRadius: "var(--r-2xl)", boxShadow: "var(--shadow-lg)",
                 paddingBottom: "env(safe-area-inset-bottom)",
                 maxHeight: "calc(100dvh - 58px - var(--bv-subnav-h, 0px) - 96px)" }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 flex-shrink-0"
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

        {/* Crop area — same surface tone as the rest of the dashboard */}
        <div className="flex items-center justify-center py-6"
          style={{ background: "var(--bg)" }}>
          <div
            role="application"
            aria-label={labels.title}
            tabIndex={0}
            onMouseDown={onMouseDown}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onWheel={onWheel}
            // Arrow-key pan / +/-/= zoom for keyboard users (no pointer needed)
            onKeyDown={e => {
              const STEP = 12; // px per arrow press
              if (e.key === "ArrowLeft")  { e.preventDefault(); const c = clamp(scale, tx + STEP, ty); setTx(c.x); setTy(c.y); }
              else if (e.key === "ArrowRight") { e.preventDefault(); const c = clamp(scale, tx - STEP, ty); setTx(c.x); setTy(c.y); }
              else if (e.key === "ArrowUp")    { e.preventDefault(); const c = clamp(scale, tx, ty + STEP); setTx(c.x); setTy(c.y); }
              else if (e.key === "ArrowDown")  { e.preventDefault(); const c = clamp(scale, tx, ty - STEP); setTx(c.x); setTy(c.y); }
              else if (e.key === "+" || e.key === "=") { e.preventDefault(); setZoom(scale * ZOOM_STEP); }
              else if (e.key === "-" || e.key === "_") { e.preventDefault(); setZoom(scale / ZOOM_STEP); }
            }}
            style={{
              width: viewport, height: viewport,
              position: "relative", overflow: "hidden",
              borderRadius: "9999px",
              cursor: dragRef.current ? "grabbing" : "grab",
              touchAction: "none",
              outline: "none",
              // Gold glow ring around the crop circle (no heavy outer dim,
              // since the page chrome stays visible behind the modal).
              boxShadow: "0 0 0 2px var(--border-gold), 0 0 24px var(--gdim)",
              userSelect: "none",
            }}>
            { /* eslint-disable-next-line @next/next/no-img-element */ }
            <img src={src} alt="crop"
              draggable={false}
              style={{
                position: "absolute",
                left: "50%", top: "50%",
                width:  naturalW * scale,
                height: naturalH * scale,
                transform: `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px))`,
                userSelect: "none", pointerEvents: "none",
                maxWidth: "none", maxHeight: "none",
              }} />
          </div>
        </div>

        {/* Zoom slider */}
        <div className="flex items-center gap-3 px-5 py-3" style={{ borderTop: "1px solid var(--border)" }}>
          <button onClick={() => setZoom(scale / ZOOM_STEP)}
            aria-label="Zoom out" title="Zoom out"
            className="bv-icon-btn w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ color: "var(--w2)" }}>
            <ZoomOut size={13} strokeWidth={1.8} />
          </button>
          <input type="range" min={0} max={100} step={1} value={sliderPct}
            onChange={e => {
              const pct = Number(e.target.value);
              const range = minScale * MAX_USER_ZOOM - minScale;
              setZoom(minScale + (range * pct) / 100);
            }}
            className="flex-1"
            style={{ accentColor: "var(--gold)" }}
          />
          <button onClick={() => setZoom(scale * ZOOM_STEP)}
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
          <button onClick={save} disabled={!naturalW}
            className="inline-flex items-center gap-1.5 text-[13px] font-semibold px-5 py-2 transition-all hover:-translate-y-0.5 hover:opacity-95 disabled:opacity-40"
            style={{
              background: "var(--gold)", color: "#131312",
              borderRadius: "var(--r-md)",
              boxShadow: "0 4px 14px var(--border-gold), 0 0 0 1px var(--border-gold)",
            }}>
            <Check size={13} strokeWidth={2} />
            {labels.save}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
