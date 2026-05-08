"use client";

import { FilePen, CheckCircle2, Clock } from "lucide-react";
import { PdfSignModal, type SignRequestFull } from "@/components/PdfSignModal";
import { useEffect, useState } from "react";

const T = {
  en: { title: "Documents to sign", sign: "Sign now", signed: "Signed", note: "Note:" },
  fr: { title: "Documents à signer",  sign: "Signer",    signed: "Signé",  note: "Note :" },
  de: { title: "Zu unterschreibende Dokumente", sign: "Unterschreiben", signed: "Unterschrieben", note: "Hinweis:" },
} as const;
type Lang = keyof typeof T;

type Props = {
  requests:  SignRequestFull[];
  lang:      Lang;
  authToken: string;
  onSigned?: (id: string) => void;
  /** When set, auto-opens the matching sign request in PdfSignModal. */
  autoOpenId?: string | null;
  onAutoOpenConsumed?: () => void;
};

export function PendingSignatures({ requests, lang, authToken, onSigned, autoOpenId, onAutoOpenConsumed }: Props) {
  const t = T[lang] ?? T.en;
  const [active, setActive] = useState<SignRequestFull | null>(null);

  // Auto-open the requested sign request (e.g. arriving from a bell deep-link)
  useEffect(() => {
    if (!autoOpenId) return;
    const r = requests.find(x => x.id === autoOpenId && x.status === "pending");
    if (r) {
      setActive(r);
      onAutoOpenConsumed?.();
    }
  }, [autoOpenId, requests, onAutoOpenConsumed]);

  const pending = requests.filter(r => r.status === "pending");
  const signed  = requests.filter(r => r.status === "signed");

  if (requests.length === 0) return null;

  return (
    <>
      <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid var(--border-gold)" }}>
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3"
          style={{ background: "var(--gdim)", borderBottom: pending.length > 0 ? "1px solid var(--border-gold)" : "none" }}>
          <FilePen size={14} strokeWidth={1.8} style={{ color: "var(--gold)" }} />
          <span className="text-[13.5px] font-semibold" style={{ color: "var(--gold)" }}>{t.title}</span>
          {pending.length > 0 && (
            <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ background: "var(--gold)", color: "#131312" }}>
              {pending.length}
            </span>
          )}
        </div>

        {pending.map(r => (
          <div key={r.id} className="flex items-center gap-3 px-4 py-3.5"
            style={{ background: "var(--card)", borderBottom: "1px solid var(--border)" }}>
            <Clock size={15} strokeWidth={1.8} style={{ color: "var(--gold)", flexShrink: 0 }} />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold" style={{ color: "var(--w)" }}>{r.document_name}</p>
              {r.note && (
                <p className="text-[11.5px] mt-0.5" style={{ color: "var(--w3)" }}>
                  <span style={{ color: "var(--gold)", fontWeight: 600 }}>{t.note} </span>{r.note}
                </p>
              )}
            </div>
            <button
              onClick={() => setActive(r)}
              className="flex-shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12px] font-semibold transition-all hover:opacity-85 active:scale-[0.97]"
              style={{ background: "var(--gold)", color: "#131312" }}>
              <FilePen size={12} strokeWidth={2} />
              {t.sign}
            </button>
          </div>
        ))}

        {signed.map(r => (
          <div key={r.id} className="flex items-center gap-3 px-4 py-3"
            style={{ background: "var(--card)", borderBottom: "1px solid var(--border)", opacity: 0.7 }}>
            <CheckCircle2 size={15} strokeWidth={2} style={{ color: "var(--success)", flexShrink: 0 }} />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium" style={{ color: "var(--w)" }}>{r.document_name}</p>
              <p className="text-[11px] mt-0.5" style={{ color: "var(--success)" }}>
                {t.signed}{r.signed_at ? ` · ${new Date(r.signed_at).toLocaleDateString()}` : ""}
              </p>
            </div>
          </div>
        ))}
      </div>

      {active && (
        <PdfSignModal
          request={active}
          lang={lang}
          authToken={authToken}
          onSigned={id => { onSigned?.(id); setActive(null); }}
          onClose={() => setActive(null)}
        />
      )}
    </>
  );
}
