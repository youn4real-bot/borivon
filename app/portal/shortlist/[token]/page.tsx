"use client";

/**
 * PUBLIC read-only shortlist view — the employer opens this by link, no login.
 * Fetches /api/portal/shortlist/<token> (only resolves a 'shared' shortlist) and
 * renders summary cards. Shows NO contact details, NO documents — just enough for
 * the employer to say "yes, interview these".
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useParams } from "next/navigation";
import { useLang } from "@/components/LangContext";
import { PageLoader } from "@/components/ui/states";
import { specialtyLabel } from "@/lib/nurseSpecialties";
import { b2StageLabel, normalizeB2Stage } from "@/lib/b2Journey";
import { ShieldCheck } from "lucide-react";
import { KitStyle, Card, Dot, Empty, Pager, usePaged, type Status as KitStatus } from "@/components/fx/kit";
import { Wordmark } from "@/components/Wordmark";

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
      <main className="mx-auto px-5 text-center" style={{ maxWidth: 520, paddingTop: 140, paddingBottom: 60 }}>
        <KitStyle />
        <h1 style={{ margin: "0 0 8px", fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 32, lineHeight: 1.15, color: "var(--w)" }}>{T("Link not available", "Link nicht verfügbar", "Lien indisponible")}</h1>
        <p style={{ margin: 0, fontSize: 14, color: "var(--w3)" }}>{T("This shortlist link is invalid or is no longer being shared.", "Dieser Link ist ungültig oder wird nicht mehr geteilt.", "Ce lien est invalide ou n'est plus partagé.")}</p>
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
    <main className="mx-auto px-5" style={{ maxWidth: 920, paddingTop: 84, paddingBottom: 28 }}>
      <KitStyle />
      {/* The employer's first look at the nurses — the one design (founder 2026-11-13): paper, hairlines,
          serif names, status only as a small dot, the cards flip instead of scrolling, and ONE next step. */}
      <style>{".bvsl-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.bvsl-cta{display:flex;align-items:center;gap:16px}"
        + "@media (max-width:640px){.bvsl-grid{grid-template-columns:minmax(0,1fr)}.bvsl-cta{gap:12px}.bvsl-cta .bvsl-q{font-size:19px!important}.bvsl-h1{font-size:30px!important}"
        + ".bvsl-count{gap:4px 16px!important}.bvsl-count b{font-size:20px!important}.bvsl-count .bvsl-l{font-size:12px!important}.bvsl-ph{width:48px!important;height:58px!important;font-size:18px!important}}"}</style>
      <header style={{ marginBottom: 16 }}>
        <p style={{ margin: "0 0 8px", fontSize: 11, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--w3)" }}>
          {c.agency || T("Your shortlist", "Ihre Auswahl", "Votre sélection")}
        </p>
        <h1 className="bvsl-h1" style={{ margin: 0, fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 38, lineHeight: 1.1, letterSpacing: "-.01em", color: "var(--w)" }}>{c.title}</h1>
        {c.note && <p style={{ margin: "6px 0 0", fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap", color: "var(--w2)" }}>{c.note}</p>}
      </header>

      {/* the three numbers that matter, quiet (big serif numbers) */}
      {c.candidates.length > 0 && (
        <div className="bvsl-count" style={{ display: "flex", flexWrap: "wrap", gap: "6px 22px", marginBottom: 18 }}>
          {([
            [String(c.candidates.length), T("nurses for you", "Pflegekräfte für Sie", "infirmières pour vous")],
            [`${b2Count}/${c.candidates.length}`, T("German B2 passed", "Deutsch B2 bestanden", "allemand B2 réussi")],
            [`${docsReady}/${c.candidates.length}`, T("papers complete", "Unterlagen komplett", "dossiers complets")],
          ] as const).map(([v, l]) => (
            <span key={l} style={{ display: "inline-flex", alignItems: "baseline", gap: 7, whiteSpace: "nowrap" }}>
              <b style={{ fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 24, lineHeight: 1, color: "var(--w)", fontVariantNumeric: "tabular-nums" }}>{v}</b>
              <span className="bvsl-l" style={{ fontSize: 13, color: "var(--w3)" }}>{l}</span>
            </span>
          ))}
        </div>
      )}

      {c.candidates.length === 0 ? (
        <Card><Empty>{T("No candidates on this list yet.", "Noch keine Kandidaten auf dieser Liste.", "Aucun candidat sur cette liste.")}</Empty></Card>
      ) : (
        <NurseCards cands={c.candidates} lang={lang} T={T} label={label} initials={initials} />
      )}

      {/* The one next step: talk to these nurses. */}
      {c.candidates.length > 0 && (
        <div className="bvsl-cta" style={{ marginTop: 16, padding: "16px 0 0", borderTop: "1px solid var(--border)" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="bvsl-q" style={{ margin: 0, fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 22, lineHeight: 1.2, color: "var(--w)" }}>{T("Want to meet them?", "Möchten Sie sie kennenlernen?", "Vous voulez les rencontrer ?")}</p>
            <p style={{ margin: "3px 0 0", fontSize: 13, color: "var(--w3)" }}>{T("Book a short call — we set up the video interviews.", "Kurzes Gespräch buchen — wir planen die Video-Interviews.", "Réservez un court appel — nous organisons les entretiens vidéo.")}</p>
          </div>
          <a href="/book/clinic" className="bvk-btn bvk-primary" style={{ flex: "none" }}>
            {T("Plan interviews", "Interviews planen", "Planifier les entretiens")}
          </a>
        </div>
      )}

      <footer style={{ marginTop: 18, display: "flex", alignItems: "baseline", justifyContent: "center", gap: 6, fontSize: 12, color: "var(--w3)" }}>
        {T("Shared securely via", "Sicher geteilt über", "Partagé en toute sécurité via")} <Wordmark size={15} />
      </footer>
    </main>
  );
}

type Tr = (en: string, de: string, fr: string) => string;
const FACT: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6 };

/** the nurses, as quiet profile cards (photo, serif name, her facts in one quiet line, status only as a dot —
 *  like "So sehen die Einrichtungen Sie"); 4 per page on a laptop, one nurse at a time on a phone: nobody scrolls */
function NurseCards({ cands, lang, T, label, initials }: { cands: Cand[]; lang: string; T: Tr; label: (c: Cand) => string; initials: (n: string) => string }) {
  const { slice, page, pages, setPage } = usePaged(cands, 4, 1);
  const fact = (key: string, st: KitStatus | null, body: ReactNode) => <span key={key} style={FACT}>{st && <Dot st={st} size={7} />}<span>{body}</span></span>;
  return (
    <>
      <div className="bvsl-grid">
        {slice.map((cand, i) => {
          const b2Passed = cand.b2Stage === "passed";
          const docPct = cand.docCount ? Math.round((cand.docsOk / cand.docCount) * 100) : 0;
          return (
            <Card key={`${page}-${i}`} style={{ padding: 16, display: "flex", gap: 14, alignItems: "flex-start", minWidth: 0 }}>
              {cand.photo
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={cand.photo} alt="" className="bvsl-ph" style={{ width: 60, height: 72, borderRadius: 12, objectFit: "cover", flex: "none" }} />
                : <div aria-hidden="true" className="bvsl-ph" style={{ width: 60, height: 72, borderRadius: 12, flex: "none", display: "grid", placeItems: "center", background: "var(--bg2)", fontFamily: "var(--font-serif)", fontSize: 22, color: "var(--w3)" }}>{initials(cand.name)}</div>}
              <div style={{ minWidth: 0, flex: 1 }}>
                <p style={{ margin: 0, display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                  <span style={{ fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 22, lineHeight: 1.15, color: "var(--w)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{cand.name}</span>
                  {cand.verified && <ShieldCheck size={15} aria-label={T("Verified", "Geprüft", "Vérifié")} style={{ color: "#16a34a", flex: "none" }} />}
                </p>
                <p style={{ margin: "2px 0 0", fontSize: 13, color: "var(--w3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label(cand) || T("Nurse", "Pflegekraft", "Infirmier·ère")}</p>
                {cand.adminNote && <p style={{ margin: "5px 0 0", fontSize: 13, fontStyle: "italic", lineHeight: 1.4, color: "var(--w2)" }}>“{cand.adminNote}”</p>}
                <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 14px", marginTop: 8, fontSize: 12.5, lineHeight: 1.45, color: "var(--w2)" }}>
                  {cand.yearsExperience != null && fact("x", null, <><b style={{ fontWeight: 600, color: "var(--w)" }}>{cand.yearsExperience}</b> {T("years experience", "Jahre Erfahrung", "ans d'expérience")}</>)}
                  {cand.b2Stage && fact("b2", b2Passed ? "approved" : "pending", b2Passed ? b2StageLabel("passed", lang) : <>{T("German", "Deutsch", "Allemand")} B2 · {b2StageLabel(normalizeB2Stage(cand.b2Stage), lang)}</>)}
                  {fact("docs", docPct === 100 ? "approved" : cand.docsOk > 0 ? "pending" : "missing", <>{T("Papers", "Unterlagen", "Dossier")} <span style={{ fontVariantNumeric: "tabular-nums" }}>{cand.docsOk}/{cand.docCount}</span></>)}
                  {cand.hasCvDraft && fact("cv", "approved", T("German CV ready", "Deutscher Lebenslauf fertig", "CV allemand prêt"))}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
      <Pager page={page} pages={pages} onPage={setPage} />
    </>
  );
}
