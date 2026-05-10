"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { FilePen, CheckCircle2, X as XIcon, Download, Save, Upload } from "lucide-react";
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
    drawHint: "Draw your signature below", noSig: "Please add your signature first",
    useSaved: "Use saved", drawNew: "Draw new", saveForNext: "Save for next time",
    saving: "Saving…", download: "Download signed copy", signed: "Signed",
    clear: "Clear", dropHere: "Drop or click to sign",
    note: "Note:",
    noPreview: "No PDF preview available",
    uploadImg: "Upload image", cropImg: "Crop",
    replace: "Replace", removingBg: "Removing background…",
    dropUpload: "Drop signature photo or click to upload",
  },
  fr: {
    close: "Fermer", confirm: "Confirmer & signer", signing: "Signature…",
    drawHint: "Dessinez votre signature ci-dessous", noSig: "Veuillez d'abord signer",
    useSaved: "Utiliser la sauvegardée", drawNew: "Dessiner", saveForNext: "Enregistrer pour la prochaine fois",
    saving: "Enregistrement…", download: "Télécharger la copie signée", signed: "Signé",
    clear: "Effacer", dropHere: "Déposez ou cliquez pour signer",
    note: "Note :",
    noPreview: "Aperçu PDF indisponible",
    uploadImg: "Importer image", cropImg: "Recadrer",
    replace: "Remplacer", removingBg: "Suppression du fond…",
    dropUpload: "Déposez une photo ou cliquez pour importer",
  },
  de: {
    close: "Schließen", confirm: "Bestätigen & unterschreiben", signing: "Wird unterschrieben…",
    drawHint: "Zeichnen Sie Ihre Unterschrift", noSig: "Bitte zuerst unterschreiben",
    useSaved: "Gespeicherte verwenden", drawNew: "Neu zeichnen", saveForNext: "Für nächstes Mal speichern",
    saving: "Speichern…", download: "Unterschriebene Kopie herunterladen", signed: "Unterschrieben",
    clear: "Löschen", dropHere: "Ablegen oder klicken zum Unterschreiben",
    note: "Hinweis:",
    noPreview: "PDF-Vorschau nicht verfügbar",
    uploadImg: "Bild hochladen", cropImg: "Zuschneiden",
    replace: "Ersetzen", removingBg: "Hintergrund wird entfernt…",
    dropUpload: "Unterschrift ablegen oder klicken",
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

// Gold palette — mirrors admin blue palette
const G = {
  accent: "var(--gold)",
  bg: "rgba(201,162,64,0.06)",
  border: "var(--border-gold)",
  bgHover: "rgba(201,162,64,0.14)",
};

export function PdfSignModal({ request, lang, authToken, onSigned, onClose }: Props) {
  const t = T[lang] ?? T.en;

  const [savedSig, setSavedSig]     = useState<string | null>(null);
  const [sigData, setSigData]       = useState<string | null>(null);
  const [usingSaved, setUsingSaved] = useState(false);
  const [wantSave, setWantSave]     = useState(true);
  const [savingSig, setSavingSig]   = useState(false);
  const [bgRemoving, setBgRemoving] = useState(false);
  const [dropDragOver, setDropDragOver] = useState(false);
  const [cropMode, setCropMode]     = useState(false);
  const [cropDrag, setCropDrag]     = useState<{ sx: number; sy: number; ex: number; ey: number } | null>(null);
  const [cropDragging, setCropDragging] = useState(false);
  const cropImgRef      = useRef<HTMLImageElement>(null);
  const cropContainerRef = useRef<HTMLDivElement>(null);
  const uploadRef       = useRef<HTMLInputElement>(null);

  const [dragOverZone, setDragOverZone] = useState(false);
  const [sigPlaced, setSigPlaced]       = useState(false);
  const [signing, setSigning]           = useState(false);
  const [err, setErr]                   = useState("");
  const [signedUrl, setSignedUrl]       = useState<string | null>(null);

  const candidateZones: SigZone[] = (() => {
    const raw = request.signature_zone;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.filter(z => !z.party || z.party === "candidate");
    if (!raw.party || raw.party === "candidate") return [raw];
    return [];
  })();

  useEffect(() => {
    if (!authToken) return;
    fetch("/api/portal/me/signature", { headers: { Authorization: `Bearer ${authToken}` } })
      .then(r => r.ok ? r.json() : { signature: null })
      .then((j: { signature?: string | null }) => {
        if (j.signature) { setSavedSig(j.signature); setSigData(j.signature); setUsingSaved(true); setSigPlaced(true); }
      })
      .catch(() => {});
  }, [authToken]);

  function applyBgRemoval(dataUri: string) {
    setBgRemoving(true);
    setUsingSaved(false);
    Promise.all([removeImageBg(dataUri), new Promise(r => setTimeout(r, 2200))])
      .then(([clean]) => { setSigData(clean as string); setSigPlaced(true); setBgRemoving(false); });
  }

  function handleFileRead(file: File) {
    const reader = new FileReader();
    reader.onload = () => applyBgRemoval(reader.result as string);
    reader.readAsDataURL(file);
  }

  function applyCrop() {
    if (!cropDrag || !cropImgRef.current || !cropContainerRef.current || !sigData) return;
    const cw = cropContainerRef.current.offsetWidth;
    const ch = cropContainerRef.current.offsetHeight;
    const img = cropImgRef.current;
    const scaleX = img.naturalWidth / cw, scaleY = img.naturalHeight / ch;
    const x = Math.max(0, Math.round(Math.min(cropDrag.sx, cropDrag.ex) * scaleX));
    const y = Math.max(0, Math.round(Math.min(cropDrag.sy, cropDrag.ey) * scaleY));
    const w = Math.min(img.naturalWidth - x, Math.round(Math.abs(cropDrag.ex - cropDrag.sx) * scaleX));
    const h = Math.min(img.naturalHeight - y, Math.round(Math.abs(cropDrag.ey - cropDrag.sy) * scaleY));
    if (w < 5 || h < 5) return;
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
    setSigData(canvas.toDataURL("image/png"));
    setCropMode(false); setCropDrag(null);
  }

  async function handleConfirm() {
    if (signing) return;
    if (!sigData) { setErr(t.noSig); return; }
    setErr(""); setSigning(true);
    try {
      const res = await fetch(`/api/portal/me/sign-requests/${request.id}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ signatureBase64: sigData }),
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
        @keyframes bvSigPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(201,162,64,0.55), 0 0 18px 2px rgba(201,162,64,0.35); background: rgba(201,162,64,0.18) !important; }
          50%       { box-shadow: 0 0 0 8px rgba(201,162,64,0), 0 0 26px 6px rgba(201,162,64,0.55); background: rgba(201,162,64,0.32) !important; }
        }
        .bv-sig-zone-pulse { animation: bvSigPulse 1.6s ease-in-out infinite; }
      `}</style>

      <div
        className="bv-sign-modal-card w-full max-w-4xl rounded-2xl overflow-hidden flex flex-col"
        style={{ background: "var(--card)", border: "1px solid var(--border)", boxShadow: "var(--shadow-lg)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
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

        {/* ── Note ── */}
        {!signedUrl && request.note && (
          <div className="flex-shrink-0 px-4 pt-3">
            <p className="text-[12.5px] px-3 py-2 rounded-xl" style={{ background: "var(--bg2)", color: "var(--w3)", border: "1px solid var(--border)" }}>
              <span style={{ color: G.accent, fontWeight: 600 }}>{t.note} </span>
              {request.note}
            </p>
          </div>
        )}

        {/* ── Body ── */}
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
            {/* PDF viewer — fixed height so sig section always visible below */}
            <div className="flex-shrink-0 px-4 pt-3 pb-0" style={{ height: "55dvh" }}>
              <div style={{ height: "100%", borderRadius: 12, overflow: "hidden", border: "1px solid var(--border)" }} onWheel={e => e.stopPropagation()}>
                {request.pdf_preview_url ? (
                  <PdfViewer
                    src={request.pdf_preview_url}
                    hideRotate
                    pageOverlay={({ pageNum }) => {
                      const pageZones = candidateZones.filter(z => z.page === pageNum);
                      if (!pageZones.length) return null;
                      return (
                        <>
                          {pageZones.map((zone, zi) => (
                            <div key={zi}
                              className={!sigPlaced && !dragOverZone ? "bv-sig-zone-pulse" : ""}
                              style={{
                                position: "absolute",
                                left: `${zone.x * 100}%`, top: `${zone.y * 100}%`,
                                width: `${zone.w * 100}%`, height: `${zone.h * 100}%`,
                                border: `2.5px ${dragOverZone ? "solid" : "dashed"} ${G.accent}`,
                                background: dragOverZone ? G.bgHover : sigPlaced ? G.bg : "rgba(201,162,64,0.14)",
                                borderRadius: 6, cursor: "pointer", overflow: "hidden",
                                transition: "background 0.15s, border 0.15s",
                                display: "flex", alignItems: "center", justifyContent: "center",
                              }}
                              onDragOver={e => { e.preventDefault(); setDragOverZone(true); }}
                              onDragLeave={() => setDragOverZone(false)}
                              onDrop={e => {
                                e.preventDefault(); setDragOverZone(false);
                                if (e.dataTransfer.getData("bv-sig") === "saved" && savedSig) { setSigData(savedSig); setUsingSaved(true); setSigPlaced(true); }
                              }}
                              onClick={() => { if (savedSig && !sigPlaced) { setSigData(savedSig); setUsingSaved(true); setSigPlaced(true); } }}
                            >
                              {sigPlaced && sigData ? (
                                <>
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={sigData} alt="signature" style={{ width: "90%", height: "90%", objectFit: "contain" }} />
                                  {zi === 0 && (
                                    <button onClick={e => { e.stopPropagation(); clearSig(); }}
                                      className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full flex items-center justify-center"
                                      style={{ background: "rgba(0,0,0,0.5)" }}>
                                      <XIcon size={8} strokeWidth={2.5} style={{ color: "#fff" }} />
                                    </button>
                                  )}
                                </>
                              ) : (
                                <span style={{ fontSize: 11, color: G.accent, fontWeight: 700, textShadow: "0 1px 3px rgba(0,0,0,0.6)", pointerEvents: "none" }}>
                                  ✍ {t.dropHere}
                                </span>
                              )}
                            </div>
                          ))}
                        </>
                      );
                    }}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-[12.5px]" style={{ color: "var(--w3)" }}>{t.noPreview}</div>
                )}
              </div>
            </div>

            {/* ── Signature section — flex-1 fills remaining space, scrolls if needed ── */}
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3" style={{ borderTop: "1px solid var(--border)" }}>
              {/* hidden file input */}
              <input ref={uploadRef} type="file" accept="image/*" style={{ display: "none" }}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFileRead(f); e.target.value = ""; }} />

              <div className="rounded-2xl p-4 space-y-3" style={{ background: G.bg, border: `1.5px solid ${G.border}` }}>
                <p className="text-[11.5px] font-semibold" style={{ color: G.accent }}>
                  ✍ {lang === "fr" ? "Votre signature" : lang === "de" ? "Ihre Unterschrift" : "Your signature"}
                </p>

                {/* ── No sig: draw pad + upload dropzone ── */}
                {!sigData && (
                  <>
                    {savedSig && (
                      <button type="button"
                        onClick={() => { setSigData(savedSig); setUsingSaved(true); setSigPlaced(true); }}
                        className="w-full py-2 text-[12px] font-semibold rounded-xl transition-opacity hover:opacity-80"
                        style={{ background: G.bgHover, color: G.accent, border: `1.5px solid ${G.border}` }}>
                        ✓ {t.useSaved}
                      </button>
                    )}

                    {/* Upload dropzone — spinner inside when removing bg (matches admin) */}
                    <div
                      onClick={() => { if (!bgRemoving) uploadRef.current?.click(); }}
                      onDragOver={e => { e.preventDefault(); setDropDragOver(true); }}
                      onDragLeave={() => setDropDragOver(false)}
                      onDrop={e => {
                        e.preventDefault(); setDropDragOver(false);
                        const file = e.dataTransfer.files[0];
                        if (file?.type.startsWith("image/")) handleFileRead(file);
                      }}
                      className="rounded-xl flex flex-col items-center justify-center gap-2 cursor-pointer transition-all"
                      style={{
                        minHeight: 88,
                        border: `2px dashed ${dropDragOver ? G.accent : G.border}`,
                        background: dropDragOver ? G.bgHover : bgRemoving ? G.bg : "#fff",
                      }}
                    >
                      {bgRemoving ? (
                        <span className="w-5 h-5 rounded-full border-2 border-current border-t-transparent animate-spin" style={{ color: G.accent }} />
                      ) : (
                        <>
                          <Upload size={20} strokeWidth={1.5} style={{ color: G.accent, opacity: 0.7 }} />
                          <p className="text-[12px] text-center px-4" style={{ color: "var(--w3)" }}>{t.dropUpload}</p>
                        </>
                      )}
                    </div>
                  </>
                )}

                {/* ── Sig exists: preview + action buttons (matches admin Replace/Clear layout) ── */}
                {sigData && !bgRemoving && (
                  <>
                    <div className="rounded-xl overflow-hidden flex items-center justify-center"
                      style={{ background: "#fff", minHeight: 80, border: "1px solid var(--border)" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={sigData} alt="signature" style={{ maxWidth: "100%", maxHeight: 90, objectFit: "contain" }} />
                    </div>
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
                      <button type="button" onClick={() => { setCropMode(true); setCropDrag(null); }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-opacity hover:opacity-80"
                        style={{ background: G.bg, color: G.accent, border: `1px solid ${G.border}` }}>
                        ✂ {t.cropImg}
                      </button>
                      <button type="button" onClick={clearSig}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-opacity hover:opacity-80"
                        style={{ background: G.bg, color: G.accent, border: `1px solid ${G.border}` }}>
                        ✕ {t.clear}
                      </button>
                    </div>
                  </>
                )}

                {/* Save for next time */}
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input type="checkbox" checked={wantSave} onChange={e => setWantSave(e.target.checked)}
                    className="rounded" style={{ accentColor: G.accent }} />
                  <span className="text-[11px]" style={{ color: "var(--w3)" }}>
                    {savingSig ? t.saving : t.saveForNext}
                  </span>
                  <Save size={11} strokeWidth={2} style={{ color: "var(--w3)" }} />
                </label>
              </div>

              {err && <p className="text-[12px] mt-2" style={{ color: "var(--error, #e03030)" }}>{err}</p>}
            </div>
          </>
        )}

        {/* ── Footer ── */}
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

  function CropPortal() {
    if (!cropMode || !sigData) return null;
    return createPortal(
      <div className="fixed inset-0 z-[2000] flex flex-col items-center justify-center gap-4"
        style={{ background: "rgba(0,0,0,0.92)" }}
        onClick={e => { if (e.target === e.currentTarget) { setCropMode(false); setCropDrag(null); } }}>
        <p className="text-[12px] font-semibold select-none" style={{ color: "rgba(255,255,255,0.6)" }}>
          {lang === "fr" ? "Faites glisser pour sélectionner" : lang === "de" ? "Bereich ziehen zum Zuschneiden" : "Drag to select crop area"}
        </p>
        <div ref={cropContainerRef} className="relative select-none"
          style={{ cursor: "crosshair", background: "#fff" }}
          onMouseDown={e => {
            const r = cropContainerRef.current!.getBoundingClientRect();
            const sx = e.clientX - r.left, sy = e.clientY - r.top;
            setCropDrag({ sx, sy, ex: sx, ey: sy }); setCropDragging(true);
          }}
          onMouseMove={e => {
            if (!cropDragging) return;
            const r = cropContainerRef.current!.getBoundingClientRect();
            setCropDrag(d => d ? { ...d, ex: e.clientX - r.left, ey: e.clientY - r.top } : null);
          }}
          onMouseUp={() => setCropDragging(false)}
          onMouseLeave={() => setCropDragging(false)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img ref={cropImgRef} src={sigData} alt="crop" draggable={false}
            style={{ display: "block", maxWidth: "80vw", maxHeight: "65vh", userSelect: "none", pointerEvents: "none" }} />
          {cropDrag && (
            <div style={{
              position: "absolute",
              left: Math.min(cropDrag.sx, cropDrag.ex), top: Math.min(cropDrag.sy, cropDrag.ey),
              width: Math.abs(cropDrag.ex - cropDrag.sx), height: Math.abs(cropDrag.ey - cropDrag.sy),
              border: "2px solid #fff", background: "rgba(255,255,255,0.08)",
              boxShadow: "0 0 0 9999px rgba(0,0,0,0.5)", pointerEvents: "none",
            }} />
          )}
        </div>
        <div className="flex gap-3">
          <button onClick={applyCrop}
            disabled={!cropDrag || Math.abs(cropDrag.ex - cropDrag.sx) < 5 || Math.abs(cropDrag.ey - cropDrag.sy) < 5}
            className="px-6 py-2 rounded-full text-[12.5px] font-semibold disabled:opacity-40 transition-opacity hover:opacity-80"
            style={{ background: "var(--gold)", color: "#131312" }}>
            {lang === "fr" ? "Appliquer" : lang === "de" ? "Zuschneiden" : "Apply crop"}
          </button>
          <button onClick={() => { setCropMode(false); setCropDrag(null); }}
            className="px-6 py-2 rounded-full text-[12.5px] font-semibold transition-opacity hover:opacity-80"
            style={{ background: "rgba(255,255,255,0.12)", color: "#fff" }}>
            {lang === "fr" ? "Annuler" : lang === "de" ? "Abbrechen" : "Cancel"}
          </button>
        </div>
      </div>,
      document.body,
    );
  }

  return <>{modal}<CropPortal /></>;
}
