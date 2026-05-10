"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { FilePen, CheckCircle2, X as XIcon, Download, Upload } from "lucide-react";
import { Spinner } from "@/components/ui/states";
import { PdfViewer } from "@/components/PdfViewer";
import type { SigZone } from "@/components/PdfZonePicker";

function removeImageBg(dataUri: string): Promise<string> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(dataUri); return; }
        ctx.drawImage(img, 0, 0);
        const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = id.data;
        const n = canvas.width * canvas.height;
        const hist = new Array(256).fill(0);
        for (let i = 0; i < d.length; i += 4) hist[Math.round((d[i] + d[i+1] + d[i+2]) / 3)]++;
        let sumAll = 0;
        for (let k = 0; k < 256; k++) sumAll += k * hist[k];
        let sumB = 0, cntB = 0, bestT = 128, maxVar = 0;
        for (let T = 0; T < 256; T++) {
          cntB += hist[T];
          if (!cntB || cntB === n) continue;
          sumB += T * hist[T];
          const mB = sumB / cntB, mA = (sumAll - sumB) / (n - cntB);
          const v = cntB * (n - cntB) * (mB - mA) ** 2;
          if (v > maxVar) { maxVar = v; bestT = T; }
        }
        const lo = bestT, hi = bestT + 0.15 * (255 - bestT);
        for (let i = 0; i < d.length; i += 4) {
          const b = (d[i] + d[i+1] + d[i+2]) / 3;
          if (b >= hi) d[i+3] = 0;
          else if (b >= lo) d[i+3] = Math.round((hi - b) / (hi - lo) * 255);
        }
        ctx.putImageData(id, 0, 0);
        resolve(canvas.toDataURL("image/png"));
      } catch { resolve(dataUri); }
    };
    img.onerror = () => resolve(dataUri);
    img.src = dataUri;
  });
}

export type SignRequestFull = {
  id: string;
  document_name: string;
  note: string | null;
  status: "pending" | "signed" | "declined";
  signed_at: string | null;
  created_at: string;
  signature_zone: SigZone | SigZone[] | null;
  pdf_preview_url: string | null;
};

const T = {
  en: {
    close: "Close", confirm: "Confirm & sign", signing: "Signing…",
    noSig: "Please add your signature first",
    useSaved: "Use saved", saveForNext: "Save for next time",
    saving: "Saving…", download: "Download signed copy", signed: "Signed",
    clear: "Clear", dropHere: "Drop or click to sign",
    note: "Note:",
    noPreview: "No PDF preview available",
    replace: "Replace", removingBg: "Removing background…",
  },
  fr: {
    close: "Fermer", confirm: "Confirmer & signer", signing: "Signature…",
    noSig: "Veuillez d'abord signer",
    useSaved: "Utiliser la sauvegardée", saveForNext: "Enregistrer pour la prochaine fois",
    saving: "Enregistrement…", download: "Télécharger la copie signée", signed: "Signé",
    clear: "Effacer", dropHere: "Déposez ou cliquez pour signer",
    note: "Note :",
    noPreview: "Aperçu PDF indisponible",
    replace: "Remplacer", removingBg: "Suppression du fond…",
  },
  de: {
    close: "Schließen", confirm: "Bestätigen & unterschreiben", signing: "Wird unterschrieben…",
    noSig: "Bitte zuerst unterschreiben",
    useSaved: "Gespeicherte verwenden", saveForNext: "Für nächstes Mal speichern",
    saving: "Speichern…", download: "Unterschriebene Kopie herunterladen", signed: "Unterschrieben",
    clear: "Löschen", dropHere: "Ablegen oder klicken zum Unterschreiben",
    note: "Hinweis:",
    noPreview: "PDF-Vorschau nicht verfügbar",
    replace: "Ersetzen", removingBg: "Hintergrund wird entfernt…",
  },
} as const;
type Lang = keyof typeof T;

type Props = {
  request: SignRequestFull;
  lang: Lang;
  authToken: string;
  onSigned: (id: string) => void;
  onClose: () => void;
};

const G = {
  accent: "var(--gold)",
  bg: "rgba(201,162,64,0.06)",
  border: "var(--border-gold)",
  bgHover: "rgba(201,162,64,0.14)",
};

