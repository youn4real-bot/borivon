"use client";

import { useRef, useState, useEffect, forwardRef, useImperativeHandle } from "react";
import { PdfViewer, PageOverlayFn } from "@/components/PdfViewer";
import { Spinner } from "@/components/ui/states";

export type SigZone = { page: number; x: number; y: number; w: number; h: number; party?: "candidate" | "admin" };

const PARTY_CYCLE: SigZone["party"][] = ["candidate", "admin"];

const PARTY_COLORS: Record<NonNullable<SigZone["party"]>, { border: string; bg: string; text: string }> = {
  candidate: { border: "var(--gold)",  bg: "rgba(201,162,64,0.15)",  text: "var(--gold)"  },
  admin:     { border: "#5b9bd5",      bg: "rgba(91,155,213,0.15)",  text: "#5b9bd5"      },
};

const PARTY_LABELS: Record<NonNullable<SigZone["party"]>, { en: string; fr: string; de: string }> = {
  candidate: { en: "Candidate", fr: "Candidat", de: "Kandidat" },
  admin:     { en: "Admin",     fr: "Admin",     de: "Admin"    },
};

const T = {
  en: { drawHint: "Draw a box on the document to place a signature zone" },
  fr: { drawHint: "Tracez un cadre sur le document pour placer une zone de signature" },
  de: { drawHint: "Zeichnen Sie einen Bereich auf dem Dokument für eine Unterschriftenzone" },
} as const;

type Props = {
  pdfBase64: string;
  onChange: (zones: SigZone[]) => void;
  onError?: () => void;
  lang?: keyof typeof T;
  /** Default party for newly drawn/added zones */
  defaultParty?: SigZone["party"];
  /** Live signature previews to show inside each party's zones */
  partyPreviews?: Partial<Record<NonNullable<SigZone["party"]>, string>>;
  /** Which parties are currently removing background (shows scanner animation) */
  partyBgRemoving?: Partial<Record<NonNullable<SigZone["party"]>, boolean>>;
  /** Called when user crops a party signature via double-click crop mode */
  onPartyImageCrop?: (party: string, dataUri: string) => void;
};

export type PdfZonePickerHandle = { addZone: () => void };

type CropInsets = { t: number; r: number; b: number; l: number };

type DragState =
  | { mode: "move"; idx: number; startClientX: number; startClientY: number; startCx: number; startCy: number; startZone: SigZone }
  | { mode: "resize"; idx: number; handle: string; startClientX: number; startClientY: number; startZone: SigZone; pageW: number; pageH: number; page: number }
  | { mode: "draw"; startClientX: number; startClientY: number; page: number }

const HANDLES = [
  { id: "nw", top: "0%",   left: "0%",   cursor: "nw-resize" },
  { id: "ne", top: "0%",   left: "100%", cursor: "ne-resize" },
  { id: "sw", top: "100%", left: "0%",   cursor: "sw-resize" },
  { id: "se", top: "100%", left: "100%", cursor: "se-resize" },
] as const;

