"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, XCircle } from "@/components/PortalIcons";
import { X as XIcon, Download } from "lucide-react";
import { AdminRejectModal } from "@/components/AdminRejectModal";
import { PdfViewer } from "@/components/PdfViewer";
import { DocxViewer } from "@/components/DocxViewer";
import { ZoomPanRotateViewer } from "@/components/ZoomPanRotateViewer";
import { Spinner } from "@/components/ui/states";
import { useLang } from "@/components/LangContext";

const dm = {
  en: {
    passportData: "Passport data",
    download: "Download",
    approved: "Approved",
    rejected: "Rejected",
    reject: "Reject",
    approve: "Approve",
    close: "Close",
    previewUnavailable: (ext: string) => `Preview not available for .${ext}`,
    downloadToOpen: "Download the file to open it in your default app.",
    failApprove: "Failed to approve — please try again.",
    netError: "Network error — please try again.",
    failReject: "Failed to reject — please try again.",
  },
  fr: {
    passportData: "Données passeport",
    download: "Télécharger",
    approved: "Approuvé",
    rejected: "Refusé",
    reject: "Refuser",
    approve: "Approuver",
    close: "Fermer",
    previewUnavailable: (ext: string) => `Aperçu non disponible pour .${ext}`,
    downloadToOpen: "Téléchargez le fichier pour l'ouvrir dans votre application.",
    failApprove: "Échec de l'approbation — veuillez réessayer.",
    netError: "Erreur réseau — veuillez réessayer.",
    failReject: "Échec du refus — veuillez réessayer.",
  },
  de: {
    passportData: "Passdaten",
    download: "Herunterladen",
    approved: "Genehmigt",
    rejected: "Abgelehnt",
    reject: "Ablehnen",
    approve: "Genehmigen",
    close: "Schließen",
    previewUnavailable: (ext: string) => `Vorschau für .${ext} nicht verfügbar`,
    downloadToOpen: "Laden Sie die Datei herunter, um sie in Ihrer Standard-App zu öffnen.",
    failApprove: "Genehmigung fehlgeschlagen — bitte erneut versuchen.",
    netError: "Netzwerkfehler — bitte erneut versuchen.",
    failReject: "Ablehnung fehlgeschlagen — bitte erneut versuchen.",
  },
};

type Doc = {
  id: string;
  user_id: string;
  file_name: string;
  file_type: string;
  uploaded_at: string;
  status: string;
  feedback: string | null;
  drive_file_id: string | null;
};

