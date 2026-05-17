"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, XCircle } from "@/components/PortalIcons";
import { X as XIcon, Download } from "lucide-react";
import { AdminRejectModal } from "@/components/AdminRejectModal";
import { PdfViewer } from "@/components/PdfViewer";
import { DocxViewer } from "@/components/DocxViewer";
import { ZoomPanRotateViewer } from "@/components/ZoomPanRotateViewer";
import { IosPdfFrame } from "@/components/IosPdfFrame";
import { isIOSDevice } from "@/lib/platform";
import { triggerIosDownload } from "@/lib/iosDownload";
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
  uploaded_by_admin?: boolean;
};

export function AdminDocPreviewModal({
  doc, accessToken, onClose, onUpdated, noPreviewText = "Preview not available",
  onShowPassportData, sideBySide = false, overrideFetchUrl,
}: {
  doc: Doc;
  accessToken: string;
  onClose: () => void;
  onUpdated?: (doc: Doc) => void;
  noPreviewText?: string;
  onShowPassportData?: () => void;
  sideBySide?: boolean;
  /** When provided, fetch the preview from this URL instead of /api/portal/file. */
  overrideFetchUrl?: string;
}) {
  const { lang, t: gT } = useLang();
  const dt = dm[lang as keyof typeof dm] ?? dm.en;

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  const [rejectOpen, setRejectOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savedAs, setSavedAs]       = useState<"approved" | "rejected" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [blobUrl, setBlobUrl]       = useState<string | null>(null);
  // Track the auto-close timeout so we can clear it on unmount — prevents
  // setState-on-unmounted-component if the user navigates within 700ms.
  const closeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  // Authenticated fetch via our API → blob URL. Used for both the PdfViewer
  // and the download button (no need to refetch).
  useEffect(() => {
    // iOS renders PDFs via the native iframe (server URL) — no blob needed.
    // Skip the blob fetch so a large PDF isn't downloaded twice on mobile.
    if (isIOSDevice() && (doc.file_name.split(".").pop() ?? "").toLowerCase() === "pdf") return;
    const fetchUrl = overrideFetchUrl
      ?? (doc.drive_file_id ? `/api/portal/file?id=${doc.drive_file_id}` : `/api/portal/file?docId=${doc.id}`);
    if (!fetchUrl) return;
    let mounted = true;
    let url = "";
    const ctrl = new AbortController();
    fetch(fetchUrl, {
      signal: ctrl.signal,
      cache: "no-store",
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    })
      .then(r => r.blob())
      .then(blob => { if (!mounted) return; url = URL.createObjectURL(blob); setBlobUrl(url); })
      .catch(err => { if (err.name !== "AbortError") console.error("Preview fetch error:", err); });
    return () => { mounted = false; ctrl.abort(); if (url) URL.revokeObjectURL(url); };
  }, [overrideFetchUrl, doc.drive_file_id, accessToken]);

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
        closeTimerRef.current = setTimeout(onClose, 700);
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
    if (submitting) return;
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
              body: fb || `${dt.rejected}: ${doc.file_type}`,
              attachment: shot,
            }),
          });
        } catch (e) { console.error("[reject] attach failed:", e); }
      }
      setRejectOpen(false);
      setSavedAs("rejected");
      onUpdated?.({ ...doc, status: "rejected", feedback: fb });
      closeTimerRef.current = setTimeout(onClose, 700);
    } finally {
      setSubmitting(false);
    }
  }

  const canReview = !savedAs && doc.status !== "approved" && !doc.uploaded_by_admin;

  // ── iOS parity (sub-admins use iPhones too) ──────────────────────────────
  // iOS WebKit can't paint the pdf.js canvas (blank preview) and won't
  // download a blob `<a download>`. Mirror the candidate-side fix: native
  // PDF iframe for preview + server route (?dl=1&access_token) for download.
  const iosMode = isIOSDevice();
  const fileBase = overrideFetchUrl
    ?? (doc.drive_file_id
      ? `/api/portal/file?id=${encodeURIComponent(doc.drive_file_id)}`
      : `/api/portal/file?docId=${encodeURIComponent(doc.id)}`);
  const withQ = (u: string, qs: string) => u + (u.includes("?") ? "&" : "?") + qs;
  const iosPreviewUrl  = withQ(fileBase, `access_token=${encodeURIComponent(accessToken)}`);
  const iosDownloadUrl = withQ(fileBase, `dl=1&name=${encodeURIComponent(doc.file_name)}&access_token=${encodeURIComponent(accessToken)}`);

  // Portal to document.body so this modal always escapes any ancestor
  // stacking-context created by backdrop-filter (e.g. the mobile bottom bar).
  if (typeof document === "undefined") return null;

  return createPortal(
   <div className={`fixed inset-x-0 z-[700] flex justify-center p-2 bv-doc-preview-outer ${sideBySide ? "bv-side-preview" : "items-center"}`}
      style={{
        top: "calc(58px + var(--bv-subnav-h, 0px))",
        paddingTop: "6px",
        bottom: 0,
        background: sideBySide ? "rgba(0,0,0,0.45)" : "rgba(0,0,0,0.72)",
        backdropFilter: sideBySide ? "blur(8px)" : undefined,
      }}
      onClick={() => { if (!submitting) onClose(); }}>
      {/* Side-by-side mode (passport verification phase):
            Laptop → preview hugs the LEFT half centered, gap on the right
                     so the data form sits in the right half with breathing room
            Phone  → preview takes the TOP half; data form lives in the bottom
                     half (no overlapping, can be seen at a glance) */}
      <style>{`
        /* ── Universal PDF popup rule ──
           Top: sits below header + subnav + 6px gap
           Bottom mobile: sits above bottom nav (72px) + 6px gap
           Bottom desktop: 6px gap from viewport edge
           Card height is derived from available space. */
        .bv-doc-preview-card {
          height: calc(100dvh - 58px - var(--bv-subnav-h, 0px) - 6px - 6px - env(safe-area-inset-bottom, 0px));
          max-height: calc(100dvh - 58px - var(--bv-subnav-h, 0px) - 6px - 6px - env(safe-area-inset-bottom, 0px));
        }
        @media (max-width: 639.98px) {
          .bv-doc-preview-outer { padding-bottom: calc(72px + 6px + env(safe-area-inset-bottom, 0px)) !important; }
          .bv-doc-preview-card  {
            height: calc(100dvh - 58px - var(--bv-subnav-h, 0px) - 6px - 72px - 6px - env(safe-area-inset-bottom, 0px)) !important;
            max-height: calc(100dvh - 58px - var(--bv-subnav-h, 0px) - 6px - 72px - 6px - env(safe-area-inset-bottom, 0px)) !important;
          }
          /* Phone single-scroll: the passport renders inside the data
             card's scroll (one page). This separate fixed preview pane is
             hidden on phone so there's no duplicate / overlap. Desktop
             keeps the left/right side-by-side. */
          .bv-side-preview { display: none !important; }
        }
        @media (min-width: 640px) {
          .bv-side-preview {
            top: calc(58px + var(--bv-subnav-h, 0px));
            bottom: 0;
            align-items: center;
            justify-content: flex-end !important;
            padding-right: 50vw;
            padding-left: 1rem;
          }
          /* Universal side-by-side: SAME size as the passport-data pane —
             full height, equal width — identical to the candidate side. */
          .bv-side-preview .bv-doc-preview-card {
            height: calc(100dvh - 58px - var(--bv-subnav-h, 0px) - 1rem) !important;
            max-height: calc(100dvh - 58px - var(--bv-subnav-h, 0px) - 1rem) !important;
          }
        }
      `}</style>
      <div className={`bv-doc-preview-card w-full overflow-hidden flex flex-col ${sideBySide ? "sm:max-w-[480px]" : "max-w-4xl"}`}
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: "var(--r-2xl)",
          boxShadow: "var(--shadow-lg)",
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
                style={{ background: "var(--danger-bg)", color: "var(--danger)", border: "1px solid var(--danger-border)" }}>
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

            {iosMode ? (
              <button
                type="button"
                onClick={() => triggerIosDownload(iosDownloadUrl, doc.file_name)}
                title={dt.download} aria-label={dt.download}
                className="bv-icon-btn w-8 h-8 rounded-full flex items-center justify-center"
                style={{ color: "var(--w2)", background: "transparent", border: "none" }}>
                <Download size={14} strokeWidth={1.8} />
              </button>
            ) : blobUrl && (
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
                  background: savedAs === "approved" ? "var(--success-bg)" : "var(--danger-bg)",
                  color: savedAs === "approved" ? "var(--success)" : "var(--danger)",
                  border: `1px solid ${savedAs === "approved" ? "var(--success-border)" : "var(--danger-border)"}`,
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
            <button onClick={onClose} aria-label={gT.miClose} disabled={submitting}
              className="bv-icon-btn w-8 h-8 rounded-full flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ color: "var(--w3)" }}>
              <XIcon size={14} strokeWidth={1.8} />
            </button>
          </div>
        </div>

        {/* ── Body ── PDF / image / "download to view" fallback */}
        <div className="flex-1" style={{ minHeight: 0, position: "relative" }}>
          {iosMode && (doc.file_name.split(".").pop() ?? "").toLowerCase() === "pdf" ? (
            // iOS PDF: native iframe straight from the server route — no blob
            // wait, no blank pdf.js canvas. Renders immediately.
            <IosPdfFrame
              src={iosPreviewUrl}
              title={doc.file_name}
              onRotate={() => {
                if (overrideFetchUrl || !doc.id) return;
                fetch(`/api/portal/documents/${doc.id}`, {
                  method: "PATCH",
                  headers: {
                    "Content-Type": "application/json",
                    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
                  },
                  body: JSON.stringify({ deltaRotation: 90 }),
                }).catch(e => console.error("[rotation] persist failed:", e));
              }}
            />
          ) : blobUrl ? (() => {
            const ext = (doc.file_name.split(".").pop() ?? "").toLowerCase();
            if (ext === "pdf") {
              const persistRotate = () => {
                // Don't persist when previewing a synthetic doc (e.g. merged PDF).
                if (overrideFetchUrl || !doc.id) return;
                fetch(`/api/portal/documents/${doc.id}`, {
                  method: "PATCH",
                  headers: {
                    "Content-Type": "application/json",
                    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
                  },
                  body: JSON.stringify({ deltaRotation: 90 }),
                }).catch(e => console.error("[rotation] persist failed:", e));
              };
              // iOS: pdf.js canvas stays blank in WebKit → native iframe,
              // loaded straight from the server route (token in query).
              return iosMode
                ? <IosPdfFrame src={iosPreviewUrl} title={doc.file_name} onRotate={persistRotate} />
                : <PdfViewer src={blobUrl} onRotate={persistRotate} />;
            }
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
                {iosMode ? (
                  <button type="button"
                    onClick={() => triggerIosDownload(iosDownloadUrl, doc.file_name)}
                    className="inline-flex items-center gap-2 px-4 py-2 text-[13px] font-semibold"
                    style={{ background: "var(--gold)", color: "#131312", borderRadius: "var(--r-sm)", border: "none" }}>
                    <Download size={13} strokeWidth={1.8} /> {dt.download}
                  </button>
                ) : (
                  <a href={blobUrl} download={doc.file_name}
                    className="inline-flex items-center gap-2 px-4 py-2 text-[13px] font-semibold"
                    style={{ background: "var(--gold)", color: "#131312", borderRadius: "var(--r-sm)" }}>
                    <Download size={13} strokeWidth={1.8} /> {dt.download}
                  </a>
                )}
              </div>
            );
          })() : (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#525659" }}>
              <Spinner size="md" />
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