export const PdfZonePicker = forwardRef<PdfZonePickerHandle, Props>(function PdfZonePicker({ pdfBase64, onChange, onError, lang = "en", defaultParty = "candidate", partyPreviews, partyBgRemoving, onPartyImageCrop }, ref) {
  const [blobUrl, setBlobUrl]     = useState<string | null>(null);
  const [zones, setZones]         = useState<SigZone[]>([]);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [pageCount, setPageCount] = useState(1);
  const [cropZoneIdx, setCropZoneIdx] = useState<number | null>(null);
  const [cropInsets, setCropInsets]   = useState<CropInsets>({ t: 0, r: 0, b: 0, l: 0 });

  const zonesRef    = useRef(zones);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; });
  useEffect(() => { zonesRef.current = zones; }, [zones]);

  const pageElsRef    = useRef<Map<number, HTMLElement>>(new Map());
  const dragRef       = useRef<DragState | null>(null);
  const cropImgRef    = useRef<HTMLImageElement | null>(null);
  const cropZoneElRef = useRef<HTMLElement | null>(null);
  const cropInsetsRef = useRef<CropInsets>({ t: 0, r: 0, b: 0, l: 0 });

  function updateCropInsets(ins: CropInsets) {
    cropInsetsRef.current = ins;
    setCropInsets(ins);
  }

  function applyCrop() {
    const img = cropImgRef.current;
    const el  = cropZoneElRef.current;
    const zoneIdx = cropZoneIdx;
    if (zoneIdx === null) { setCropZoneIdx(null); return; }
    const z     = zonesRef.current[zoneIdx];
    const party = z?.party ?? "candidate";
    const ins   = { ...cropInsetsRef.current }; // read BEFORE reset
    setCropZoneIdx(null);
    updateCropInsets({ t: 0, r: 0, b: 0, l: 0 });
    if (!img || !el || !onPartyImageCrop) return;
    const renderedW = el.offsetWidth, renderedH = el.offsetHeight;
    const imgW = img.naturalWidth, imgH = img.naturalHeight;
    if (!imgW || !imgH) return;
    const scale   = Math.min(renderedW / imgW, renderedH / imgH);
    const scaledW = imgW * scale, scaledH = imgH * scale;
    const offX    = (renderedW - scaledW) / 2, offY = (renderedH - scaledH) / 2;
    const startX  = Math.max(offX,           ins.l * renderedW);
    const startY  = Math.max(offY,           ins.t * renderedH);
    const endX    = Math.min(offX + scaledW, (1 - ins.r) * renderedW);
    const endY    = Math.min(offY + scaledH, (1 - ins.b) * renderedH);
    if (endX <= startX || endY <= startY) return;
    // Resize zone box to match the cropped content area
    if (z) {
      const lf = startX / renderedW, tf = startY / renderedH;
      const wf = (endX - startX) / renderedW, hf = (endY - startY) / renderedH;
      const next = [...zonesRef.current];
      next[zoneIdx] = { ...z, x: z.x + lf * z.w, y: z.y + tf * z.h, w: Math.max(0.02, wf * z.w), h: Math.max(0.02, hf * z.h) };
      emitZones(next);
    }
    const pixX = (startX - offX) / scale, pixY = (startY - offY) / scale;
    const pixW = (endX - startX) / scale,  pixH = (endY - startY) / scale;
    const canvas = document.createElement("canvas");
    canvas.width  = Math.round(pixW);
    canvas.height = Math.round(pixH);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, Math.round(pixX), Math.round(pixY), Math.round(pixW), Math.round(pixH), 0, 0, canvas.width, canvas.height);
    onPartyImageCrop(party, canvas.toDataURL("image/png"));
  }

  function emitZones(z: SigZone[]) {
    zonesRef.current = z;
    setZones(z);
    onChangeRef.current(z);
  }

  useEffect(() => {
    if (!pdfBase64) return;
    try {
      const bytes = Uint8Array.from(atob(pdfBase64), c => c.charCodeAt(0));
      const blob  = new Blob([bytes], { type: "application/pdf" });
      const url   = URL.createObjectURL(blob);
      setBlobUrl(url);
      return () => URL.revokeObjectURL(url);
    } catch {
      onError?.();
    }
  }, [pdfBase64]); // eslint-disable-line react-hooks/exhaustive-deps

  function pageFromClient(clientX: number, clientY: number): { pageNum: number; rect: DOMRect } | null {
    let best: { pageNum: number; rect: DOMRect; dist: number } | null = null;
    for (const [pageNum, el] of pageElsRef.current) {
      const rect = el.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        return { pageNum, rect };
      }
      const dy   = Math.max(rect.top - clientY, 0, clientY - rect.bottom);
      const dx   = Math.max(rect.left - clientX, 0, clientX - rect.right);
      const dist = Math.hypot(dx, dy);
      if (!best || dist < best.dist) best = { pageNum, rect, dist };
    }
    return best ? { pageNum: best.pageNum, rect: best.rect } : null;
  }

  useEffect(() => {
    const MIN_PX = 16;

    function onMove(e: MouseEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      e.preventDefault();
      const zs = zonesRef.current;

      if (drag.mode === "move") {
        const { idx, startClientX, startClientY, startCx, startCy, startZone } = drag;
        const dx  = e.clientX - startClientX;
        const dy  = e.clientY - startClientY;
        const hit = pageFromClient(startCx + dx, startCy + dy);
        if (!hit) return;
        const { pageNum, rect } = hit;
        const next = [...zs];
        next[idx] = {
          ...startZone,
          page: pageNum,
          x: Math.max(0, Math.min(1 - startZone.w, (startCx + dx - rect.left) / rect.width  - startZone.w / 2)),
          y: Math.max(0, Math.min(1 - startZone.h, (startCy + dy - rect.top)  / rect.height - startZone.h / 2)),
        };
        emitZones(next);

      } else if (drag.mode === "resize") {
        const { idx, handle, startClientX, startClientY, startZone, pageW, pageH, page } = drag;
        const dx = (e.clientX - startClientX) / pageW;
        const dy = (e.clientY - startClientY) / pageH;
        const { x: sx, y: sy, w: sw, h: sh } = startZone;
        // Proportional (aspect-ratio-locked) scale from dragged corner
        const sf_w = handle.includes("w") ? (sw - dx) / sw : (sw + dx) / sw;
        const sf_h = handle.includes("n") ? (sh - dy) / sh : (sh + dy) / sh;
        const scale = Math.max((sf_w + sf_h) / 2, Math.max(MIN_PX / pageW / sw, MIN_PX / pageH / sh));
        const newW  = sw * scale;
        const newH  = sh * scale;
        const newX  = handle.includes("w") ? sx + sw - newW : sx;
        const newY  = handle.includes("n") ? sy + sh - newH : sy;
        const next = [...zs];
        next[idx] = { ...startZone, page, x: Math.max(0, newX), y: Math.max(0, newY), w: Math.min(1 - Math.max(0, newX), newW), h: Math.min(1 - Math.max(0, newY), newH) };
        emitZones(next);

      } else if (drag.mode === "draw") {
        const { startClientX, startClientY, page } = drag;
        const el = pageElsRef.current.get(page);
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const x1 = (startClientX - rect.left) / rect.width;
        const y1 = (startClientY - rect.top)  / rect.height;
        const x2 = (e.clientX   - rect.left) / rect.width;
        const y2 = (e.clientY   - rect.top)  / rect.height;
        const x  = Math.min(x1, x2), y = Math.min(y1, y2);
        const w  = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
        const drawIdx = zs.length - 1;
        const next = [...zs];
        next[drawIdx] = { ...next[drawIdx], x: Math.max(0, x), y: Math.max(0, y), w: Math.min(1 - Math.max(0, x), w), h: Math.min(1 - Math.max(0, y), h) };
        emitZones(next);
      }
    }

    function onUp() {
      const drag = dragRef.current;
      dragRef.current = null;
      if (drag?.mode === "draw") {
        const zs = zonesRef.current;
        const drawIdx = zs.length - 1;
        const z = zs[drawIdx];
        if (z && (z.w < 0.02 || z.h < 0.01)) {
          const trimmed = zs.filter((_, i) => i !== drawIdx);
          emitZones(trimmed);
          setActiveIdx(trimmed.length > 0 ? trimmed.length - 1 : null);
        }
      }
    }

    window.addEventListener("mousemove", onMove, { passive: false });
    window.addEventListener("mouseup",   onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function getVisiblePage(): number {
    let bestPage = pageCount;
    let bestArea = 0;
    for (const [pageNum, el] of pageElsRef.current) {
      const r = el.getBoundingClientRect();
      const visH = Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0));
      const visW = Math.max(0, Math.min(r.right,  window.innerWidth)  - Math.max(r.left, 0));
      const area = visH * visW;
      if (area > bestArea) { bestArea = area; bestPage = pageNum; }
    }
    return bestPage;
  }

  function addZone() {
    const zs = zonesRef.current;
    const page = getVisiblePage();
    const newZone: SigZone = { page, x: 0.08, y: 0.1, w: 0.44, h: 0.13, party: defaultParty };
    const next = [...zs, newZone];
    emitZones(next);
    setActiveIdx(next.length - 1);
  }

  function removeZone(i: number) {
    const zs = zonesRef.current;
    const next = zs.filter((_, idx) => idx !== i);
    emitZones(next);
    setActiveIdx(next.length > 0 ? Math.min(i, next.length - 1) : null);
  }

  function toggleParty(i: number) {
    const zs = zonesRef.current;
    const next = [...zs];
    const current = next[i].party ?? "candidate";
    const idx = PARTY_CYCLE.indexOf(current);
    next[i] = { ...next[i], party: PARTY_CYCLE[(idx + 1) % PARTY_CYCLE.length] };
    emitZones(next);
  }

  useImperativeHandle(ref, () => ({ addZone }), []); // eslint-disable-line react-hooks/exhaustive-deps

  const pageOverlay: PageOverlayFn = ({ pageNum }) => {
    const zs = zones;
    return (
      <div
        ref={el => {
          if (el) pageElsRef.current.set(pageNum, el);
          else    pageElsRef.current.delete(pageNum);
        }}
        style={{ position: "absolute", inset: 0, cursor: "crosshair" }}
        onMouseDown={e => {
          if (e.button !== 0) return;
          e.preventDefault();
          const placeholder: SigZone = { page: pageNum, x: 0, y: 0, w: 0, h: 0, party: defaultParty };
          const next = [...zonesRef.current, placeholder];
          emitZones(next);
          setActiveIdx(next.length - 1);
          dragRef.current = { mode: "draw", startClientX: e.clientX, startClientY: e.clientY, page: pageNum };
        }}
      >
        {zs.map((z, i) => {
          if (z.page !== pageNum) return null;
          const party    = z.party ?? "candidate";
          const colors   = PARTY_COLORS[party];
          const label    = PARTY_LABELS[party][lang === "fr" ? "fr" : lang === "de" ? "de" : "en"];
          const isActive    = i === activeIdx;
          const inCropMode  = cropZoneIdx === i;

          function makeCropDragDown(hId: string) {
            return (e: React.MouseEvent) => {
              if (e.button !== 0) return;
              e.preventDefault(); e.stopPropagation();
              const el = pageElsRef.current.get(pageNum); if (!el) return;
              const rect = el.getBoundingClientRect();
              const startX = e.clientX, startY = e.clientY;
              const si = { ...cropInsetsRef.current };
              const pw = rect.width * z.w, ph = rect.height * z.h;
              function mv(ev: MouseEvent) {
                ev.preventDefault();
                const dx = (ev.clientX - startX) / pw;
                const dy = (ev.clientY - startY) / ph;
                const n = { ...si };
                if (hId.includes("n")) n.t = Math.max(0, Math.min(0.85 - si.b, si.t + dy));
                if (hId.includes("s")) n.b = Math.max(0, Math.min(0.85 - si.t, si.b - dy));
                if (hId.includes("w")) n.l = Math.max(0, Math.min(0.85 - si.r, si.l + dx));
                if (hId.includes("e")) n.r = Math.max(0, Math.min(0.85 - si.l, si.r - dx));
                updateCropInsets(n);
              }
              function up() { document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up); }
              document.addEventListener("mousemove", mv, { passive: false });
              document.addEventListener("mouseup", up);
            };
          }

          return (
            <div
              key={i}
              ref={cropZoneIdx === i ? (el => { cropZoneElRef.current = el; }) : undefined}
              style={{
                position: "absolute",
                left:   `${z.x * 100}%`,
                top:    `${z.y * 100}%`,
                width:  `${z.w * 100}%`,
                height: `${z.h * 100}%`,
                border: cropZoneIdx === i ? `2px solid rgba(255,255,255,0.9)` : `2px solid ${colors.border}`,
                background: colors.bg,
                borderRadius: 5,
                cursor: cropZoneIdx === i ? "default" : "move",
                boxSizing: "border-box",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 2,
                overflow: "hidden",
                zIndex: isActive ? 2 : 1,
                boxShadow: cropZoneIdx === i
                  ? "0 0 0 1px rgba(0,0,0,0.5), 0 6px 28px rgba(0,0,0,0.45)"
                  : isActive
                    ? `0 0 0 1px ${colors.border}40, 0 4px 20px rgba(0,0,0,0.3)`
                    : "0 2px 8px rgba(0,0,0,0.18)",
                transition: "box-shadow 0.15s, border-color 0.15s",
              }}
              onMouseDown={e => {
                if (e.button !== 0) return;
                e.preventDefault();
                e.stopPropagation();
                if (cropZoneIdx === i) return; // no move in crop mode
                setActiveIdx(i);
                const el = pageElsRef.current.get(pageNum);
                if (!el) return;
                const rect = el.getBoundingClientRect();
                dragRef.current = {
                  mode: "move",
                  idx: i,
                  startClientX: e.clientX,
                  startClientY: e.clientY,
                  startCx: rect.left + (z.x + z.w / 2) * rect.width,
                  startCy: rect.top  + (z.y + z.h / 2) * rect.height,
                  startZone: { ...z },
                };
              }}
              onClick={e => e.stopPropagation()}
              onDoubleClick={e => {
                if (!partyPreviews?.[party] || partyBgRemoving?.[party]) return;
                e.stopPropagation();
                if (cropZoneIdx === i) {
                  applyCrop();
                } else {
                  setCropZoneIdx(i);
                  updateCropInsets({ t: 0, r: 0, b: 0, l: 0 });
                  setActiveIdx(i);
                }
              }}
            >
              {/* Centre — show sig preview if available, else label */}
              {partyPreviews?.[party] ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    ref={cropZoneIdx === i ? (el => {
                      cropImgRef.current = el;
                      // also grab the zone element from parent div
                    }) : undefined}
                    src={partyPreviews[party]}
                    alt="signature preview"
                    style={{
                      width: "100%", height: "100%",
                      objectFit: "contain",
                      pointerEvents: "none", userSelect: "none",
                      filter: partyBgRemoving?.[party] ? "brightness(1.08) contrast(0.9)" : undefined,
                      clipPath: cropZoneIdx === i
                        ? `inset(${cropInsets.t*100}% ${cropInsets.r*100}% ${cropInsets.b*100}% ${cropInsets.l*100}%)`
                        : undefined,
                      transition: cropZoneIdx === i ? "none" : "clip-path 0.05s",
                    }}
                  />
                  {partyBgRemoving?.[party] && (
                    <div style={{
                      position: "absolute", inset: 0,
                      overflow: "hidden",
                      borderRadius: 3,
                      pointerEvents: "none",
                    }}>
                      {/* Scanner beam */}
                      <div style={{
                        position: "absolute",
                        left: 0, right: 0,
                        height: "35%",
                        background: "linear-gradient(to bottom, transparent 0%, rgba(120,200,255,0.55) 45%, rgba(80,180,255,0.75) 50%, rgba(120,200,255,0.55) 55%, transparent 100%)",
                        animation: "bvScan 1.1s ease-in-out infinite alternate",
                        boxShadow: "0 0 12px 4px rgba(80,180,255,0.4)",
                      }} />
                      {/* Sparkle dots */}
                      <div style={{
                        position: "absolute", inset: 0,
                        background: "radial-gradient(circle at 30% 60%, rgba(255,255,255,0.18) 0%, transparent 60%), radial-gradient(circle at 70% 30%, rgba(255,255,255,0.14) 0%, transparent 50%)",
                        animation: "bvSparkle 0.8s ease-in-out infinite alternate",
                      }} />
                      <style>{`
                        @keyframes bvScan {
                          0%   { top: -35%; }
                          100% { top: 100%; }
                        }
                        @keyframes bvSparkle {
                          0%   { opacity: 0.4; }
                          100% { opacity: 1; }
                        }
                      `}</style>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <span style={{
                    fontSize: 11, color: colors.text, fontWeight: 800,
                    textShadow: "0 1px 4px rgba(0,0,0,0.7)",
                    pointerEvents: "none", userSelect: "none", letterSpacing: "0.03em",
                    whiteSpace: "nowrap",
                  }}>
                    ✍ {label}
                  </span>
                  {(z.w >= 0.15 && z.h >= 0.07) && (
                    <span style={{
                      fontSize: 8, color: colors.text, opacity: 0.7,
                      pointerEvents: "none", userSelect: "none", whiteSpace: "nowrap",
                    }}>
                      {lang === "fr" ? "cliquer pour changer" : lang === "de" ? "klicken zum Ändern" : "click pill to change"}
                    </span>
                  )}
                </>
              )}

              {/* Party pill — top-left, click cycles candidate → org → admin */}
              <button
                style={{
                  position: "absolute", top: -1, left: -1,
                  fontSize: 8, fontWeight: 800, padding: "2px 8px",
                  borderRadius: "4px 0 5px 0",
                  background: colors.border,
                  color: party === "candidate" ? "#131312" : "#fff",
                  border: "none",
                  cursor: "pointer", lineHeight: 1.7, zIndex: 3,
                  letterSpacing: "0.07em",
                  textTransform: "uppercase",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
                }}
                onMouseDown={e => e.stopPropagation()}
                onClick={e => { e.stopPropagation(); toggleParty(i); }}
                title={lang === "fr" ? "Changer de partie" : lang === "de" ? "Partei wechseln" : "Click to change party"}
              >
                {label}
              </button>

              {/* Remove × — top-right */}
              <button
                style={{
                  position: "absolute", top: -7, right: -7,
                  width: 18, height: 18,
                  borderRadius: "50%",
                  background: "rgba(20,20,20,0.82)",
                  backdropFilter: "blur(6px)",
                  color: "#fff", border: "1.5px solid rgba(255,255,255,0.18)", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  zIndex: 5,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.45)",
                  transition: "background 0.12s",
                }}
                onMouseDown={e => e.stopPropagation()}
                onClick={e => { e.stopPropagation(); removeZone(i); }}
              >
                <span style={{ fontSize: 8, fontWeight: 900, lineHeight: 1 }}>✕</span>
              </button>

              {/* Crop-mode UI: moving frame + dim + drag targets */}
              {inCropMode && (() => {
                const t = cropInsets.t, b = cropInsets.b, l = cropInsets.l, r = cropInsets.r;
                const tp = `${t*100}%`, bp = `${b*100}%`, lp = `${l*100}%`, rp = `${r*100}%`;
                const t1 = `${(1-b)*100}%`, l1 = `${(1-r)*100}%`;
                return (
                  <>
                    {/* Dark overlay outside crop frame */}
                    <div style={{ position:"absolute", top:0, left:0, right:0, height:tp, background:"rgba(0,0,0,0.42)", pointerEvents:"none", zIndex:2 }} />
                    <div style={{ position:"absolute", bottom:0, left:0, right:0, height:bp, background:"rgba(0,0,0,0.42)", pointerEvents:"none", zIndex:2 }} />
                    <div style={{ position:"absolute", top:tp, bottom:bp, left:0, width:lp, background:"rgba(0,0,0,0.42)", pointerEvents:"none", zIndex:2 }} />
                    <div style={{ position:"absolute", top:tp, bottom:bp, right:0, width:rp, background:"rgba(0,0,0,0.42)", pointerEvents:"none", zIndex:2 }} />
                    {/* Moving crop frame lines */}
                    <div style={{ position:"absolute", top:tp, left:lp, right:rp, height:2, background:"#fff", boxShadow:"0 0 6px rgba(0,0,0,0.5)", pointerEvents:"none", zIndex:3 }} />
                    <div style={{ position:"absolute", bottom:bp, left:lp, right:rp, height:2, background:"#fff", boxShadow:"0 0 6px rgba(0,0,0,0.5)", pointerEvents:"none", zIndex:3 }} />
                    <div style={{ position:"absolute", top:tp, bottom:bp, left:lp, width:2, background:"#fff", boxShadow:"0 0 6px rgba(0,0,0,0.5)", pointerEvents:"none", zIndex:3 }} />
                    <div style={{ position:"absolute", top:tp, bottom:bp, right:rp, width:2, background:"#fff", boxShadow:"0 0 6px rgba(0,0,0,0.5)", pointerEvents:"none", zIndex:3 }} />
                    {/* Corner handles at crop frame corners */}
                    {([["nw",tp,lp],["ne",tp,l1],["sw",t1,lp],["se",t1,l1]] as [string,string,string][]).map(([id,cy,cx]) => (
                      <div key={`cv-${id}`} style={{ position:"absolute", top:cy, left:cx, transform:"translate(-50%,-50%)", width:16, height:16, background:"#fff", border:"2.5px solid rgba(0,0,0,0.45)", borderRadius:"50%", boxShadow:"0 2px 8px rgba(0,0,0,0.5)", pointerEvents:"none", zIndex:4 }} />
                    ))}
                    {/* Transparent drag strips — positioned at the moving crop frame */}
                    <div style={{ position:"absolute", top:tp, left:lp, right:rp, height:24, transform:"translateY(-50%)", cursor:"n-resize", zIndex:5 }} onMouseDown={makeCropDragDown("n")} />
                    <div style={{ position:"absolute", bottom:bp, left:lp, right:rp, height:24, transform:"translateY(50%)", cursor:"s-resize", zIndex:5 }} onMouseDown={makeCropDragDown("s")} />
                    <div style={{ position:"absolute", top:tp, bottom:bp, left:lp, width:24, transform:"translateX(-50%)", cursor:"w-resize", zIndex:5 }} onMouseDown={makeCropDragDown("w")} />
                    <div style={{ position:"absolute", top:tp, bottom:bp, right:rp, width:24, transform:"translateX(50%)", cursor:"e-resize", zIndex:5 }} onMouseDown={makeCropDragDown("e")} />
                    <div style={{ position:"absolute", top:tp, left:lp, transform:"translate(-50%,-50%)", width:28, height:28, cursor:"nw-resize", zIndex:6 }} onMouseDown={makeCropDragDown("nw")} />
                    <div style={{ position:"absolute", top:tp, left:l1, transform:"translate(-50%,-50%)", width:28, height:28, cursor:"ne-resize", zIndex:6 }} onMouseDown={makeCropDragDown("ne")} />
                    <div style={{ position:"absolute", top:t1, left:lp, transform:"translate(-50%,-50%)", width:28, height:28, cursor:"sw-resize", zIndex:6 }} onMouseDown={makeCropDragDown("sw")} />
                    <div style={{ position:"absolute", top:t1, left:l1, transform:"translate(-50%,-50%)", width:28, height:28, cursor:"se-resize", zIndex:6 }} onMouseDown={makeCropDragDown("se")} />
                  </>
                );
              })()}

              {/* Resize handles — only on active zone, not in crop mode */}
              {isActive && !inCropMode && HANDLES.map(h => (
                <div
                  key={h.id}
                  style={{
                    position: "absolute",
                    top: h.top, left: h.left,
                    transform: "translate(-50%, -50%)",
                    width: 12, height: 12,
                    background: "#fff",
                    border: `2.5px solid ${colors.border}`,
                    borderRadius: "50%",
                    cursor: h.cursor,
                    zIndex: 4,
                    boxShadow: `0 2px 8px rgba(0,0,0,0.4), 0 0 0 1px ${colors.border}30`,
                  }}
                  onMouseDown={e => {
                    if (e.button !== 0) return;
                    e.preventDefault(); e.stopPropagation();
                    const el = pageElsRef.current.get(pageNum); if (!el) return;
                    const rect = el.getBoundingClientRect();
                    dragRef.current = { mode:"resize", idx:i, handle:h.id, startClientX:e.clientX, startClientY:e.clientY, startZone:{...z}, pageW:rect.width, pageH:rect.height, page:pageNum };
                  }}
                />
              ))}
            </div>
          );
        })}
      </div>
    );
  };

  if (!blobUrl) {
    return (
      <div style={{
        height: "62dvh", borderRadius: 12, overflow: "hidden",
        border: "1px solid var(--border)", background: "#525659",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <Spinner size="md" />
      </div>
    );
  }

  return (
    <div
      style={{ position: "relative", height: "62dvh", borderRadius: 12, overflow: "hidden", border: "1px solid var(--border)" }}
      onClick={() => { if (cropZoneIdx !== null) applyCrop(); }}
    >
      {zones.length === 0 && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 10,
          display: "flex", alignItems: "center", justifyContent: "center",
          pointerEvents: "none",
        }}>
          <div style={{
            background: "rgba(0,0,0,0.55)", backdropFilter: "blur(2px)",
            borderRadius: 10, padding: "10px 18px",
            color: "#fff", fontSize: 12, fontWeight: 500, textAlign: "center",
            maxWidth: 260, lineHeight: 1.5,
            border: "1px solid rgba(255,255,255,0.12)",
          }}>
            ✏️ {T[lang].drawHint}
          </div>
        </div>
      )}
      <PdfViewer
        src={blobUrl}
        hideRotate
        pageOverlay={pageOverlay}
        onPagesLoaded={count => { setPageCount(count); }}
      />
    </div>
  );
});