const HANDLES = [
  { id: "nw", top: "0%",   left: "0%",   cursor: "nw-resize" },
  { id: "ne", top: "0%",   left: "100%", cursor: "ne-resize" },
  { id: "sw", top: "100%", left: "0%",   cursor: "sw-resize" },
  { id: "se", top: "100%", left: "100%", cursor: "se-resize" },
] as const;

type CropInsets = { t: number; r: number; b: number; l: number };

export function PdfSignModal({ request, lang, authToken, onSigned, onClose }: Props) {
  const t = T[lang] ?? T.en;

  const [savedSig, setSavedSig]     = useState<string | null>(null);
  const [sigData, setSigData]       = useState<string | null>(null);
  const [usingSaved, setUsingSaved] = useState(false);
  const [wantSave, setWantSave]     = useState(true);
  const [savingSig, setSavingSig]   = useState(false);
  const [bgRemoving, setBgRemoving] = useState(false);
  const [dropDragOver, setDropDragOver] = useState(false);

  // Inline crop state — exact match to PdfZonePicker
  const [cropZoneIdx, setCropZoneIdx] = useState<number | null>(null);
  const [cropInsets, setCropInsets]   = useState<CropInsets>({ t: 0, r: 0, b: 0, l: 0 });
  const cropImgRef    = useRef<HTMLImageElement | null>(null);
  const cropZoneElRef = useRef<HTMLElement | null>(null);
  const cropInsetsRef = useRef<CropInsets>({ t: 0, r: 0, b: 0, l: 0 });

  const uploadRef = useRef<HTMLInputElement>(null);

  const [sigPlaced, setSigPlaced] = useState(false);
  const [signing, setSigning]     = useState(false);
  const [err, setErr]             = useState("");
  const [signedUrl, setSignedUrl] = useState<string | null>(null);

  const [localZones, setLocalZones] = useState<SigZone[]>(() => {
    const raw = request.signature_zone;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.filter(z => !z.party || z.party === "candidate");
    if (!raw.party || raw.party === "candidate") return [raw as SigZone];
    return [];
  });
  const localZonesRef = useRef<SigZone[]>([]);
  useEffect(() => { localZonesRef.current = localZones; }, [localZones]);

  const [activeZoneIdx, setActiveZoneIdx] = useState<number | null>(null);
  const pageElsRef = useRef<Map<number, HTMLElement>>(new Map());

  type ZDrag =
    | { mode: "move"; idx: number; startClientX: number; startClientY: number; startCx: number; startCy: number; startZone: SigZone }
    | { mode: "resize"; idx: number; handle: string; startClientX: number; startClientY: number; startZone: SigZone; pageW: number; pageH: number };
  const zoneDragRef = useRef<ZDrag | null>(null);

  function updateCropInsets(ins: CropInsets) {
    cropInsetsRef.current = ins;
    setCropInsets(ins);
  }

  useEffect(() => {
    if (!authToken) return;
    fetch("/api/portal/me/signature", { headers: { Authorization: `Bearer ${authToken}` } })
      .then(r => r.ok ? r.json() : { signature: null })
      .then((j: { signature?: string | null }) => {
        if (j.signature) { setSavedSig(j.signature); setSigData(j.signature); setUsingSaved(true); setSigPlaced(true); }
      })
      .catch(() => {});
  }, [authToken]);

  useEffect(() => {
    const MIN_PX = 16;
    function onMove(e: MouseEvent) {
      const drag = zoneDragRef.current;
      if (!drag) return;
      e.preventDefault();
      if (drag.mode === "move") {
        const { idx, startClientX, startClientY, startCx, startCy, startZone } = drag;
        const dx = e.clientX - startClientX, dy = e.clientY - startClientY;
        let hit: { pageNum: number; rect: DOMRect } | null = null;
        for (const [pageNum, el] of pageElsRef.current) {
          const rect = el.getBoundingClientRect();
          if (startCx + dx >= rect.left && startCx + dx <= rect.right && startCy + dy >= rect.top && startCy + dy <= rect.bottom) {
            hit = { pageNum, rect }; break;
          }
        }
        if (!hit) return;
        setLocalZones(prev => {
          const next = [...prev];
          next[idx] = { ...startZone, page: hit!.pageNum, x: Math.max(0, Math.min(1 - startZone.w, (startCx + dx - hit!.rect.left) / hit!.rect.width - startZone.w / 2)), y: Math.max(0, Math.min(1 - startZone.h, (startCy + dy - hit!.rect.top) / hit!.rect.height - startZone.h / 2)) };
          return next;
        });
      } else if (drag.mode === "resize") {
        const { idx, handle, startClientX, startClientY, startZone, pageW, pageH } = drag;
        const dx = (e.clientX - startClientX) / pageW, dy = (e.clientY - startClientY) / pageH;
        const { x: sx, y: sy, w: sw, h: sh } = startZone;
        const sf_w = handle.includes("w") ? (sw - dx) / sw : (sw + dx) / sw;
        const sf_h = handle.includes("n") ? (sh - dy) / sh : (sh + dy) / sh;
        const scale = Math.max((sf_w + sf_h) / 2, Math.max(MIN_PX / pageW / sw, MIN_PX / pageH / sh));
        const newW = sw * scale, newH = sh * scale;
        const newX = handle.includes("w") ? sx + sw - newW : sx;
        const newY = handle.includes("n") ? sy + sh - newH : sy;
        setLocalZones(prev => {
          const next = [...prev];
          next[idx] = { ...startZone, x: Math.max(0, newX), y: Math.max(0, newY), w: Math.min(1 - Math.max(0, newX), newW), h: Math.min(1 - Math.max(0, newY), newH) };
          return next;
        });
      }
    }
    function onUp() { zoneDragRef.current = null; }
    window.addEventListener("mousemove", onMove, { passive: false });
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  // Inline crop — exact copy from PdfZonePicker
  function applyCrop() {
    const img = cropImgRef.current;
    const el  = cropZoneElRef.current;
    const zoneIdx = cropZoneIdx;
    if (zoneIdx === null) { setCropZoneIdx(null); return; }
    const z   = localZonesRef.current[zoneIdx];
    const ins = { ...cropInsetsRef.current };
    setCropZoneIdx(null);
    updateCropInsets({ t: 0, r: 0, b: 0, l: 0 });
    if (!img || !el) return;
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
    if (z) {
      const lf = startX / renderedW, tf = startY / renderedH;
      const wf = (endX - startX) / renderedW, hf = (endY - startY) / renderedH;
      setLocalZones(prev => {
        const next = [...prev];
        next[zoneIdx] = { ...z, x: z.x + lf * z.w, y: z.y + tf * z.h, w: Math.max(0.02, wf * z.w), h: Math.max(0.02, hf * z.h) };
        return next;
      });
    }
    const pixX = (startX - offX) / scale, pixY = (startY - offY) / scale;
    const pixW = (endX - startX) / scale,  pixH = (endY - startY) / scale;
    const canvas = document.createElement("canvas");
    canvas.width  = Math.round(pixW);
    canvas.height = Math.round(pixH);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, Math.round(pixX), Math.round(pixY), Math.round(pixW), Math.round(pixH), 0, 0, canvas.width, canvas.height);
    setSigData(canvas.toDataURL("image/png"));
  }

  function applyBgRemoval(dataUri: string) {
    setSigData(dataUri);
    setSigPlaced(true);
    setBgRemoving(true);
    setUsingSaved(false);
    Promise.all([removeImageBg(dataUri), new Promise(r => setTimeout(r, 2200))])
      .then(([clean]) => { setSigData(clean as string); setBgRemoving(false); });
  }

  function handleFileRead(file: File) {
    const reader = new FileReader();
    reader.onload = () => applyBgRemoval(reader.result as string);
    reader.readAsDataURL(file);
  }

  async function handleConfirm() {
    if (signing) return;
    if (!sigData) { setErr(t.noSig); return; }
    setErr(""); setSigning(true);
    try {
      const res = await fetch(`/api/portal/me/sign-requests/${request.id}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ signatureBase64: sigData, ...(localZones.length ? { signatureZone: localZones } : {}) }),
      });
      const j = await res.json() as { ok?: boolean; error?: string; signedPdfUrl?: string };
      if (!res.ok) { setErr(j.error ?? "Error"); return; }
      if (wantSave && sigData && sigData !== savedSig) {
        setSavingSig(true);
        fetch("/api/portal/me/signature", {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
          body: JSON.stringify({ signature: sigData }),
        }).then(() => setSavedSig(sigData)).catch(() => {}).finally(() => setSavingSig(false));
      }
      setSignedUrl(j.signedPdfUrl ?? null);
      onSigned(request.id);
    } catch (e) { setErr(String(e)); }
    finally { setSigning(false); }
  }

  function clearSig() { setSigData(null); setUsingSaved(false); setSigPlaced(false); }

  if (typeof document === "undefined") return null;

  const modal = createPortal(
    <div
      className="fixed inset-x-0 z-[1300] flex items-center justify-center px-2 bv-sign-modal-outer"
      style={{ top: "calc(58px + var(--bv-subnav-h, 0px))", paddingTop: "6px", bottom: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(10px)" }}
      onClick={() => { if (!signing) onClose(); }}
    >
      <style>{`
        .bv-sign-modal-card {
          max-height: calc(100dvh - 58px - var(--bv-subnav-h, 0px) - 12px - env(safe-area-inset-bottom, 0px));
        }
        @media (max-width: 639.98px) {
          .bv-sign-modal-outer { padding-bottom: calc(72px + 6px + env(safe-area-inset-bottom, 0px)) !important; }
          .bv-sign-modal-card {
            max-height: calc(100dvh - 58px - var(--bv-subnav-h, 0px) - 6px - 72px - 6px - env(safe-area-inset-bottom, 0px)) !important;
          }
        }
        @keyframes bvScan { 0% { top: -35%; } 100% { top: 100%; } }
        @keyframes bvSparkle { 0% { opacity: 0.4; } 100% { opacity: 1; } }
      `}</style>

      <div
        className="bv-sign-modal-card w-full max-w-4xl rounded-2xl overflow-hidden flex flex-col"
        style={{ background: "var(--card)", border: "1px solid var(--border)", boxShadow: "var(--shadow-lg)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 flex-shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
          <div className="min-w-0 flex-1 mr-3">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] mb-0.5" style={{ color: "var(--w3)" }}>
              {lang === "fr" ? "Demande de signature" : lang === "de" ? "Signaturanfrage" : "Signature request"}
            </p>
            <p className="text-[13.5px] font-semibold truncate tracking-tight" style={{ color: "var(--w)" }}>{request.document_name}</p>
          </div>
          <button onClick={onClose} disabled={signing}
            className="bv-icon-btn w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full transition-opacity hover:opacity-70 disabled:opacity-40"
            style={{ color: "var(--w3)" }}>
            <XIcon size={14} strokeWidth={1.8} />
          </button>
        </div>

        {/* Note */}
        {!signedUrl && request.note && (
          <div className="flex-shrink-0 px-4 pt-3">
            <p className="text-[12.5px] px-3 py-2 rounded-xl" style={{ background: "var(--bg2)", color: "var(--w3)", border: "1px solid var(--border)" }}>
              <span style={{ color: G.accent, fontWeight: 600 }}>{t.note} </span>
              {request.note}
            </p>
          </div>
        )}

        {/* Body */}
        {signedUrl ? (
          <div className="overflow-y-auto flex-1 p-4 text-center space-y-3 py-8">
            <CheckCircle2 size={44} strokeWidth={1.5} className="mx-auto" style={{ color: "var(--success)" }} />
            <p className="text-[14px] font-semibold" style={{ color: "var(--w)" }}>{t.signed}</p>
            <a href={signedUrl} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[13px] font-semibold transition-opacity hover:opacity-80"
              style={{ background: "var(--success-bg)", color: "var(--success)", border: "1px solid var(--success-border)" }}>
              <Download size={14} strokeWidth={2} />{t.download}
            </a>
            <button onClick={onClose} className="block w-full py-2 text-[13px] font-medium transition-opacity hover:opacity-70" style={{ color: "var(--w3)" }}>
              {t.close}
            </button>
          </div>
        ) : (
          <>
            {/* PDF viewer */}
            <div className="flex-shrink-0 px-4 pt-3 pb-0" style={{ height: "55dvh" }}>
              <div style={{ height: "100%", borderRadius: 12, overflow: "hidden", border: "1px solid var(--border)" }} onWheel={e => e.stopPropagation()}>
                {request.pdf_preview_url ? (
                  <PdfViewer
                    src={request.pdf_preview_url}
                    hideRotate
                    pageOverlay={({ pageNum }) => {
                      const pageZones = localZones
                        .map((zone, idx) => ({ zone, idx }))
                        .filter(({ zone }) => zone.page === pageNum);
                      return (
                        <div
                          ref={el => { if (el) pageElsRef.current.set(pageNum, el); else pageElsRef.current.delete(pageNum); }}
                          style={{ position: "absolute", inset: 0 }}
                          onClick={() => { if (cropZoneIdx !== null) applyCrop(); else setActiveZoneIdx(null); }}
                        >
                          {pageZones.map(({ zone, idx: zi }) => {
                            const isActive   = activeZoneIdx === zi;
                            const inCropMode = cropZoneIdx === zi;
                            const pageEl = pageElsRef.current.get(pageNum);
                            const pxW = pageEl ? zone.w * pageEl.offsetWidth  : 200;
                            const pxH = pageEl ? zone.h * pageEl.offsetHeight : 80;
                            const sc  = Math.max(0.28, Math.min(1, pxW / 160, pxH / 52));

                            function makeCropDragDown(hId: string) {
                              return (e: React.MouseEvent) => {
                                if (e.button !== 0) return;
                                e.preventDefault(); e.stopPropagation();
                                const el = pageElsRef.current.get(pageNum); if (!el) return;
                                const rect = el.getBoundingClientRect();
                                const startX = e.clientX, startY = e.clientY;
                                const si = { ...cropInsetsRef.current };
                                const pw = rect.width * zone.w, ph = rect.height * zone.h;
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

                            const { t: ct, r: cr, b: cb, l: cl } = cropInsets;
                            const tp = `${ct*100}%`, bp = `${cb*100}%`, lp = `${cl*100}%`, rp = `${cr*100}%`;
                            const t1 = `${(1-cb)*100}%`, l1 = `${(1-cr)*100}%`;

                            return (
                              <div
                                key={zi}
                                ref={inCropMode ? (el => { cropZoneElRef.current = el; }) : undefined}
                                style={{
                                  position: "absolute",
                                  left:   `${zone.x * 100}%`,
                                  top:    `${zone.y * 100}%`,
                                  width:  `${zone.w * 100}%`,
                                  height: `${zone.h * 100}%`,
                                  border: inCropMode
                                    ? `2px solid rgba(255,255,255,0.9)`
                                    : `1.5px solid ${isActive ? "rgba(201,162,64,0.6)" : "rgba(201,162,64,0.35)"}`,
                                  background: "rgba(201,162,64,0.07)",
                                  borderRadius: 5,
                                  cursor: inCropMode ? "default" : "move",
                                  boxSizing: "border-box",
                                  display: "flex",
                                  flexDirection: "column",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  gap: 2,
                                  zIndex: isActive ? 2 : 1,
                                  boxShadow: inCropMode
                                    ? "0 0 0 1px rgba(0,0,0,0.5), 0 6px 28px rgba(0,0,0,0.45)"
                                    : isActive
                                      ? "0 0 0 1px rgba(201,162,64,0.35), 0 2px 12px rgba(0,0,0,0.15)"
                                      : "none",
                                  transition: "box-shadow 0.15s, border-color 0.15s",
                                }}
                                onMouseDown={e => {
                                  if (e.button !== 0) return;
                                  e.preventDefault(); e.stopPropagation();
                                  if (inCropMode) return;
                                  setActiveZoneIdx(zi);
                                  const el = pageElsRef.current.get(pageNum); if (!el) return;
                                  const rect = el.getBoundingClientRect();
                                  zoneDragRef.current = { mode: "move", idx: zi, startClientX: e.clientX, startClientY: e.clientY, startCx: rect.left + (zone.x + zone.w / 2) * rect.width, startCy: rect.top + (zone.y + zone.h / 2) * rect.height, startZone: { ...zone } };
                                }}
                                onClick={e => e.stopPropagation()}
                                onDoubleClick={e => {
                                  if (!sigPlaced || !sigData || bgRemoving) return;
                                  e.stopPropagation();
                                  if (inCropMode) {
                                    applyCrop();
                                  } else {
                                    setCropZoneIdx(zi);
                                    updateCropInsets({ t: 0, r: 0, b: 0, l: 0 });
                                    setActiveZoneIdx(zi);
                                  }
                                }}
                              >
                                {/* Centre content */}
                                <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, overflow: "hidden" }}>
                                  {sigPlaced && sigData ? (
                                    <>
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img
                                        ref={inCropMode ? (el => { cropImgRef.current = el; }) : undefined}
                                        src={sigData} alt="signature"
                                        style={{
                                          width: "100%", height: "100%",
                                          objectFit: "contain",
                                          pointerEvents: "none", userSelect: "none",
                                          filter: bgRemoving ? "brightness(1.08) contrast(0.9)" : undefined,
                                          clipPath: inCropMode
                                            ? `inset(${cropInsets.t*100}% ${cropInsets.r*100}% ${cropInsets.b*100}% ${cropInsets.l*100}%)`
                                            : undefined,
                                          transition: inCropMode ? "none" : "clip-path 0.05s",
                                        }}
                                      />
                                      {bgRemoving && (
                                        <div style={{ position: "absolute", inset: 0, overflow: "hidden", borderRadius: 3, pointerEvents: "none" }}>
                                          <div style={{ position: "absolute", left: 0, right: 0, height: "35%", background: "linear-gradient(to bottom, transparent 0%, rgba(120,200,255,0.55) 45%, rgba(80,180,255,0.75) 50%, rgba(120,200,255,0.55) 55%, transparent 100%)", animation: "bvScan 1.1s ease-in-out infinite alternate", boxShadow: "0 0 12px 4px rgba(80,180,255,0.4)" }} />
                                          <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 30% 60%, rgba(255,255,255,0.18) 0%, transparent 60%), radial-gradient(circle at 70% 30%, rgba(255,255,255,0.14) 0%, transparent 50%)", animation: "bvSparkle 0.8s ease-in-out infinite alternate" }} />
                                        </div>
                                      )}
                                    </>
                                  ) : (
                                    <span style={{ fontSize: 11, color: "var(--gold)", fontWeight: 800, textShadow: "0 1px 4px rgba(0,0,0,0.7)", pointerEvents: "none", userSelect: "none", letterSpacing: "0.03em", whiteSpace: "nowrap" }}>
                                      ✍ {t.dropHere}
                                    </span>
                                  )}
                                </div>

                                {/* × button to clear sig — same style as PdfZonePicker's × */}
                                {sigPlaced && sigData && !bgRemoving && !inCropMode && (
                                  <div style={{ position: "absolute", top: -1, left: -1, display: "flex", alignItems: "stretch", zIndex: 5, boxShadow: "0 1px 6px rgba(0,0,0,0.35)", borderRadius: "4px 4px 5px 0" }}>
                                    <button
                                      style={{
                                        padding: `${Math.max(1, Math.round(2 * sc))}px ${Math.max(3, Math.round(5 * sc))}px`,
                                        borderRadius: "4px",
                                        background: "rgba(15,15,15,0.75)",
                                        backdropFilter: "blur(4px)",
                                        color: "rgba(255,255,255,0.85)", border: "none", cursor: "pointer",
                                        display: "flex", alignItems: "center", justifyContent: "center",
                                        fontSize: Math.max(7, Math.round(9 * sc)), fontWeight: 700, lineHeight: 1,
                                      }}
                                      onMouseDown={e => e.stopPropagation()}
                                      onClick={e => { e.stopPropagation(); clearSig(); }}
                                    >
                                      ✕
                                    </button>
                                  </div>
                                )}

                                {/* Inline crop mode — exact copy from PdfZonePicker */}
                                {inCropMode && (
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
                                    {/* Corner handle dots at crop frame corners */}
                                    {([["nw",tp,lp],["ne",tp,l1],["sw",t1,lp],["se",t1,l1]] as [string,string,string][]).map(([id,cy,cx]) => (
                                      <div key={`cv-${id}`} style={{ position:"absolute", top:cy, left:cx, transform:"translate(-50%,-50%)", width:16, height:16, background:"#fff", border:"2.5px solid rgba(0,0,0,0.45)", borderRadius:"50%", boxShadow:"0 2px 8px rgba(0,0,0,0.5)", pointerEvents:"none", zIndex:4 }} />
                                    ))}
                                    {/* Transparent drag strips */}
                                    <div style={{ position:"absolute", top:tp, left:lp, right:rp, height:24, transform:"translateY(-50%)", cursor:"n-resize", zIndex:5 }} onMouseDown={makeCropDragDown("n")} />
                                    <div style={{ position:"absolute", bottom:bp, left:lp, right:rp, height:24, transform:"translateY(50%)", cursor:"s-resize", zIndex:5 }} onMouseDown={makeCropDragDown("s")} />
                                    <div style={{ position:"absolute", top:tp, bottom:bp, left:lp, width:24, transform:"translateX(-50%)", cursor:"w-resize", zIndex:5 }} onMouseDown={makeCropDragDown("w")} />
                                    <div style={{ position:"absolute", top:tp, bottom:bp, right:rp, width:24, transform:"translateX(50%)", cursor:"e-resize", zIndex:5 }} onMouseDown={makeCropDragDown("e")} />
                                    <div style={{ position:"absolute", top:tp, left:lp, transform:"translate(-50%,-50%)", width:28, height:28, cursor:"nw-resize", zIndex:6 }} onMouseDown={makeCropDragDown("nw")} />
                                    <div style={{ position:"absolute", top:tp, left:l1, transform:"translate(-50%,-50%)", width:28, height:28, cursor:"ne-resize", zIndex:6 }} onMouseDown={makeCropDragDown("ne")} />
                                    <div style={{ position:"absolute", top:t1, left:lp, transform:"translate(-50%,-50%)", width:28, height:28, cursor:"sw-resize", zIndex:6 }} onMouseDown={makeCropDragDown("sw")} />
                                    <div style={{ position:"absolute", top:t1, left:l1, transform:"translate(-50%,-50%)", width:28, height:28, cursor:"se-resize", zIndex:6 }} onMouseDown={makeCropDragDown("se")} />
                                  </>
                                )}

                                {/* Resize handles — active only, not in crop mode */}
                                {isActive && !inCropMode && HANDLES.map(h => (
                                  <div
                                    key={h.id}
                                    style={{
                                      position: "absolute",
                                      top: h.top, left: h.left,
                                      transform: "translate(-50%, -50%)",
                                      width: Math.max(7, Math.round(16 * sc)), height: Math.max(7, Math.round(16 * sc)),
                                      background: "#fff",
                                      border: `${Math.max(1.5, 3 * sc)}px solid var(--gold)`,
                                      borderRadius: "50%",
                                      cursor: h.cursor,
                                      zIndex: 4,
                                      boxShadow: `0 2px 8px rgba(0,0,0,0.5), 0 0 0 ${Math.max(0.8, 1.5 * sc)}px var(--gold)`,
                                    }}
                                    onMouseDown={e => {
                                      if (e.button !== 0) return;
                                      e.preventDefault(); e.stopPropagation();
                                      const el = pageElsRef.current.get(pageNum); if (!el) return;
                                      const rect = el.getBoundingClientRect();
                                      zoneDragRef.current = { mode: "resize", idx: zi, handle: h.id, startClientX: e.clientX, startClientY: e.clientY, startZone: { ...zone }, pageW: rect.width, pageH: rect.height };
                                    }}
                                  />
                                ))}
                              </div>
                            );
                          })}
                        </div>
                      );
                    }}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-[12.5px]" style={{ color: "var(--w3)" }}>{t.noPreview}</div>
                )}
              </div>
            </div>

            {/* Signature section */}
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3" style={{ borderTop: "1px solid var(--border)" }}>
              <input ref={uploadRef} type="file" accept="image/*" style={{ display: "none" }}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFileRead(f); e.target.value = ""; }} />

              <div className="rounded-2xl p-4 space-y-3" style={{ background: G.bg, border: `1.5px solid ${G.border}` }}>
                <p className="text-[11.5px] font-semibold" style={{ color: G.accent }}>
                  ✍ {lang === "fr" ? "Votre signature" : lang === "de" ? "Ihre Unterschrift" : "Your signature"}
                </p>

                {bgRemoving && (
                  <p className="text-[11px] text-center py-1" style={{ color: "var(--w3)" }}>{t.removingBg}</p>
                )}

                {!sigData && !bgRemoving && (
                  <>
                    {savedSig && (
                      <button type="button"
                        onClick={() => { setSigData(savedSig); setUsingSaved(true); setSigPlaced(true); }}
                        className="w-full py-2 text-[12px] font-semibold rounded-xl transition-opacity hover:opacity-80"
                        style={{ background: G.bgHover, color: G.accent, border: `1.5px solid ${G.border}` }}>
                        ✓ {t.useSaved}
                      </button>
                    )}
                    <div
                      onClick={() => uploadRef.current?.click()}
                      onDragOver={e => { e.preventDefault(); setDropDragOver(true); }}
                      onDragLeave={() => setDropDragOver(false)}
                      onDrop={e => {
                        e.preventDefault(); setDropDragOver(false);
                        const file = e.dataTransfer.files[0];
                        if (file?.type.startsWith("image/")) handleFileRead(file);
                      }}
                      className="rounded-xl flex flex-col items-center justify-center gap-2 cursor-pointer transition-all"
                      style={{ minHeight: 110, border: `2px dashed ${dropDragOver ? G.accent : G.border}`, background: dropDragOver ? G.bg : "#fff" }}
                    >
                      <Upload size={20} strokeWidth={1.5} style={{ color: G.accent, opacity: 0.7 }} />
                      <p className="text-[12px] text-center px-4" style={{ color: "var(--w3)" }}>
                        {lang === "fr" ? "Déposez une photo ou cliquez pour importer" : lang === "de" ? "Unterschrift ablegen oder klicken" : "Drop signature photo or click to upload"}
                      </p>
                    </div>
                  </>
                )}

                {sigData && !bgRemoving && (
                  <div className="flex items-center gap-2 flex-wrap">
                    {savedSig && sigData !== savedSig && (
                      <button type="button"
                        onClick={() => { setSigData(savedSig); setUsingSaved(true); setSigPlaced(true); }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-opacity hover:opacity-80"
                        style={{ background: G.bg, color: G.accent, border: `1px solid ${G.border}` }}>
                        {t.useSaved}
                      </button>
                    )}
                    <button type="button" onClick={() => uploadRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-opacity hover:opacity-80"
                      style={{ background: G.bg, color: G.accent, border: `1px solid ${G.border}` }}>
                      <Upload size={11} strokeWidth={2} />{t.replace}
                    </button>
                    <button type="button" onClick={clearSig}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-opacity hover:opacity-80"
                      style={{ background: G.bg, color: G.accent, border: `1px solid ${G.border}` }}>
                      ✕ {t.clear}
                    </button>
                  </div>
                )}

                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input type="checkbox" checked={wantSave} onChange={e => setWantSave(e.target.checked)}
                    className="rounded" style={{ accentColor: G.accent }} />
                  <span className="text-[11px]" style={{ color: "var(--w3)" }}>
                    {savingSig ? t.saving : t.saveForNext}
                  </span>
                </label>
              </div>

              {err && <p className="text-[12px] mt-2" style={{ color: "var(--error, #e03030)" }}>{err}</p>}
            </div>
          </>
        )}

        {/* Footer */}
        {!signedUrl && (
          <div className="flex-shrink-0 px-4 py-3 flex gap-2" style={{ borderTop: "1px solid var(--border)" }}>
            <button onClick={handleConfirm} disabled={signing || !sigData || bgRemoving}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-[13.5px] font-semibold transition-all disabled:opacity-50 hover:opacity-90 active:scale-[0.98]"
              style={{ background: "var(--gold)", color: "#131312" }}>
              {signing ? <><Spinner size="xs" color="#131312" />{t.signing}</> : <><FilePen size={14} strokeWidth={2} />{t.confirm}</>}
            </button>
            <button onClick={onClose} disabled={signing}
              className="px-4 py-3 rounded-xl text-[13px] font-medium transition-opacity hover:opacity-70 disabled:opacity-40"
              style={{ background: "var(--bg2)", color: "var(--w3)", border: "1px solid var(--border)" }}>
              <XIcon size={14} strokeWidth={2} />
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );

  return modal;
}
