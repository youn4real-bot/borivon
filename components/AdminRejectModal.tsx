"use client";

import { useState } from "react";
import { XCircle } from "@/components/PortalIcons";
import { X as XIcon, Plus, Trash2 } from "lucide-react";
import { useLang } from "@/components/LangContext";

const RM_T = {
  fr: { title: "Rejeter le document", feedback: "Commentaire (obligatoire)", feedbackPh: "Qu'est-ce qui ne va pas ? Le candidat verra ce message.", screenshot: "Capture d'écran (optionnel)", attach: "Joindre une image", remove: "Retirer la capture d'écran", cancel: "Annuler", reject: "Rejeter", tooBig: "Capture trop grande. Max ~600 Ko." },
  en: { title: "Reject document",      feedback: "Feedback (required)",      feedbackPh: "What's wrong with this document? Shown to the candidate.", screenshot: "Screenshot (optional)", attach: "Attach image",          remove: "Remove screenshot",       cancel: "Cancel",   reject: "Reject", tooBig: "Screenshot too large. Max ~600KB." },
  de: { title: "Dokument ablehnen",    feedback: "Feedback (erforderlich)",  feedbackPh: "Was stimmt mit diesem Dokument nicht? Wird dem Kandidaten gezeigt.", screenshot: "Screenshot (optional)", attach: "Bild anhängen",         remove: "Screenshot entfernen",    cancel: "Abbrechen", reject: "Ablehnen", tooBig: "Screenshot zu groß. Max. ~600 KB." },
} as const;

export type RejectTarget = {
  label: string;            // shown as subtitle (e.g. doc type or filename)
  initialFeedback?: string; // pre-fill textarea
};

/**
 * Standalone reject-feedback popup.
 *
 * Pure UI: collects optional feedback text + optional screenshot data URL,
 * then hands both to the caller via `onSubmit`. The caller is responsible for
 * calling the right API (doc / passport / etc.) and posting the screenshot
 * as an admin message if desired. This way the same popup is reused
 * everywhere (admin page rows, PDF preview modal, anywhere else).
 */
export function AdminRejectModal({
  target, onCancel, onSubmit,
}: {
  target: RejectTarget;
  onCancel: () => void;
  onSubmit: (feedback: string, screenshotDataUrl: string | null) => Promise<void>;
}) {
  const { lang, t: gT } = useLang();
  const t = RM_T[(lang as "fr" | "en" | "de") in RM_T ? (lang as "fr" | "en" | "de") : "en"];
  const [text, setText] = useState(target.initialFeedback ?? "");
  const [shot, setShot] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function pickShot(file: File | null) {
    if (!file) { setShot(null); return; }
    if (!file.type.startsWith("image/")) return;
    if (file.size > 600_000) { alert(t.tooBig); return; }
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === "string") setShot(reader.result); };
    reader.readAsDataURL(file);
  }

  async function handleSubmit() {
    if (submitting || !text.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit(text.trim(), shot);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-x-0 bottom-0 top-[58px] z-[800] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)", animation: "bvFadeRise .22s var(--ease-out)" }}
      onClick={() => { if (!submitting) onCancel(); }}>
      <div className="w-full max-w-md overflow-hidden flex flex-col"
        style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-md)" }}
        onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid var(--border)" }}>
          <div className="min-w-0">
            <p className="text-[13.5px] font-semibold tracking-tight" style={{ color: "var(--w)" }}>{t.title}</p>
            <p className="text-[11.5px] mt-0.5 truncate" style={{ color: "var(--w3)" }}>{target.label}</p>
          </div>
          <button onClick={onCancel} disabled={submitting} aria-label={gT.miClose}
            className="bv-icon-btn w-8 h-8 flex items-center justify-center rounded-full disabled:opacity-40"
            style={{ color: "var(--w2)" }}>
            <XIcon size={14} strokeWidth={1.8} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--w3)" }}>{t.feedback}</label>
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder={t.feedbackPh}
              rows={3}
              className="mt-1.5 w-full rounded-lg px-3 py-2 text-[13px] outline-none resize-none"
              style={{ background: "var(--bg2)", border: "1px solid var(--border2)", color: "var(--w)" }}
            />
          </div>
          <div>
            <label className="text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--w3)" }}>{t.screenshot}</label>
            {!shot ? (
              <label className="mt-1.5 flex items-center justify-center gap-2 rounded-lg px-3 py-3 cursor-pointer text-[12px]"
                style={{ background: "var(--bg2)", border: "1px dashed var(--border2)", color: "var(--w3)" }}>
                <Plus size={13} strokeWidth={1.8} /> {t.attach}
                <input type="file" accept="image/*" className="hidden"
                  onChange={e => pickShot(e.target.files?.[0] ?? null)} />
              </label>
            ) : (
              <div className="mt-1.5 relative">
                <img src={shot} alt={t.screenshot} className="w-full rounded-lg" style={{ border: "1px solid var(--border)", maxHeight: 200, objectFit: "contain", background: "var(--bg2)" }} />
                <button onClick={() => setShot(null)} aria-label={t.remove}
                  className="absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center"
                  style={{ background: "rgba(0,0,0,0.6)", color: "#fff" }}>
                  <Trash2 size={12} strokeWidth={1.8} />
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-3 flex items-center justify-end gap-2" style={{ borderTop: "1px solid var(--border)", background: "var(--bg2)" }}>
          <button onClick={onCancel} disabled={submitting}
            className="px-3 py-1.5 rounded-lg text-[12px] font-medium disabled:opacity-40"
            style={{ background: "transparent", color: "var(--w2)" }}>
            {t.cancel}
          </button>
          <button onClick={handleSubmit} disabled={submitting || !text.trim()}
            className="px-3 py-1.5 rounded-lg text-[12px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-40"
            style={{ background: "var(--danger-bg)", color: "var(--danger)", border: "1px solid var(--danger-border)" }}>
            {submitting ? "…" : <><XCircle size={12} strokeWidth={1.8} /> {t.reject}</>}
          </button>
        </div>
      </div>
    </div>
  );
}
