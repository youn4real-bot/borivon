"use client";

/**
 * PUBLIC, login-less one-time upload page: borivon.com/u/<token>.
 * - If the candidate is ALREADY logged in → send them to the real portal (the
 *   normal experience with nav / messages / notifications). LAW #1-safe: this is a
 *   page-level redirect, not chrome gating.
 * - Otherwise show a clean, portal-matching card (real Borivon wordmark) with ONLY
 *   the first name + the requested doc(s) and a clean uploader (Uppy engine).
 * - After the requested doc(s) are uploaded → the link dies and the candidate is
 *   routed into the portal.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import { CheckCircle2, Loader2, ShieldAlert, UploadCloud } from "lucide-react";

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

function Wordmark() {
  return (
    <div style={{ textAlign: "center", marginBottom: 20 }}>
      <span style={{ fontFamily: "var(--font-dm-serif), Georgia, serif", fontStyle: "italic", fontSize: 26, letterSpacing: "-0.01em", color: "var(--w)" }}>
        Borivon<span style={{ color: "var(--gold)", fontStyle: "normal" }}>.</span>
      </span>
    </div>
  );
}

export default function UploadLinkPage() {
  const token = String(useParams()?.token ?? "");
  const router = useRouter();
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

  const [state, setState] = useState<"checking" | "ok" | "notfound">("checking");
  const [firstName, setFirstName] = useState("");
  const [docs, setDocs] = useState<Doc[]>([]);

  // 1) Logged-in candidate → straight to the real portal (normal chrome). Else resolve the link.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) { router.replace("/portal/dashboard"); return; }
      } catch { /* not logged in → continue */ }
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
  }, [token, router]);

  const markDone = useCallback((key: string) => {
    setDocs((prev) => prev.map((d) => (d.key === key ? { ...d, uploaded: true } : d)));
  }, []);

  const allDone = docs.length > 0 && docs.every((d) => d.uploaded);

  // 2) Once everything's in, the link is spent → route into the portal.
  useEffect(() => {
    if (!allDone) return;
    const t = setTimeout(() => router.push("/portal"), 2400);
    return () => clearTimeout(t);
  }, [allDone, router]);

  const cardStyle: React.CSSProperties = { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 20, padding: 22, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" };

  return (
    <main style={{ minHeight: "100dvh", background: "var(--bg2)", color: "var(--w)", display: "flex", justifyContent: "center", padding: "28px 16px" }}>
      <div style={{ width: "100%", maxWidth: 460 }}>
        <Wordmark />

        {state === "checking" && (
          <div style={{ display: "flex", justifyContent: "center", padding: "60px 0", color: "var(--w3)" }}>
            <Loader2 size={22} className="animate-spin" />
          </div>
        )}

        {state === "notfound" && (
          <div style={{ ...cardStyle, textAlign: "center", padding: 28 }}>
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
          <div style={cardStyle}>
            {allDone ? (
              <div style={{ textAlign: "center", padding: "22px 0" }}>
                <span style={{ display: "inline-flex", width: 52, height: 52, borderRadius: 999, alignItems: "center", justifyContent: "center", background: "var(--success-bg)", color: "var(--success)", marginBottom: 12 }}>
                  <CheckCircle2 size={26} />
                </span>
                <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>{T("All done — thank you!", "Terminé — merci !", "Fertig — vielen Dank!")}</p>
                <p style={{ fontSize: 13, color: "var(--w3)", display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <Loader2 size={13} className="animate-spin" /> {T("Taking you to the portal…", "Redirection vers le portail…", "Weiterleitung zum Portal…")}
                </p>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <UploadCloud size={18} style={{ color: "var(--gold)" }} />
                  <h1 style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em" }}>
                    {firstName ? T(`Hi ${firstName}`, `Bonjour ${firstName}`, `Hallo ${firstName}`) : T("Hello", "Bonjour", "Hallo")}
                  </h1>
                </div>
                <p style={{ fontSize: 13, color: "var(--w3)", marginBottom: 18, lineHeight: 1.5 }}>
                  {T("Please upload the document(s) below — a photo or a PDF is fine.",
                     "Merci de téléverser le(s) document(s) ci-dessous — une photo ou un PDF convient.",
                     "Bitte laden Sie das/die Dokument(e) unten hoch — ein Foto oder PDF genügt.")}
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
                        <p style={{ fontSize: 12.5, color: "var(--success)", paddingLeft: 24 }}>{T("Received ✓", "Reçu ✓", "Erhalten ✓")}</p>
                      ) : (
                        <DocUploader token={token} docKey={d.key} lang={lang} onDone={() => markDone(d.key)} />
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
