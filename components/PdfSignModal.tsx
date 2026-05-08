"use client";

import { useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  FilePen, CheckCircle2, X as XIcon, Download, Save,
  ChevronLeft, ChevronRight, RotateCcw,
} from "lucide-react";
import { SignaturePad } from "@/components/SignaturePad";
import { Spinner } from "@/components/ui/states";
import type { SigZone } from "@/components/PdfZonePicker";

export type SignRequestFull = {
  id: string;
  document_name: string;
  note: string | null;
  status: "pending" | "signed" | "declined";
  signed_at: string | null;
  created_at: string;
  signature_zone: SigZone | null;
  pdf_preview_url: string | null;
};

const T = {
  en: {
    close: "Close", confirm: "Confirm & sign", signing: "Signing…",
    drawHint: "Draw your signature below", noSig: "Please add your signature first",
    useSaved: "Use saved", drawNew: "Draw new", saveForNext: "Save for next time",
    saving: "Saving…", download: "Download signed copy", signed: "Signed",
    clear: "Clear", dropHere: "Drop or click to sign",
    dragHint: "Drag your signature onto the zone above, or draw below",
    note: "Note:",
  },
  fr: {
    close: "Fermer", confirm: "Confirmer & signer", signing: "Signature…",
    drawHint: "Dessinez votre signature ci-dessous", noSig: "Veuillez d'abord signer",
    useSaved: "Utiliser la sauvegardée", drawNew: "Dessiner", saveForNext: "Enregistrer pour la prochaine fois",
    saving: "Enregistrement…", download: "Télécharger la copie signée", signed: "Signé",
    clear: "Effacer", dropHere: "Déposez ou cliquez pour signer",
    dragHint: "Glissez votre signature sur la zone ou dessinez ci-dessous",
    note: "Note :",
  },
  de: {
    close: "Schließen", confirm: "Bestätigen & unterschreiben", signing: "Wird unterschrieben…",
    drawHint: "Zeichnen Sie Ihre Unterschrift", noSig: "Bitte zuerst unterschreiben",
    useSaved: "Gespeicherte verwenden", drawNew: "Neu zeichnen", saveForNext: "Für nächstes Mal speichern",
    saving: "Speichern…", download: "Unterschriebene Kopie herunterladen", signed: "Unterschrieben",
    clear: "Löschen", dropHere: "Ablegen oder klicken zum Unterschreiben",
    dragHint: "Unterschrift auf Zone ziehen oder unten zeichnen",
    note: "Hinweis:",
  },
} as const;
type Lang = keyof typeof T;

let _pdfjs: typeof import("pdfjs-dist") | null = null;
async function getPdfJs() {
  if (_pdfjs) return _pdfjs;
  const lib = await import("pdfjs-dist");
  lib.GlobalWorkerOptions.workerSrc =
    `https://unpkg.com/pdfjs-dist@${lib.version}/build/pdf.worker.min.mjs`;
  _pdfjs = lib;
  return lib;
}

type Props = {
  request: SignRequestFull;
  lang: Lang;
  authToken: string;
  onSigned: (id: string) => void;
  onClose: () => void;
};

