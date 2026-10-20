"use client";

/**
 * PUBLIC read-only shortlist view — the employer opens this by link, no login.
 * Fetches /api/portal/shortlist/<token> (only resolves a 'shared' shortlist) and
 * renders summary cards. Shows NO contact details, NO documents — just enough for
 * the employer to say "yes, interview these".
 */
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useLang } from "@/components/LangContext";
import { PageLoader } from "@/components/ui/states";
import { specialtyLabel } from "@/lib/nurseSpecialties";
import { b2StageLabel, normalizeB2Stage } from "@/lib/b2Journey";
import { Check, ShieldCheck } from "lucide-react";

type Cand = {
  name: string; photo: string | null; verified: boolean;
  nationality: string | null; city: string | null; profession: string | null;
  b2Stage: string | null; yearsExperience: number | null;
  docCount: number; docsOk: number; docsPending: number; hasCvDraft: boolean; adminNote: string;
};
type Data = { title: string; note: string; agency: string | null; candidates: Cand[] };

export default function PublicShortlistPage() {
  const params = useParams();
  const token = String(params?.token ?? "");
  const { lang } = useLang();
  const T = (en: string, de: string, fr: string) => (lang === "de" ? de : lang === "fr" ? fr : en);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Data | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/portal/shortlist/${token}`);
        if (!res.ok) { if (!cancelled) setNotFound(true); return; }
        const j = await res.json();
        if (!cancelled) setData(j as Data);
      } catch { if (!cancelled) setNotFound(true); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [token]);

  if (loading) return <PageLoader />;

  if (notFound || !data) {
    return (
      <main className="mx-auto px-5 py-24 text-center" style={{ maxWidth: 520 }}>
        <h1 className="text-[20px] font-semibold mb-2" style={{ color: "var(--w)" }}>{T("Link not available", "Link nicht verfügbar", "Lien indisponible")}</h1>
        <p className="text-[14px]" style={{ color: "var(--w3)" }}>{T("This shortlist link is invalid or is no longer being shared.", "Dieser Link ist ungültig oder wird nicht mehr geteilt.", "Ce lien est invalide ou n'est plus partagé.")}</p>
      </main>
    );
  }

  const c = data;
  const label = (cand: Cand) => [
    cand.profession ? specialtyLabel(cand.profession, lang) : "",
    cand.nationality || "",
    cand.city || "",
  ].filter(Boolean).join(" · ");
  const initials = (n: string) => (n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w.charAt(0)).join("") || n.charAt(0)).toUpperCase();
  const b2Count = c.candidates.filter((x) => x.b2Stage === "passed").length;
  const docsReady = c.candidates.filter((x) => x.docCount > 0 && x.docsOk === x.docCount).length;

  return (
    <main className="mx-auto px-5 pt-24 pb-14 sm:pt-28" style={{ maxWidth: 920 }}>
      {/* The employer's first look at the nurses: same language as borivon.com
          (glass windows, initials, thin gold threads) and ONE next step. */}
      <header className="mb-7">
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] mb-2" style={{ color: "var(--gold)" }}>
          {c.agency || T("Your shortlist", "Ihre Auswahl", "Votre sélection")}
        </p>
        <h1 className="text-[28px] sm:text-[32px] font-semibold leading-tight tracking-[-0.015em]" style={{ color: "var(--w)" }}>{c.title}</h1>
        {c.note && <p className="mt-2 text-[14px] whitespace-pre-wrap" style={{ color: "var(--w2)" }}>{c.note}</p>}
      </header>

      {c.candidates.length > 0 && (
        <div className="mb-6 grid grid-cols-3 gap-px overflow-hidden" style={{ background: "var(--card)", borderRadius: "22px" }}>
          {([
            [String(c.candidates.length), T("nurses for you", "Pflegekräfte für Sie", "infirmières pour vous")],
            [`${b2Count}/${c.candidates.length}`, T("German B2 passed", "Deutsch B2 bestanden", "allemand B2 réussi")],
            [`${docsReady}/${c.candidates.length}`, T("papers complete", "Unterlagen komplett", "dossiers complets")],
          ] as const).map(([v, l]) => (
            <div key={l} className="px-4 py-4 text-center">
              <p className="text-[22px] font-semibold tabular-nums" style={{ color: "var(--w)" }}>{v}</p>
              <p className="mt-0.5 text-[11px] uppercase tracking-[0.1em]" style={{ color: "var(--w3)" }}>{l}</p>
            </div>
          ))}
        </div>
      )}

      {c.candidates.length === 0 ? (
        <p className="text-center py-16 text-[14px]" style={{ color: "var(--w3)" }}>{T("No candidates on this list yet.", "Noch keine Kandidaten auf dieser Liste.", "Aucun candidat sur cette liste.")}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          {c.candidates.map((cand, i) => {
            const b2Passed = cand.b2Stage === "passed";
            const docPct = cand.docCount ? Math.round((cand.docsOk / cand.docCount) * 100) : 0;
            return (
              <div key={i} className="p-5" style={{ background: "var(--card)", borderRadius: "22px" }}>
                <div className="flex items-center gap-3">
                  {cand.photo
                    ? <img src={cand.photo} alt="" className="w-12 h-12 rounded-full object-cover flex-shrink-0" />
                    : <div className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 text-[13px] font-medium tracking-[0.04em]"
                        style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>{initials(cand.name)}</div>}
                  <div className="min-w-0">
                    <p className="text-[15px] font-medium truncate flex items-center gap-1.5" style={{ color: "var(--w)" }}>
                      {cand.name}
                      {cand.verified && <ShieldCheck size={14} style={{ color: "#16a34a" }} />}
                    </p>
                    <p className="text-[12px] truncate" style={{ color: "var(--w3)" }}>{label(cand) || T("Nurse", "Pflegekraft", "Infirmier·ère")}</p>
                  </div>
                </div>

                {cand.adminNote && <p className="mt-3 text-[12.5px] italic" style={{ color: "var(--w2)" }}>“{cand.adminNote}”</p>}

                <div className="mt-4 grid gap-2.5" style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
                  {cand.yearsExperience != null && (
                    <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
                      <span style={{ color: "var(--w3)" }}>{T("Experience", "Erfahrung", "Expérience")}</span>
                      <span style={{ color: "var(--w)" }}>{cand.yearsExperience} {T("years", "Jahre", "ans")}</span>
                    </div>
                  )}
                  {cand.b2Stage && (
                    <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
                      <span style={{ color: "var(--w3)" }}>{T("German", "Deutsch", "Allemand")} B2</span>
                      <span className="inline-flex items-center gap-1" style={{ color: b2Passed ? "#16a34a" : "var(--w)" }}>
                        {b2Passed && <Check size={12} strokeWidth={3} />}{b2StageLabel(normalizeB2Stage(cand.b2Stage), lang)}
                      </span>
                    </div>
                  )}
                  <div className="grid gap-1.5">
                    <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
                      <span style={{ color: "var(--w3)" }}>{T("Papers ready", "Unterlagen bereit", "Dossier prêt")}</span>
                      <span className="tabular-nums" style={{ color: docPct === 100 ? "#16a34a" : "var(--w)" }}>{cand.docsOk}/{cand.docCount}</span>
                    </div>
                    <span className="block h-[3px] rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
                      <span className="block h-full rounded-full"
                        style={{ width: `${docPct}%`, background: docPct === 100 ? "#16a34a" : "linear-gradient(90deg, rgba(201,162,64,0.5), var(--gold))" }} />
                    </span>
                  </div>
                  {cand.hasCvDraft && (
                    <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
                      <span style={{ color: "var(--w3)" }}>{T("German CV", "Deutscher Lebenslauf", "CV allemand")}</span>
                      <span className="inline-flex items-center gap-1" style={{ color: "#16a34a" }}><Check size={12} strokeWidth={3} /> {T("ready", "fertig", "prêt")}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* The one next step: talk to these nurses. */}
      {c.candidates.length > 0 && (
        <div className="mt-8 p-6 sm:p-7 flex flex-col sm:flex-row sm:items-center gap-4" style={{ background: "var(--card)", borderRadius: "22px" }}>
          <div className="flex-1 min-w-0">
            <p className="text-[16px] font-medium" style={{ color: "var(--w)" }}>{T("Want to meet them?", "Möchten Sie sie kennenlernen?", "Vous voulez les rencontrer ?")}</p>
            <p className="mt-1 text-[13px]" style={{ color: "var(--w3)" }}>{T("Book a short call. We set up the video interviews for you.", "Buchen Sie ein kurzes Gespräch. Wir planen die Video-Interviews für Sie.", "Réservez un court appel. Nous organisons les entretiens vidéo pour vous.")}</p>
          </div>
          <a href="/book/clinic" className="bv-btn bv-btn-primary inline-flex justify-center flex-shrink-0">
            {T("Plan interviews", "Interviews planen", "Planifier les entretiens")}
          </a>
        </div>
      )}

      <footer className="mt-10 pt-5 text-center text-[11px]" style={{ borderTop: "1px solid var(--border)", color: "var(--w3)" }}>
        {T("Shared securely via Borivon", "Sicher geteilt über Borivon", "Partagé en toute sécurité via Borivon")}
      </footer>
    </main>
  );
}
