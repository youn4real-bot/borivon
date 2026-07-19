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
  id: string; name: string; photo: string | null; verified: boolean;
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

  return (
    <main className="mx-auto px-5 py-10 sm:py-14" style={{ maxWidth: 920 }}>
      <header className="mb-7">
        {c.agency && <p className="text-[12px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--gold)" }}>{c.agency}</p>}
        <h1 className="text-[26px] font-bold leading-tight" style={{ color: "var(--w)" }}>{c.title}</h1>
        {c.note && <p className="mt-2 text-[14px] whitespace-pre-wrap" style={{ color: "var(--w2)" }}>{c.note}</p>}
        <p className="mt-3 text-[12.5px]" style={{ color: "var(--w3)" }}>
          {c.candidates.length} {T("candidate(s) proposed for your review.", "Kandidat(en) zur Prüfung vorgeschlagen.", "candidat(s) proposé(s) pour votre examen.")}
        </p>
      </header>

      {c.candidates.length === 0 ? (
        <p className="text-center py-16 text-[14px]" style={{ color: "var(--w3)" }}>{T("No candidates on this list yet.", "Noch keine Kandidaten auf dieser Liste.", "Aucun candidat sur cette liste.")}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          {c.candidates.map((cand, i) => {
            const b2Passed = cand.b2Stage === "passed";
            return (
              <div key={cand.id || i} className="p-4" style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r-xl)" }}>
                <div className="flex items-center gap-3">
                  {cand.photo
                    ? <img src={cand.photo} alt="" className="w-12 h-12 rounded-full object-cover flex-shrink-0" />
                    : <div className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 text-[15px] font-bold" style={{ background: "var(--bg2)", color: "var(--w3)" }}>{cand.name.charAt(0).toUpperCase()}</div>}
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold truncate flex items-center gap-1.5" style={{ color: "var(--w)" }}>
                      {cand.name}
                      {cand.verified && <ShieldCheck size={14} style={{ color: "#16a34a" }} />}
                    </p>
                    <p className="text-[12px] truncate" style={{ color: "var(--w3)" }}>{label(cand) || T("Nurse", "Pflegekraft", "Infirmier·ère")}</p>
                  </div>
                </div>

                {cand.adminNote && <p className="mt-2.5 text-[12px] italic" style={{ color: "var(--w2)" }}>“{cand.adminNote}”</p>}

                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px]" style={{ color: "var(--w2)" }}>
                  {cand.yearsExperience != null && <span>{cand.yearsExperience} {T("yrs experience", "J. Erfahrung", "ans d'expérience")}</span>}
                  {cand.b2Stage && (
                    <span style={b2Passed ? { color: "#16a34a", fontWeight: 600 } : undefined}>
                      B2: {b2StageLabel(normalizeB2Stage(cand.b2Stage), lang)}
                    </span>
                  )}
                  <span>{cand.docsOk}/{cand.docCount} {T("documents ready", "Dokumente bereit", "documents prêts")}</span>
                  {cand.hasCvDraft && <span className="inline-flex items-center gap-1" style={{ color: "#16a34a" }}><Check size={11} strokeWidth={3} /> CV</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <footer className="mt-10 pt-5 text-center text-[11px]" style={{ borderTop: "1px solid var(--border)", color: "var(--w3)" }}>
        {T("Shared securely via Borivon", "Sicher geteilt über Borivon", "Partagé en toute sécurité via Borivon")}
      </footer>
    </main>
  );
}