export function AdminDocPreviewModal({
  doc, accessToken, onClose, onUpdated, noPreviewText = "Preview not available",
  onShowPassportData, sideBySide = false,
}: {
  doc: Doc;
  accessToken: string;
  onClose: () => void;
  onUpdated?: (doc: Doc) => void;
  noPreviewText?: string;
  /** When set AND the doc is a passport, a "Passport data" button appears
   *  in the header next to Download. Clicking it triggers this callback —
   *  the parent owns the passport-data popup state. */
  onShowPassportData?: () => void;
  /** Verification-phase split layout: this preview hugs the LEFT half on
   *  laptop so the passport-data popup can sit on the right. On mobile we
   *  ignore it and just stack vertically with the data popup below. */
  sideBySide?: boolean;
}) {
  const { lang } = useLang();
  const dt = dm[lang as keyof typeof dm] ?? dm.en;

  const [rejectOpen, setRejectOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savedAs, setSavedAs]       = useState<"approved" | "rejected" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [blobUrl, setBlobUrl]       = useState<string | null>(null);

  // Authenticated fetch via our API → blob URL. Used for both the PdfViewer
  // and the download button (no need to refetch).
  useEffect(() => {
    if (!doc.drive_file_id) return;
    let mounted = true;
    let url = "";
    const ctrl = new AbortController();
    fetch(`/api/portal/file?id=${doc.drive_file_id}`, {
      signal: ctrl.signal,
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    })
      .then(r => r.blob())
      .then(blob => { if (!mounted) return; url = URL.createObjectURL(blob); setBlobUrl(url); })
      .catch(err => { if (err.name !== "AbortError") console.error("Preview fetch error:", err); });
    return () => { mounted = false; ctrl.abort(); if (url) URL.revokeObjectURL(url); };
  }, [doc.drive_file_id, accessToken]);

  async function approve() {
    if (submitting) return;
    setSubmitting(true);
    setActionError(null);
    try {
      const res = await fetch("/api/portal/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ docId: doc.id, status: "approved", feedback: null }),
      });
      if (res.ok) {
        setSavedAs("approved");
        onUpdated?.({ ...doc, status: "approved", feedback: null });
        setTimeout(onClose, 700);
      } else {
        setActionError(dt.failApprove);
      }
    } catch {
      setActionError(dt.netError);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRejectSubmit(text: string, shot: string | null) {
    setSubmitting(true);
    setActionError(null);
    try {
      const fb = text.trim() || null;
      const res = await fetch("/api/portal/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ docId: doc.id, status: "rejected", feedback: fb }),
      });
      if (!res.ok) {
        setActionError(dt.failReject);
        return;
      }
      if (shot) {
        try {
          await fetch("/api/portal/admin/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
            body: JSON.stringify({
              threadUserId: doc.user_id,
              body: fb || `Rejected: ${doc.file_type}`,
              attachment: shot,
            }),
          });
        } catch (e) { console.error("[reject] attach failed:", e); }
      }
      setRejectOpen(false);
      setSavedAs("rejected");
      onUpdated?.({ ...doc, status: "rejected", feedback: fb });
      setTimeout(onClose, 700);
    } finally {
      setSubmitting(false);
    }
  }

  const canReview = !savedAs && doc.status !== "approved";

  // Portal to document.body so this modal always escapes any ancestor
  // stacking-context created by backdrop-filter (e.g. the mobile bottom bar).
  if (typeof document === "undefined") return null;

  return createPortal(
   <div className={`fixed inset-x-0 z-[700] flex justify-center p-4 bv-doc-preview-outer ${sideBySide ? "bv-side-preview" : "top-[58px] bottom-0 items-center"}`}
      style={{ background: sideBySide ? "rgba(0,0,0,0.45)" : "rgba(0,0,0,0.72)",
               backdropFilter: sideBySide ? "blur(8px)" : undefined,
               ...(sideBySide ? {} : {}) }}
      onClick={() => { if (!submitting) onClose(); }}>
      {/* Side-by-side mode (passport verification phase):
            Laptop → preview hugs the LEFT half centered, gap on the right
                     so the data form sits in the right half with breathing room
            Phone  → preview takes the TOP half; data form lives in the bottom
                     half (no overlapping, can be seen at a glance) */}
      <style>{`
        @media (max-width: 639.98px) {
          .bv-doc-preview-outer { padding-bottom: calc(1rem + 72px) !important; }
          .bv-doc-preview-card  {
            height: calc(100dvh - 58px - 1rem - 72px - 1rem) !important;
            max-height: calc(100dvh - 58px - 1rem - 72px - 1rem) !important;
          }
          .bv-side-preview {
            top: 58px !important;
            bottom: calc(50dvh + 0.25rem) !important;
            padding-bottom: 0.25rem !important;
            align-items: center !important;
          }
          .bv-side-preview .bv-doc-preview-card {
            height: 100% !important;
            max-height: 100% !important;
          }
        }
        @media (min-width: 640px) {
          .bv-side-preview {
            top: 58px;
            bottom: 0;
            align-items: center;
            /* Hug the centerline: card right-edge sits at 50vw exactly,
               so the data form can sit flush against it on the other side.
               No mid-screen gap. */
            justify-content: flex-end !important;
            padding-right: 50vw;
            padding-left: 1rem;
          }
          /* Passport pages are wider than tall, so the preview card never
             needs to fill the full vertical space — cap it at ~620px and
             let the data form extend taller next to it if needed. */
          .bv-side-preview .bv-doc-preview-card {
            max-height: 620px;
          }
        }
      `}</style>
      <div className={`bv-doc-preview-card w-full overflow-hidden flex flex-col ${sideBySide ? "sm:max-w-[560px]" : "max-w-4xl"}`}
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: "var(--r-2xl)",
          boxShadow: "var(--shadow-lg)",
          height: "88vh",
          maxHeight: "88vh",
          animation: "bvFadeRise 0.22s var(--ease-out)",
        }}
        onClick={e => e.stopPropagation()}>

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-3.5"
          style={{ borderBottom: "1px solid var(--border)" }}>
          <div className="min-w-0 flex-1 mr-3">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] mb-0.5" style={{ color: "var(--w3)" }}>{doc.file_type}</p>
            <p className="text-[13.5px] font-semibold truncate tracking-tight" style={{ color: "var(--w)" }}>{doc.file_name}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {actionError && (
              <span className="text-[11px] font-medium px-2 py-1 rounded-lg"
                style={{ background: "rgba(224,82,82,0.1)", color: "#e05252", border: "1px solid rgba(224,82,82,0.25)" }}>
                {actionError}
              </span>
            )}
            {/* "Passport data" button — only when the doc is a passport AND
                 the parent has provided a handler. Replaces the old standalone
                 "Passport Data" row in the doc list. */}
            {onShowPassportData && /pass/i.test(doc.file_type) && (
              <button
                type="button"
                onClick={onShowPassportData}
                title={dt.passportData}
                aria-label={dt.passportData}
                className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold px-2.5 h-8 rounded-full transition-colors"
                style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="4" width="18" height="16" rx="2"/>
                  <circle cx="9" cy="10" r="2"/>
                  <line x1="14" y1="9" x2="18" y2="9"/>
                  <line x1="14" y1="13" x2="18" y2="13"/>
                  <line x1="6" y1="16" x2="18" y2="16"/>
                </svg>
                {dt.passportData}
              </button>
            )}
            {blobUrl && (
              <a
                href={blobUrl}
                download={doc.file_name}
                title={dt.download} aria-label={dt.download}
                className="bv-icon-btn w-8 h-8 rounded-full flex items-center justify-center"
                style={{ color: "var(--w2)" }}>
                <Download size={14} strokeWidth={1.8} />
              </a>
            )}
            {savedAs && (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg"
                style={{
                  background: savedAs === "approved" ? "rgba(52,199,89,0.15)" : "rgba(224,82,82,0.12)",
                  color: savedAs === "approved" ? "#34c759" : "#e05252",
                  border: `1px solid ${savedAs === "approved" ? "rgba(52,199,89,0.3)" : "rgba(224,82,82,0.28)"}`,
                }}>
                {savedAs === "approved"
                  ? <><CheckCircle2 size={13} strokeWidth={1.8} /> {dt.approved}</>
                  : <><XCircle size={13} strokeWidth={1.8} /> {dt.rejected}</>}
              </span>
            )}
            {canReview && (
              <>
                <button onClick={() => setRejectOpen(true)} disabled={submitting}
                  title={dt.reject} aria-label={dt.reject}
                  className="bv-icon-btn bv-icon-btn--reject w-9 h-9 rounded-full flex items-center justify-center disabled:opacity-40">
                  <XCircle size={15} strokeWidth={1.8} />
                </button>
                <button onClick={approve} disabled={submitting}
                  title={dt.approve} aria-label={dt.approve}
                  className="bv-icon-btn bv-icon-btn--approve w-9 h-9 rounded-full flex items-center justify-center disabled:opacity-40">
                  <CheckCircle2 size={15} strokeWidth={1.8} />
                </button>
              </>
            )}
            <button onClick={onClose} aria-label="Close"
              className="bv-icon-btn w-8 h-8 rounded-full flex items-center justify-center"
              style={{ color: "var(--w3)" }}>
              <XIcon size={14} strokeWidth={1.8} />
            </button>
          </div>
        </div>

        {/* ── Body ── PDF / image / "download to view" fallback */}
        <div className="flex-1" style={{ minHeight: 0, position: "relative" }}>
          {blobUrl ? (() => {
            const ext = (doc.file_name.split(".").pop() ?? "").toLowerCase();
            if (ext === "pdf") return <PdfViewer src={blobUrl} />;
            if (ext === "docx") return <DocxViewer src={blobUrl} fileName={doc.file_name} />;
            if (["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(ext)) {
              return (
                <ZoomPanRotateViewer>
                  { /* eslint-disable-next-line @next/next/no-img-element */ }
                  <img src={blobUrl} alt={doc.file_name}
                    draggable={false}
                    style={{ maxWidth: "90vw", maxHeight: "85vh", objectFit: "contain", userSelect: "none", pointerEvents: "none" }} />
                </ZoomPanRotateViewer>
              );
            }
            return (
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#525659", color: "#fff", padding: "1rem", textAlign: "center" }}>
                <p className="text-[14px] font-semibold mb-2">{dt.previewUnavailable(ext)}</p>
                <p className="text-[12.5px] opacity-80 mb-4">{dt.downloadToOpen}</p>
                <a href={blobUrl} download={doc.file_name}
                  className="inline-flex items-center gap-2 px-4 py-2 text-[13px] font-semibold"
                  style={{ background: "var(--gold)", color: "#131312", borderRadius: "var(--r-sm)" }}>
                  <Download size={13} strokeWidth={1.8} /> {dt.download}
                </a>
              </div>
            );
          })() : doc.drive_file_id ? (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#525659" }}>
              <Spinner size="md" />
            </div>
          ) : (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <p className="text-sm" style={{ color: "var(--w3)" }}>{noPreviewText}</p>
            </div>
          )}
        </div>

      </div>

      {/* Standalone reject popup — same component used everywhere */}
      {rejectOpen && (
        <AdminRejectModal
          target={{ label: doc.file_type || doc.file_name, initialFeedback: doc.feedback ?? "" }}
          onCancel={() => setRejectOpen(false)}
          onSubmit={handleRejectSubmit}
        />
      )}
    </div>,
    document.body,
  );
}