export function PdfSignModal({ request, lang, authToken, onSigned, onClose }: Props) {
  const t = T[lang] ?? T.en;

  // PDF rendering
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdfDoc, setPdfDoc]       = useState<import("pdfjs-dist").PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(1);
  const [page, setPage]           = useState(1);
  const [pdfLoading, setPdfLoading] = useState(true);

  // Signature state
  const [savedSig, setSavedSig]     = useState<string | null>(null);
  const [sigData, setSigData]       = useState<string | null>(null);
  const [usingSaved, setUsingSaved] = useState(false);
  const [wantSave, setWantSave]     = useState(true);   // pre-checked
  const [savingSig, setSavingSig]   = useState(false);

  // Flow state
  const [dragOverZone, setDragOverZone] = useState(false);
  const [sigPlaced, setSigPlaced]       = useState(false); // sig dropped/placed in zone
  const [signing, setSigning]           = useState(false);
  const [err, setErr]                   = useState("");
  const [signedUrl, setSignedUrl]       = useState<string | null>(null);

  const zone = request.signature_zone;
  const targetPage = zone?.page ?? 1;

  // Load saved signature
  useEffect(() => {
    if (!authToken) return;
    fetch("/api/portal/me/signature", {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(r => r.ok ? r.json() : { signature: null })
      .then((j: { signature?: string | null }) => {
        if (j.signature) {
          setSavedSig(j.signature);
          setSigData(j.signature);
          setUsingSaved(true);
        }
      })
      .catch(() => {});
  }, [authToken]);

  // Load PDF
  useEffect(() => {
    if (!request.pdf_preview_url) { setPdfLoading(false); return; }
    let active = true;
    (async () => {
      try {
        const lib = await getPdfJs();
        const doc = await lib.getDocument(request.pdf_preview_url!).promise;
        if (!active) return;
        setPdfDoc(doc);
        setPageCount(doc.numPages);
        setPage(targetPage);
      } catch (e) {
        console.error("[PdfSignModal] load error", e);
        if (active) setPdfLoading(false);
      }
    })();
    return () => { active = false; };
  }, [request.pdf_preview_url]); // eslint-disable-line react-hooks/exhaustive-deps

  // Render current page
  useEffect(() => {
    if (!pdfDoc) return;
    let active = true;
    setPdfLoading(true);
    (async () => {
      try {
        const pg        = await pdfDoc.getPage(page);
        if (!active) return;
        const container = containerRef.current;
        const canvas    = canvasRef.current;
        if (!canvas || !container) return;
        const cw     = container.clientWidth || 440;
        const baseVp = pg.getViewport({ scale: 1 });
        const vp     = pg.getViewport({ scale: cw / baseVp.width });
        canvas.width  = vp.width;
        canvas.height = vp.height;
        const ctx = canvas.getContext("2d")!;
        ctx.clearRect(0, 0, vp.width, vp.height);
        await pg.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
        if (active) setPdfLoading(false);
      } catch {
        if (active) setPdfLoading(false);
      }
    })();
    return () => { active = false; };
  }, [pdfDoc, page]);

  const isTargetPage = page === targetPage;

  async function handleConfirm() {
    if (signing) return; // double-submit guard
    if (!sigData) { setErr(t.noSig); return; }
    setErr("");
    setSigning(true);
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
        })
          .then(() => setSavedSig(sigData))
          .catch(() => {})
          .finally(() => setSavingSig(false));
      }

      setSignedUrl(j.signedPdfUrl ?? null);
      onSigned(request.id);
    } catch (e) {
      setErr(String(e));
    } finally {
      setSigning(false);
    }
  }

  function clearSig() {
    setSigData(null);
    setUsingSaved(false);
    setSigPlaced(false);
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-x-0 z-[1300] flex items-center justify-center px-2 bv-sign-modal-outer"
      style={{
        top: "calc(58px + var(--bv-subnav-h, 0px))",
        paddingTop: "6px",
        bottom: 0,
        background: "rgba(0,0,0,0.7)",
        backdropFilter: "blur(10px)",
      }}
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
        /* Pulsing glow on the signature zone — draws candidate's eye to where
           they need to sign. Stops once the signature is placed. */
        @keyframes bvSigPulse {
          0%, 100% {
            box-shadow:
              0 0 0 0 rgba(201, 162, 64, 0.55),
              0 0 18px 2px rgba(201, 162, 64, 0.35);
            background: rgba(201, 162, 64, 0.18) !important;
          }
          50% {
            box-shadow:
              0 0 0 8px rgba(201, 162, 64, 0),
              0 0 26px 6px rgba(201, 162, 64, 0.55);
            background: rgba(201, 162, 64, 0.32) !important;
          }
        }
        .bv-sig-zone-pulse {
          animation: bvSigPulse 1.6s ease-in-out infinite;
        }
      `}</style>
      <div
        className="bv-sign-modal-card w-full sm:max-w-2xl rounded-2xl overflow-hidden flex flex-col"
        style={{
          background: "var(--card)",
          border: "1px solid var(--border-gold)",
          boxShadow: "var(--shadow-lg)",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 flex-shrink-0"
          style={{ background: "var(--gdim)", borderBottom: "1px solid var(--border-gold)" }}>
          <div className="flex items-center gap-2 min-w-0">
            <FilePen size={14} strokeWidth={1.8} style={{ color: "var(--gold)", flexShrink: 0 }} />
            <span className="text-[13.5px] font-semibold truncate" style={{ color: "var(--gold)" }}>
              {request.document_name}
            </span>
          </div>
          <button onClick={onClose} disabled={signing}
            className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-full transition-opacity hover:opacity-70 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: "var(--bg2)" }}>
            <XIcon size={14} strokeWidth={2} style={{ color: "var(--w3)" }} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 p-4 space-y-4">

          {/* Note */}
          {request.note && (
            <p className="text-[12.5px] px-3 py-2 rounded-xl"
              style={{ background: "var(--bg2)", color: "var(--w3)", border: "1px solid var(--border)" }}>
              <span style={{ color: "var(--gold)", fontWeight: 600 }}>{t.note} </span>
              {request.note}
            </p>
          )}

          {/* Success state */}
          {signedUrl ? (
            <div className="text-center space-y-3 py-4">
              <CheckCircle2 size={44} strokeWidth={1.5} className="mx-auto" style={{ color: "var(--success)" }} />
              <p className="text-[14px] font-semibold" style={{ color: "var(--w)" }}>{t.signed}</p>
              <a href={signedUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[13px] font-semibold transition-opacity hover:opacity-80"
                style={{ background: "var(--success-bg)", color: "var(--success)", border: "1px solid var(--success-border)" }}>
                <Download size={14} strokeWidth={2} />
                {t.download}
              </a>
              <button onClick={onClose}
                className="block w-full py-2 text-[13px] font-medium transition-opacity hover:opacity-70"
                style={{ color: "var(--w3)" }}>
                {t.close}
              </button>
            </div>
          ) : (
            <>
              {/* ── PDF VIEWER ── */}
              <div>
                {/* Page navigation */}
                {pageCount > 1 && (
                  <div className="flex items-center justify-between mb-2">
                    <button
                      disabled={page <= 1}
                      onClick={() => setPage(p => p - 1)}
                      className="flex items-center gap-1 text-[11.5px] px-2 py-1 rounded-lg disabled:opacity-30 transition-opacity hover:opacity-70"
                      style={{ background: "var(--bg2)", color: "var(--w3)" }}>
                      <ChevronLeft size={12} />
                    </button>
                    <span className="text-[11.5px]" style={{ color: "var(--w3)" }}>
                      Page {page} of {pageCount}
                      {!isTargetPage && (
                        <button
                          onClick={() => setPage(targetPage)}
                          className="ml-2 underline"
                          style={{ color: "var(--gold)" }}>
                          Go to sign page
                        </button>
                      )}
                    </span>
                    <button
                      disabled={page >= pageCount}
                      onClick={() => setPage(p => p + 1)}
                      className="flex items-center gap-1 text-[11.5px] px-2 py-1 rounded-lg disabled:opacity-30 transition-opacity hover:opacity-70"
                      style={{ background: "var(--bg2)", color: "var(--w3)" }}>
                      <ChevronRight size={12} />
                    </button>
                  </div>
                )}

                {/* Canvas */}
                <div ref={containerRef} className="relative select-none rounded-xl overflow-hidden"
                  style={{ border: "1px solid var(--border)", background: "#f5f5f5" }}>
                  {pdfLoading && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center"
                      style={{ background: "rgba(0,0,0,0.45)" }}>
                      <Spinner size="md" />
                    </div>
                  )}

                  {!request.pdf_preview_url && !pdfLoading && (
                    <div className="flex items-center justify-center py-12 text-[12.5px]"
                      style={{ color: "var(--w3)" }}>
                      No PDF preview available
                    </div>
                  )}

                  <canvas ref={canvasRef}
                    style={{ display: "block", width: "100%", height: "auto" }} />

                  {/* Sign-zone overlay — only on target page. Pulses to grab
                      attention until the signature is placed, then settles. */}
                  {isTargetPage && zone && !pdfLoading && (
                    <div
                      className={!sigPlaced && !dragOverZone ? "bv-sig-zone-pulse" : ""}
                      style={{
                        position: "absolute",
                        left:       `${zone.x * 100}%`,
                        top:        `${zone.y * 100}%`,
                        width:      `${zone.w * 100}%`,
                        height:     `${zone.h * 100}%`,
                        border:     `2.5px ${dragOverZone ? "solid" : "dashed"} var(--gold)`,
                        background: dragOverZone
                          ? "var(--border-gold)"
                          : sigPlaced
                            ? "var(--gdim)"
                            : "rgba(201,162,64,0.14)",
                        borderRadius: 6,
                        cursor: "pointer",
                        overflow: "hidden",
                        transition: "background 0.15s, border 0.15s",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                      onDragOver={e => { e.preventDefault(); setDragOverZone(true); }}
                      onDragLeave={() => setDragOverZone(false)}
                      onDrop={e => {
                        e.preventDefault();
                        setDragOverZone(false);
                        if (e.dataTransfer.getData("bv-sig") === "saved" && savedSig) {
                          setSigData(savedSig);
                          setUsingSaved(true);
                          setSigPlaced(true);
                        }
                      }}
                      onClick={() => {
                        if (savedSig && !sigPlaced) {
                          setSigData(savedSig);
                          setUsingSaved(true);
                          setSigPlaced(true);
                        }
                      }}
                    >
                      {sigPlaced && sigData ? (
                        /* Show placed signature as preview */
                        <>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={sigData}
                            alt="signature"
                            style={{
                              width: "90%", height: "90%",
                              objectFit: "contain",
                              filter: "invert(0)",
                            }}
                          />
                          <button
                            onClick={e => { e.stopPropagation(); clearSig(); }}
                            className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full flex items-center justify-center"
                            style={{ background: "rgba(0,0,0,0.5)" }}>
                            <XIcon size={8} strokeWidth={2.5} style={{ color: "#fff" }} />
                          </button>
                        </>
                      ) : (
                        <span style={{
                          fontSize: 11, color: "var(--gold)", fontWeight: 700,
                          textShadow: "0 1px 3px rgba(0,0,0,0.6)",
                          pointerEvents: "none",
                        }}>
                          ✍ {t.dropHere}
                        </span>
                      )}
                    </div>
                  )}

                  {/* No-zone fallback label on last page */}
                  {isTargetPage && !zone && !pdfLoading && (
                    <div className="absolute bottom-4 right-4 px-3 py-1.5 rounded-lg text-[11px] font-semibold"
                      style={{ background: "rgba(201,162,64,0.85)", color: "#131312" }}>
                      ✍ Signature will appear here
                    </div>
                  )}
                </div>
              </div>

              {/* ── SIGNATURE SECTION ── */}
              <div className="space-y-3 pt-1">
                {/* Saved signature — draggable */}
                {savedSig && (
                  <div className="space-y-2">
                    <p className="text-[11.5px] font-semibold" style={{ color: "var(--w3)" }}>
                      {t.dragHint}
                    </p>
                    <div className="flex items-center gap-3">
                      {/* Draggable saved sig chip */}
                      <div
                        draggable
                        onDragStart={e => {
                          e.dataTransfer.setData("bv-sig", "saved");
                          e.dataTransfer.effectAllowed = "copy";
                        }}
                        className="flex-shrink-0 rounded-xl overflow-hidden cursor-grab active:cursor-grabbing"
                        style={{
                          border: "1.5px solid var(--border-gold)",
                          background: "#fff",
                          width: 120, height: 48,
                        }}
                        title="Drag onto the zone above"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={savedSig} alt="saved signature"
                          style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                      </div>
                      <div className="flex-1 space-y-1">
                        <button
                          onClick={() => { setSigData(savedSig); setUsingSaved(true); setSigPlaced(true); }}
                          className="w-full py-1.5 text-[11.5px] font-semibold rounded-full transition-all"
                          style={{
                            background: usingSaved ? "var(--gold)" : "var(--bg2)",
                            color:      usingSaved ? "#131312"     : "var(--w3)",
                            border: usingSaved ? "none" : "1px solid var(--border)",
                          }}>
                          {t.useSaved}
                        </button>
                        <button
                          onClick={() => { setUsingSaved(false); setSigData(null); setSigPlaced(false); }}
                          className="w-full py-1.5 text-[11.5px] font-semibold rounded-full transition-all"
                          style={{
                            background: !usingSaved ? "var(--gold)" : "var(--bg2)",
                            color:      !usingSaved ? "#131312"     : "var(--w3)",
                            border: !usingSaved ? "none" : "1px solid var(--border)",
                          }}>
                          {t.drawNew}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Draw pad — shown when not using saved OR no saved sig */}
                {!usingSaved && (
                  <>
                    <p className="text-[12px]" style={{ color: "var(--w3)" }}>{t.drawHint}</p>
                    <SignaturePad
                      height={120}
                      onCapture={d => { setSigData(d); if (d) setSigPlaced(true); else setSigPlaced(false); }}
                      clearLabel={t.clear}
                    />
                  </>
                )}

                {/* Save for next time */}
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={wantSave}
                    onChange={e => setWantSave(e.target.checked)}
                    className="w-4 h-4 rounded"
                    style={{ accentColor: "var(--gold)" }}
                  />
                  <span className="text-[12px]" style={{ color: "var(--w3)" }}>
                    {savingSig ? t.saving : t.saveForNext}
                  </span>
                  <Save size={11} strokeWidth={2} style={{ color: "var(--w3)" }} />
                </label>

                {err && <p className="text-[12px]" style={{ color: "var(--error, #e03030)" }}>{err}</p>}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {!signedUrl && (
          <div className="flex-shrink-0 px-4 py-3 flex gap-2"
            style={{ borderTop: "1px solid var(--border)" }}>
            <button
              onClick={handleConfirm}
              disabled={signing || !sigData}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-[13.5px] font-semibold transition-all disabled:opacity-50 hover:opacity-90 active:scale-[0.98]"
              style={{ background: "var(--gold)", color: "#131312" }}>
              {signing
                ? <><Spinner size="xs" color="#131312" />{t.signing}</>
                : <><FilePen size={14} strokeWidth={2} />{t.confirm}</>
              }
            </button>
            <button
              onClick={onClose} disabled={signing}
              className="px-4 py-3 rounded-xl text-[13px] font-medium transition-opacity hover:opacity-70 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: "var(--bg2)", color: "var(--w3)", border: "1px solid var(--border)" }}>
              <XIcon size={14} strokeWidth={2} />
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
