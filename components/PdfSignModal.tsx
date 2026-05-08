"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  FilePen, CheckCircle2, X as XIcon, Download, Save,
} from "lucide-react";
import { SignaturePad } from "@/components/SignaturePad";
import { Spinner } from "@/components/ui/states";
import { PdfViewer } from "@/components/PdfViewer";
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
    pageOf: (p: number, n: number) => `Page ${p} of ${n}`,
    goToSign: "Go to sign page",
    sigAppears: "Signature will appear here",
    noPreview: "No PDF preview available",
  },
  fr: {
    close: "Fermer", confirm: "Confirmer & signer", signing: "Signature…",
    drawHint: "Dessinez votre signature ci-dessous", noSig: "Veuillez d'abord signer",
    useSaved: "Utiliser la sauvegardée", drawNew: "Dessiner", saveForNext: "Enregistrer pour la prochaine fois",
    saving: "Enregistrement…", download: "Télécharger la copie signée", signed: "Signé",
    clear: "Effacer", dropHere: "Déposez ou cliquez pour signer",
    dragHint: "Glissez votre signature sur la zone ou dessinez ci-dessous",
    note: "Note :",
    pageOf: (p: number, n: number) => `Page ${p} sur ${n}`,
    goToSign: "Aller à la page de signature",
    sigAppears: "La signature apparaîtra ici",
    noPreview: "Aperçu PDF indisponible",
  },
  de: {
    close: "Schließen", confirm: "Bestätigen & unterschreiben", signing: "Wird unterschrieben…",
    drawHint: "Zeichnen Sie Ihre Unterschrift", noSig: "Bitte zuerst unterschreiben",
    useSaved: "Gespeicherte verwenden", drawNew: "Neu zeichnen", saveForNext: "Für nächstes Mal speichern",
    saving: "Speichern…", download: "Unterschriebene Kopie herunterladen", signed: "Unterschrieben",
    clear: "Löschen", dropHere: "Ablegen oder klicken zum Unterschreiben",
    dragHint: "Unterschrift auf Zone ziehen oder unten zeichnen",
    note: "Hinweis:",
    pageOf: (p: number, n: number) => `Seite ${p} von ${n}`,
    goToSign: "Zur Signaturseite",
    sigAppears: "Unterschrift erscheint hier",
    noPreview: "PDF-Vorschau nicht verfügbar",
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

export function PdfSignModal({ request, lang, authToken, onSigned, onClose }: Props) {
  const t = T[lang] ?? T.en;

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
        className="bv-sign-modal-card w-full max-w-3xl rounded-2xl overflow-hidden flex flex-col"
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          boxShadow: "var(--shadow-lg)",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--border)" }}>
          <div className="min-w-0 flex-1 mr-3">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] mb-0.5" style={{ color: "var(--w3)" }}>
              {lang === "fr" ? "Demande de signature" : lang === "de" ? "Signaturanfrage" : "Signature request"}
            </p>
            <p className="text-[13.5px] font-semibold truncate tracking-tight" style={{ color: "var(--w)" }}>
              {request.document_name}
            </p>
          </div>
          <button onClick={onClose} disabled={signing}
            className="bv-icon-btn w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full transition-opacity hover:opacity-70 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ color: "var(--w3)" }}>
            <XIcon size={14} strokeWidth={1.8} />
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
              {/* ── PDF VIEWER (unified — pinch/wheel zoom built in) ── */}
              <div
                style={{ height: "62dvh", borderRadius: 12, overflow: "hidden", border: "1px solid var(--border)" }}
                onWheel={e => e.stopPropagation()}
              >
                {request.pdf_preview_url ? (
                  <PdfViewer
                    src={request.pdf_preview_url}
                    hideRotate
                    pageOverlay={({ pageNum }) => {
                      if (!zone || zone.page !== pageNum) return null;
                      return (
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
                            <>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={sigData}
                                alt="signature"
                                style={{ width: "90%", height: "90%", objectFit: "contain" }}
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
                      );
                    }}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-[12.5px]"
                    style={{ color: "var(--w3)" }}>
                    {t.noPreview}
                  </div>
                )}
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
