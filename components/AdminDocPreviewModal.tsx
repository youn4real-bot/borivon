"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, XCircle } from "@/components/PortalIcons";
import { X as XIcon, Download } from "lucide-react";
import { AdminRejectModal } from "@/components/AdminRejectModal";
import { PdfViewer } from "@/components/PdfViewer";
import { Spinner } from "@/components/ui/states";

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
}: {
  doc: Doc;
  accessToken: string;
  onClose: () => void;
  onUpdated?: (doc: Doc) => void;
  noPreviewText?: string;
}) {
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
        setActionError("Failed to approve — please try again.");
      }
    } catch {
      setActionError("Network error — please try again.");
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
        setActionError("Failed to reject — please try again.");
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
   <div className="fixed inset-x-0 bottom-0 top-[58px] z-[700] flex items-center justify-center p-4 bv-doc-preview-outer"
      style={{ background: "rgba(0,0,0,0.72)" }}
      onClick={() => { if (!submitting) onClose(); }}>
      {/* On mobile the bottom action bar sits ~72px above the screen edge —
          shrink the card so it never slides behind it. Desktop unchanged. */}
      <style>{`
        @media (max-width: 639.98px) {
          .bv-doc-preview-outer { padding-bottom: calc(1rem + 72px) !important; }
          .bv-doc-preview-card  {
            height: calc(100dvh - 58px - 1rem - 72px - 1rem) !important;
            max-height: calc(100dvh - 58px - 1rem - 72px - 1rem) !important;
          }
        }
      `}</style>
      <div className="bv-doc-preview-card w-full max-w-4xl overflow-hidden flex flex-col"
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
            {blobUrl && (
              <a
                href={blobUrl}
                download={doc.file_name}
                title="Download" aria-label="Download"
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
                  ? <><CheckCircle2 size={13} strokeWidth={1.8} /> Approved</>
                  : <><XCircle size={13} strokeWidth={1.8} /> Rejected</>}
              </span>
            )}
            {canReview && (
              <>
                <button onClick={() => setRejectOpen(true)} disabled={submitting}
                  title="Reject" aria-label="Reject"
                  className="bv-icon-btn bv-icon-btn--reject w-9 h-9 rounded-full flex items-center justify-center disabled:opacity-40">
                  <XCircle size={15} strokeWidth={1.8} />
                </button>
                <button onClick={approve} disabled={submitting}
                  title="Approve" aria-label="Approve"
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

        {/* ── Body ── Custom PDF.js viewer (same engine as Drive, but in our DOM) */}
        <div className="flex-1" style={{ minHeight: 0, position: "relative" }}>
          {blobUrl
            ? <PdfViewer src={blobUrl} />
            : doc.drive_file_id
              ? <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#525659" }}>
                  <Spinner size="md" />
                </div>
              : <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <p className="text-sm" style={{ color: "var(--w3)" }}>{noPreviewText}</p>
                </div>}
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
