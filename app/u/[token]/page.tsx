"use client";

/**
 * PUBLIC, login-less one-time upload page: borivon.com/u/<token>.
 * Shows ONLY the candidate's first name + the exact doc(s) requested — no dossier,
 * no other data. Each doc gets its own Uppy uploader. Chrome is suppressed for /u
 * in GlobalChrome (LAW #1, route-only). A bad/expired/used token → generic message.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";
import { useLang } from "@/components/LangContext";
import { CheckCircle2, Loader2, ShieldAlert, UploadCloud } from "lucide-react";

// Uppy touches the DOM → client-only, no SSR.
const DocUploader = dynamic(() => import("@/components/DocUploader"), { ssr: false });

const LABELS: Record<string, { fr: string; en: string; de: string }> = {
  cv_de:             { fr: "CV",                     en: "CV",                de: "Lebenslauf" },
  letter:            { fr: "Lettre de motivation",   en: "Cover letter",      de: "Motivationsschreiben" },
  langcert:          { fr: "Certificat B2",          en: "B2 certificate",    de: "B2-Zertifikat" },
  diploma:           { fr: "Diplôme",                en: "Diploma",           de: "Diplom" },
  studyprog:         { fr: "Programme d'études",     en: "Study program",     de: "Ausbildungsprogramm" },
  transcript:        { fr: "Relevé de notes",        en: "Transcript",        de: "Notenübersicht" },
  abitur:            { fr: "Abitur",                 en: "Abitur",            de: "Abitur" },
  abitur_transcript: { fr: "Relevé Abitur",          en: "Abitur transcript", de: "Abitur-Notenübersicht" },
  praktikum:         { fr: "Stage",                  en: "Internship",        de: "Praktikum" },
  workcert:          { fr: "Autorisation d'exercer", en: "Work permit",       de: "Berufserlaubnis" },
  work_experience:   { fr: "Expérience pro.",        en: "Work experience",   de: "Berufserfahrung" },
  impfung:           { fr: "Vaccination",            en: "Vaccination",       de: "Impfnachweis" },
};

type Doc = { key: string; uploaded: boolean };

export default function UploadLinkPage() {
  const token = String(useParams()?.token ?? "");
  const { lang } = useLang();
  const T = (en: string, fr: string, de: string) => (lang === "fr" ? fr : lang === "de" ? de : en);
  const docLabel = (k: string) => {
    const isTrans = k.endsWith("_de");
    const base = isTrans ? k.slice(0, -3) : k;
    const e = LABELS[base];
    const name = e ? (lang === "fr" ? e.fr : lang === "de" ? e.de : e.en) : base;
    const suffix = isTrans ? (lang === "fr" ? " (traduction)" : lang === "de" ? " (Übersetzung)" : " (translation)") : "";
    return name + suffix;
  };

  const [state, setState] = useState<"loading" | "ok" | "notfound">("loading");
  const [firstName, setFirstName] = useState("");
  const [docs, setDocs] = useState<Doc[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/portal/u/${encodeURIComponent(token)}`);
        if (!r.ok) { if (!cancelled) setState("notfound"); return; }
        const j = (await r.json()) as { firstName?: string; docs?: Doc[] };
        if (cancelled) return;
        setFirstName(j.firstName || "");
        setDocs(j.docs || []);
        setState("ok");
      } catch { if (!cancelled) setState("notfound"); }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const markDone = useCallback((key: string) => {
    setDocs((prev) => prev.map((d) => (d.key === key ? { ...d, uploaded: true } : d)));
  }, []);

  const allDone = docs.length > 0 && docs.every((d) => d.uploaded);

  return (
    <main style={{ minHeight: "100dvh", background: "var(--bg2)", color: "var(--w)", display: "flex", justifyContent: "center", padding: "24px 16px" }}>
      <div style={{ width: "100%", maxWidth: 480 }}>
        {/* Brand line — plain, no chrome */}
        <div style={{ textAlign: "center", fontWeight: 700, letterSpacing: "-0.01em", fontSize: 18, marginBottom: 18, color: "var(--gold)" }}>Borivon</div>

        {state === "loading" && (
          <div style={{ display: "flex", justifyContent: "center", padding: "60px 0", color: "var(--w3)" }}>
            <Loader2 size={22} className="animate-spin" />
          </div>
        )}

        {state === "notfound" && (
          <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 20, padding: 28, textAlign: "center" }}>
            <span style={{ display: "inline-flex", width: 48, height: 48, borderRadius: 999, alignItems: "center", justifyContent: "center", background: "var(--danger-bg)", color: "var(--danger)", marginBottom: 12 }}>
              <ShieldAlert size={22} />
            </span>
            <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{T("This link is no longer valid", "Ce lien n'est plus valide", "Dieser Link ist nicht mehr gültig")}</p>
            <p style={{ fontSize: 13, color: "var(--w3)", lineHeight: 1.5 }}>
              {T("It may have expired or already been used. Ask Borivon to send you a new one.",
                 "Il a peut-être expiré ou déjà été utilisé. Demandez à Borivon un nouveau lien.",
                 "Er ist möglicherweise abgelaufen oder wurde bereits verwendet. Bitten Sie Borivon um einen neuen Link.")}
            </p>
          </div>
        )}

        {state === "ok" && (
          <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 20, padding: 22 }}>
            {allDone ? (
              <div style={{ textAlign: "center", padding: "20px 0" }}>
                <span style={{ display: "inline-flex", width: 52, height: 52, borderRadius: 999, alignItems: "center", justifyContent: "center", background: "var(--success-bg)", color: "var(--success)", marginBottom: 12 }}>
                  <CheckCircle2 size={26} />
                </span>
                <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>{T("All done — thank you!", "Terminé — merci !", "Fertig — vielen Dank!")}</p>
                <p style={{ fontSize: 13, color: "var(--w3)" }}>{T("Borivon has received your documents.", "Borivon a bien reçu vos documents.", "Borivon hat Ihre Dokumente erhalten.")}</p>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <UploadCloud size={18} style={{ color: "var(--gold)" }} />
                  <h1 style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em" }}>
                    {firstName ? T(`Hi ${firstName}`, `Bonjour ${firstName}`, `Hallo ${firstName}`) : T("Hello", "Bonjour", "Hallo")}
                  </h1>
                </div>
                <p style={{ fontSize: 13, color: "var(--w3)", marginBottom: 16, lineHeight: 1.5 }}>
                  {T("Please upload the document(s) below. Photo or PDF is fine.",
                     "Merci de téléverser le(s) document(s) ci-dessous. Photo ou PDF.",
                     "Bitte laden Sie das/die Dokument(e) unten hoch. Foto oder PDF.")}
                </p>

                <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                  {docs.map((d) => (
                    <div key={d.key}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 13.5, fontWeight: 600 }}>
                        {d.uploaded
                          ? <CheckCircle2 size={16} style={{ color: "var(--success)" }} />
                          : <span style={{ width: 8, height: 8, borderRadius: 999, background: "var(--gold)", display: "inline-block" }} />}
                        <span>{docLabel(d.key)}</span>
                      </div>
                      {d.uploaded ? (
                        <p style={{ fontSize: 12.5, color: "var(--success)", paddingLeft: 24 }}>
                          {T("Received ✓", "Reçu ✓", "Erhalten ✓")}
                        </p>
                      ) : (
                        <DocUploader token={token} docKey={d.key} note={docLabel(d.key)} onDone={() => markDone(d.key)} />
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        <p style={{ textAlign: "center", fontSize: 11, color: "var(--w3)", marginTop: 16 }}>
          {T("Secure upload · Borivon", "Téléversement sécurisé · Borivon", "Sichere Übertragung · Borivon")}
        </p>
      </div>
    </main>
  );
}
