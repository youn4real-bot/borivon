"use client";

/**
 * SignRequestPanel — admin component rendered per candidate.
 *
 * Shows existing sign requests + a form to send a new PDF for signature.
 * Requires DOCUSEAL_API_KEY to be set server-side.
 */

import { useEffect, useRef, useState } from "react";
import { FilePen, Send, CheckCircle2, Clock, XCircle, Download, Plus, X as XIcon, FileUp } from "lucide-react";
import { Spinner } from "@/components/ui/states";
import { PdfZonePicker, type SigZone } from "@/components/PdfZonePicker";

type SignRequest = {
  id: string;
  document_name: string;
  note: string | null;
  status: "pending" | "signed" | "declined";
  embed_src: string | null;
  signed_at: string | null;
  signed_pdf_url: string | null;
  viewed_at: string | null;
  created_at: string;
};

const T = {
  en: {
    title:        "Signature Requests",
    send:         "Request Signature",
    docName:      "Document name",
    docNamePh:    "e.g. Recognition application form",
    note:         "Note for candidate (optional)",
    notePh:       "e.g. Please sign and return before Friday",
    uploadPdf:    "Upload PDF to sign",
    uploadChange: "Change PDF",
    submit:       "Send for signature",
    submitting:   "Sending…",
    cancel:       "Cancel",
    noRequests:   "No signature requests yet",
    statusPending: "Awaiting signature",
    statusSigned:  "Signed",
    statusDeclined:"Declined",
    download:     "Download signed copy",
    noPdfKey:     "No DOCUSEAL_API_KEY — configure it in Vercel env vars",
    errDocName:   "Document name required",
    errPdfRequired:"Please upload a PDF",
    errFallback:  "Error",
    dragDrop:     "drag & drop or click",
    seen:         "Seen",
    notOpened:    "Not opened yet",
  },
  fr: {
    title:        "Demandes de signature",
    send:         "Demander une signature",
    docName:      "Nom du document",
    docNamePh:    "ex. Formulaire de demande de reconnaissance",
    note:         "Note pour le candidat (optionnel)",
    notePh:       "ex. Veuillez signer et renvoyer avant vendredi",
    uploadPdf:    "Téléverser le PDF à signer",
    uploadChange: "Changer le PDF",
    submit:       "Envoyer pour signature",
    submitting:   "Envoi…",
    cancel:       "Annuler",
    noRequests:   "Aucune demande de signature",
    statusPending: "En attente de signature",
    statusSigned:  "Signé",
    statusDeclined:"Refusé",
    download:     "Télécharger la copie signée",
    noPdfKey:     "Pas de DOCUSEAL_API_KEY — configurez-le dans les variables Vercel",
    errDocName:   "Nom du document requis",
    errPdfRequired:"Veuillez téléverser un PDF",
    errFallback:  "Erreur",
    dragDrop:     "glisser-déposer ou cliquer",
    seen:         "Vu",
    notOpened:    "Pas encore ouvert",
  },
  de: {
    title:        "Signaturanfragen",
    send:         "Signatur anfordern",
    docName:      "Dokumentname",
    docNamePh:    "z.B. Anerkennungsantrag",
    note:         "Hinweis für Kandidaten (optional)",
    notePh:       "z.B. Bitte bis Freitag unterschreiben",
    uploadPdf:    "PDF zum Unterschreiben hochladen",
    uploadChange: "PDF ändern",
    submit:       "Zur Signatur senden",
    submitting:   "Senden…",
    cancel:       "Abbrechen",
    noRequests:   "Noch keine Signaturanfragen",
    statusPending: "Warte auf Unterschrift",
    statusSigned:  "Unterschrieben",
    statusDeclined:"Abgelehnt",
    download:     "Unterschriebene Kopie herunterladen",
    noPdfKey:     "Kein DOCUSEAL_API_KEY — in Vercel-Umgebungsvariablen konfigurieren",
    errDocName:   "Dokumentname erforderlich",
    errPdfRequired:"Bitte ein PDF hochladen",
    errFallback:  "Fehler",
    dragDrop:     "ziehen & ablegen oder klicken",
    seen:         "Gesehen",
    notOpened:    "Noch nicht geöffnet",
  },
} as const;
type Lang = keyof typeof T;

type Props = {
  candidateId: string;
  authToken: string;
  lang: Lang;
};

export function SignRequestPanel({ candidateId, authToken, lang }: Props) {
  const t = T[lang] ?? T.en;
  const [requests, setRequests] = useState<SignRequest[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [docName, setDocName]   = useState("");
  const [note, setNote]         = useState("");
  const [pdfFile, setPdfFile]   = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr]           = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [sigZone, setSigZone]   = useState<SigZone | null>(null);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async (signal?: AbortSignal) => {
    const res = await fetch(`/api/portal/admin/sign-request?candidateId=${candidateId}`, {
      headers: { Authorization: `Bearer ${authToken}` },
      signal,
    });
    if (res.ok) {
      const j = await res.json() as { requests: SignRequest[] };
      setRequests(j.requests ?? []);
    }
    setLoading(false);
  };

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal).catch(() => { /* abort or network */ });
    return () => ctrl.abort();
  }, [candidateId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit() {
    if (submitting) return; // double-submit guard
    setErr("");
    if (!docName.trim()) { setErr(t.errDocName); return; }
    if (!pdfFile)        { setErr(t.errPdfRequired); return; }

    setSubmitting(true);
    try {
      const base64 = await fileToBase64(pdfFile);
      const res = await fetch("/api/portal/admin/sign-request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          candidateId,
          documentName: docName.trim(),
          pdfBase64: base64,
          note: note.trim() || undefined,
          signatureZone: sigZone ?? undefined,
        }),
      });
      const j = await res.json() as { error?: string };
      if (!res.ok) { setErr(j.error ?? t.errFallback); return; }
      setShowForm(false);
      setDocName(""); setNote(""); setPdfFile(null); setPdfBase64(null); setSigZone(null);
      await load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-6 rounded-2xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3"
        style={{ background: "var(--bg2)", borderBottom: "1px solid var(--border)" }}>
        <div className="flex items-center gap-2">
          <FilePen size={13} strokeWidth={1.8} style={{ color: "var(--gold)" }} />
          <span className="text-[13px] font-semibold" style={{ color: "var(--w)" }}>{t.title}</span>
          {requests.length > 0 && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>
              {requests.length}
            </span>
          )}
        </div>
        {!showForm && (
          <button onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-1 text-[11.5px] font-semibold px-3 py-1.5 rounded-full transition-opacity hover:opacity-80"
            style={{ background: "var(--gold)", color: "#131312" }}>
            <Plus size={11} strokeWidth={2.5} />
            {t.send}
          </button>
        )}
      </div>

      {/* New request form */}
      {showForm && (
        <div className="p-4 space-y-3" style={{ background: "var(--card)", borderBottom: "1px solid var(--border)" }}>
          <div>
            <label htmlFor={`bv-sr-doc-name-${candidateId}`} className="block text-[11.5px] font-medium mb-1" style={{ color: "var(--w3)" }}>{t.docName}</label>
            <input
              id={`bv-sr-doc-name-${candidateId}`}
              value={docName}
              onChange={e => setDocName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleSubmit(); } }}
              placeholder={t.docNamePh}
              required aria-required="true"
              className="w-full px-3 py-2 text-[13px] rounded-xl outline-none"
              style={{ background: "var(--bg2)", border: "1px solid var(--border)", color: "var(--w)" }}
            />
          </div>

          <div>
            <label htmlFor={`bv-sr-note-${candidateId}`} className="block text-[11.5px] font-medium mb-1" style={{ color: "var(--w3)" }}>{t.note}</label>
            <input
              id={`bv-sr-note-${candidateId}`}
              value={note}
              onChange={e => setNote(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleSubmit(); } }}
              placeholder={t.notePh}
              className="w-full px-3 py-2 text-[13px] rounded-xl outline-none"
              style={{ background: "var(--bg2)", border: "1px solid var(--border)", color: "var(--w)" }}
            />
          </div>

          {/* PDF upload — click or drag & drop */}
          <div>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={async e => {
                const f = e.target.files?.[0] ?? null;
                setPdfFile(f);
                if (f) setPdfBase64(await fileToBase64(f));
                else setPdfBase64(null);
              }}
            />
            <div
              role="button"
              tabIndex={0}
              aria-label={t.uploadPdf}
              onClick={() => fileRef.current?.click()}
              onKeyDown={e => {
                // Both Enter and Space activate buttons per WAI-ARIA.
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileRef.current?.click();
                }
              }}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={async e => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f?.type === "application/pdf") {
                  setPdfFile(f);
                  setPdfBase64(await fileToBase64(f));
                }
              }}
              className="w-full flex flex-col items-center justify-center gap-1.5 px-3 py-4 rounded-xl text-[12.5px] font-medium cursor-pointer transition-all"
              style={{
                background: dragOver ? "var(--gdim)" : pdfFile ? "var(--success-bg)" : "var(--bg2)",
                border: `1.5px dashed ${dragOver ? "var(--gold)" : pdfFile ? "var(--success)" : "var(--border)"}`,
                color: dragOver ? "var(--gold)" : pdfFile ? "var(--success)" : "var(--w3)",
                transform: dragOver ? "scale(1.01)" : "none",
              }}
            >
              {pdfFile ? (
                <>
                  <CheckCircle2 size={16} strokeWidth={2} />
                  <span className="truncate max-w-full px-2">{pdfFile.name}</span>
                  <span className="text-[10.5px] opacity-60">{t.uploadChange}</span>
                </>
              ) : (
                <>
                  <FileUp size={18} strokeWidth={1.6} />
                  <span>{t.uploadPdf}</span>
                  <span className="text-[10.5px] opacity-50">{t.dragDrop}</span>
                </>
              )}
            </div>
          </div>

          {/* Zone picker — shown after PDF is selected */}
          {pdfBase64 && (
            <PdfZonePicker
              pdfBase64={pdfBase64}
              onChange={z => setSigZone(z)}
            />
          )}

          {err && <p className="text-[12px]" style={{ color: "var(--error, #e03030)" }}>{err}</p>}

          <div className="flex gap-2">
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[13px] font-semibold transition-opacity disabled:opacity-60"
              style={{ background: "var(--gold)", color: "#131312" }}
            >
              {submitting ? <Spinner size="xs" color="#131312" /> : <Send size={13} strokeWidth={2} />}
              {submitting ? t.submitting : t.submit}
            </button>
            <button
              onClick={() => { setShowForm(false); setErr(""); setDocName(""); setNote(""); setPdfFile(null); setPdfBase64(null); setSigZone(null); }}
              className="px-4 py-2.5 rounded-xl text-[13px] font-medium transition-opacity hover:opacity-70"
              style={{ background: "var(--bg2)", color: "var(--w3)", border: "1px solid var(--border)" }}
            >
              <XIcon size={14} strokeWidth={2} />
            </button>
          </div>
        </div>
      )}

      {/* Request list */}
      <div style={{ background: "var(--card)" }}>
        {loading ? (
          <div className="flex justify-center py-6"><Spinner size="sm" /></div>
        ) : requests.length === 0 ? (
          <p className="text-center text-[12.5px] py-6" style={{ color: "var(--w3)" }}>{t.noRequests}</p>
        ) : (
          <div className="divide-y" style={{ borderColor: "var(--border)" }}>
            {requests.map(r => (
              <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                {/* Status icon */}
                {r.status === "signed"
                  ? <CheckCircle2 size={15} strokeWidth={2} style={{ color: "var(--success)", flexShrink: 0 }} />
                  : r.status === "declined"
                  ? <XCircle size={15} strokeWidth={2} style={{ color: "var(--w3)", flexShrink: 0 }} />
                  : <Clock size={15} strokeWidth={1.8} style={{ color: "var(--gold)", flexShrink: 0 }} />
                }
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium truncate" style={{ color: "var(--w)" }}>{r.document_name}</p>
                  <p className="text-[11px] mt-0.5 flex items-center gap-1.5" style={{
                    color: r.status === "signed" ? "var(--success)" : r.status === "declined" ? "var(--w3)" : "var(--gold)",
                  }}>
                    {r.status === "signed" ? t.statusSigned : r.status === "declined" ? t.statusDeclined : t.statusPending}
                    {r.signed_at && ` · ${new Date(r.signed_at).toLocaleDateString()}`}
                    {r.status === "pending" && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                        style={{
                          background: r.viewed_at ? "var(--success-bg)" : "rgba(255,255,255,0.06)",
                          color: r.viewed_at ? "var(--success)" : "var(--w3)",
                          border: `1px solid ${r.viewed_at ? "var(--success-border)" : "var(--border)"}`,
                        }}>
                        {r.viewed_at ? `${t.seen} ${new Date(r.viewed_at).toLocaleDateString()}` : t.notOpened}
                      </span>
                    )}
                  </p>
                </div>
                {r.signed_pdf_url && (
                  <a href={r.signed_pdf_url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full transition-opacity hover:opacity-80"
                    style={{ background: "var(--success-bg)", color: "var(--success)", border: "1px solid var(--success-border)" }}>
                    <Download size={10} strokeWidth={2} />
                    {t.download}
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the data:...;base64, prefix — docuseal.ts adds it back
      resolve(result.replace(/^data:[^;]+;base64,/, ""));
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
