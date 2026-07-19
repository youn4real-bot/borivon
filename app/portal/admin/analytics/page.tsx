"use client";

/**
 * Admin Analytics (ALL admins, scoped) — the whole pipeline at a glance:
 * how many candidates sit at each funnel stage, interview-1/2 pass rates,
 * milestone counts, B2 readiness, and open-batch fill.
 *
 * Read-only companion to the Batch Tracker (which drives ONE candidate). Backed
 * by /api/portal/admin/analytics, scoped by LAW #25 (sub-admins see all,
 * org-admins only their org's candidates + batches).
 */
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import { PageLoader } from "@/components/ui/states";
import { ArrowLeft, Users, CalendarRange } from "lucide-react";

type Seg = { passed: number; failed: number; notYet: number };
type Batch = { id: string; name: string; agency: string | null; employer: string | null; seats: number; filled: number; targetStart: string | null; targetEnd: string | null };
type Data = {
  role: string;
  totals: { candidates: number };
  funnel: { key: string; label: string; waiting: boolean; count: number }[];
  interviews: { i1: Seg; i2: Seg };
  milestones: { agreement: number; contract: number; visa: number; arrived: number };
  b2: { passed: number; inProgress: number; failed: number; notSet: number };
  batches: Batch[];
};

const GREEN = "#16a34a";
const RED = "#ef4444";
const AMBER = "#f59e0b";

export default function AdminAnalyticsPage() {
  const router = useRouter();
  const { lang } = useLang();
  const T = (en: string, de: string, fr: string) => (lang === "de" ? de : lang === "fr" ? fr : en);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Data | null>(null);

  const load = useCallback(async (tk: string) => {
    const res = await fetch("/api/portal/admin/analytics", { headers: { Authorization: `Bearer ${tk}` } });
    if (res.status === 401 || res.status === 403) { router.replace("/portal/dashboard"); return; }
    const j = await res.json().catch(() => null);
    if (j && !j.error) setData(j as Data);
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { router.replace("/portal"); return; }
      let tk = session.access_token ?? "";
      const expMs = (session.expires_at ?? 0) * 1000;
      if (!expMs || expMs - Date.now() < 60_000) {
        try { const { data: r } = await supabase.auth.refreshSession(); if (r?.session?.access_token) tk = r.session.access_token; } catch { /* keep */ }
      }
      if (cancelled) return;
      await load(tk);
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [router, load]);

  // Keep the token fresh for a page left open past the ~hourly JWT rotation
  // (portal convention — a stale token would 401 the reload).
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session?.access_token) { load(session.access_token); }
    });
    return () => sub.subscription.unsubscribe();
  }, [load]);

  if (loading) return <PageLoader />;

  const total = data?.totals.candidates ?? 0;
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
  const fmtDay = (d: string) => new Date(d + "T00:00:00").toLocaleDateString(lang === "de" ? "de-DE" : lang === "fr" ? "fr-FR" : "en-GB", { day: "2-digit", month: "short", year: "numeric" });

  // A labelled row with a proportional bar — the core building block.
  const Bar = ({ label, count, of, color }: { label: string; count: number; of: number; color: string }) => (
    <div className="flex items-center gap-3">
      <span className="text-[12.5px] w-40 flex-shrink-0 truncate" style={{ color: "var(--w2)" }}>{label}</span>
      <div className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ background: "var(--bg2)" }}>
        <div className="h-full rounded-full" style={{ width: `${of > 0 ? Math.round((count / of) * 100) : 0}%`, background: color, minWidth: count > 0 ? 4 : 0 }} />
      </div>
      <span className="text-[12.5px] font-semibold w-10 text-right flex-shrink-0" style={{ color: "var(--w)" }}>{count}</span>
    </div>
  );

  // A three-part segmented bar: passed (green) · failed (red) · not-yet (neutral).
  const SegBar = ({ seg }: { seg: Seg }) => {
    const t = seg.passed + seg.failed + seg.notYet;
    const w = (n: number) => (t > 0 ? `${(n / t) * 100}%` : "0%");
    return (
      <div className="flex h-2.5 rounded-full overflow-hidden" style={{ background: "var(--bg2)" }}>
        <div style={{ width: w(seg.passed), background: GREEN }} />
        <div style={{ width: w(seg.failed), background: RED }} />
      </div>
    );
  };

  // Section wrapper — a titled --card panel.
  const Panel = ({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) => (
    <section className="p-4 sm:p-5 mb-4" style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r-xl)" }}>
      <h2 className="text-[13.5px] font-semibold mb-0.5" style={{ color: "var(--w)" }}>{title}</h2>
      {sub && <p className="text-[11.5px] mb-3" style={{ color: "var(--w3)" }}>{sub}</p>}
      <div className={sub ? "" : "mt-3"}>{children}</div>
    </section>
  );

  // A compact number tile.
  const Stat = ({ n, label, color }: { n: number; label: string; color?: string }) => (
    <div className="flex-1 min-w-[80px] p-3 rounded-xl text-center" style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
      <div className="text-[22px] font-bold leading-none" style={{ color: color ?? "var(--w)" }}>{n}</div>
      <div className="text-[11px] mt-1.5" style={{ color: "var(--w3)" }}>{label}</div>
    </div>
  );

  const funnelMax = Math.max(1, ...(data?.funnel.map((f) => f.count) ?? [1]));
  const funnelLabelOf = (key: string, fallback: string) => {
    if (key === "__none__") return T("Not started", "Nicht begonnen", "Pas commencé");
    const map: Record<string, [string, string, string]> = {
      funneling: ["Funneling", "Aufnahme", "Entonnoir"],
      screening: ["Screening call", "Screening-Anruf", "Appel de présélection"],
      interview1: ["Interview 1", "Interview 1", "Entretien 1"],
      waiting_2nd: ["Waiting for 2nd interview", "Warten auf 2. Interview", "En attente du 2e entretien"],
      interview2: ["Interview 2", "Interview 2", "Entretien 2"],
      passed: ["Passed", "Bestanden", "Réussi"],
      departed: ["Departed for Germany", "Nach Deutschland abgereist", "Parti en Allemagne"],
    };
    const m = map[key];
    return m ? T(m[0], m[1], m[2]) : fallback;
  };

  return (
    <main id="bv-main" className="mx-auto px-5 py-8 sm:py-12 bv-page-bottom" style={{ maxWidth: 860 }}>
      <button onClick={() => router.push("/portal/admin")} className="bv-btn bv-btn-ghost mb-6 inline-flex">
        <ArrowLeft size={15} strokeWidth={2} /> {T("Back to admin", "Zurück zum Admin", "Retour à l'admin")}
      </button>

      <div className="mb-5">
        <h1 className="bv-h1">{T("Analytics", "Analytik", "Analytique")}</h1>
        <p className="bv-body mt-1">{T("The whole pipeline at a glance.", "Die gesamte Pipeline auf einen Blick.", "Tout le pipeline en un coup d'œil.")}</p>
      </div>

      {!data || total === 0 ? (
        <div className="text-center py-16 text-[14px]" style={{ color: "var(--w3)" }}>
          {T("No candidates in scope yet.", "Noch keine Kandidaten im Bereich.", "Aucun candidat dans le périmètre.")}
        </div>
      ) : (
        <>
          {/* Headline total */}
          <div className="flex items-center gap-3 p-4 mb-4" style={{ background: "var(--gdim)", border: "1px solid var(--border-gold)", borderRadius: "var(--r-xl)" }}>
            <Users size={20} strokeWidth={1.8} style={{ color: "var(--gold)" }} />
            <div>
              <div className="text-[22px] font-bold leading-none" style={{ color: "var(--w)" }}>{total}</div>
              <div className="text-[11.5px] mt-1" style={{ color: "var(--w3)" }}>{T("candidates tracked", "erfasste Kandidaten", "candidats suivis")}</div>
            </div>
          </div>

          {/* Funnel breakdown */}
          <Panel title={T("Funnel", "Trichter", "Entonnoir")} sub={T("Where every candidate sits on the sales ladder.", "Wo jeder Kandidat auf der Leiter steht.", "Où se situe chaque candidat dans le parcours.")}>
            <div className="space-y-2.5">
              {data.funnel.map((f) => (
                <Bar key={f.key} label={funnelLabelOf(f.key, f.label)} count={f.count} of={funnelMax}
                  color={f.key === "passed" || f.key === "departed" ? GREEN : f.waiting ? AMBER : f.key === "__none__" ? "var(--w3)" : "var(--gold)"} />
              ))}
            </div>
          </Panel>

          {/* Interview conversion */}
          <Panel title={T("Interview outcomes", "Interview-Ergebnisse", "Résultats des entretiens")}
            sub={T("Green = passed · red = failed · rest not yet.", "Grün = bestanden · rot = nicht bestanden · Rest noch offen.", "Vert = réussi · rouge = échoué · le reste pas encore.")}>
            <div className="space-y-3.5">
              {([["i1", T("Interview 1", "Interview 1", "Entretien 1")], ["i2", T("Interview 2", "Interview 2", "Entretien 2")]] as const).map(([k, label]) => {
                const seg = data.interviews[k];
                return (
                  <div key={k}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[12.5px] font-semibold" style={{ color: "var(--w2)" }}>{label}</span>
                      <span className="text-[11.5px]" style={{ color: "var(--w3)" }}>
                        <b style={{ color: GREEN }}>{seg.passed}</b> {T("passed", "bestanden", "réussi")} · <b style={{ color: RED }}>{seg.failed}</b> {T("failed", "nicht bestanden", "échoué")} · {seg.notYet} {T("not yet", "offen", "pas encore")}
                      </span>
                    </div>
                    <SegBar seg={seg} />
                  </div>
                );
              })}
            </div>
          </Panel>

          {/* Milestones reached */}
          <Panel title={T("Milestones reached", "Erreichte Meilensteine", "Jalons atteints")}>
            <div className="flex gap-2.5 flex-wrap">
              <Stat n={data.milestones.agreement} label={T("Agreement", "Vereinbarung", "Accord")} color={GREEN} />
              <Stat n={data.milestones.contract} label={T("Contract", "Vertrag", "Contrat")} color={GREEN} />
              <Stat n={data.milestones.visa} label={T("Visa", "Visum", "Visa")} color={GREEN} />
              <Stat n={data.milestones.arrived} label={T("Arrived", "Angekommen", "Arrivés")} color={GREEN} />
            </div>
          </Panel>

          {/* B2 readiness */}
          <Panel title={T("B2 German readiness", "B2 Deutsch-Bereitschaft", "Préparation B2 allemand")}
            sub={T("How many can pass the German exam in time.", "Wie viele die Deutschprüfung rechtzeitig bestehen.", "Combien peuvent réussir l'examen à temps.")}>
            <div className="flex gap-2.5 flex-wrap">
              <Stat n={data.b2.passed} label={T("Passed", "Bestanden", "Réussi")} color={GREEN} />
              <Stat n={data.b2.inProgress} label={T("In progress", "In Arbeit", "En cours")} color={AMBER} />
              <Stat n={data.b2.failed} label={T("Failed", "Nicht bestanden", "Échoué")} color={RED} />
              <Stat n={data.b2.notSet} label={T("Not set", "Offen", "Non défini")} />
            </div>
          </Panel>

          {/* Open batches — fill */}
          {data.batches.length > 0 && (
            <Panel title={T("Open batches", "Offene Batches", "Lots ouverts")} sub={T("Seats filled vs. target.", "Belegte vs. angestrebte Plätze.", "Places occupées vs. objectif.")}>
              <div className="space-y-3">
                {data.batches.map((b) => {
                  const p = b.seats > 0 ? Math.min(100, Math.round((b.filled / b.seats) * 100)) : 0;
                  const full = b.filled >= b.seats && b.seats > 0;
                  return (
                    <div key={b.id}>
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="text-[12.5px] font-semibold min-w-0 truncate" style={{ color: "var(--w)" }}>{b.name}</span>
                        <span className="text-[11.5px] flex-shrink-0" style={{ color: "var(--w3)" }}>
                          {[b.agency, b.employer].filter(Boolean).length > 0 && <span className="mr-2">{[b.agency, b.employer].filter(Boolean).join(" → ")}</span>}
                          {b.targetStart && <span className="inline-flex items-center gap-1 mr-2"><CalendarRange size={11} />{fmtDay(b.targetStart)}</span>}
                          <b style={{ color: "var(--w)" }}>{b.filled}/{b.seats}</b>
                        </span>
                      </div>
                      <div className="h-2.5 rounded-full overflow-hidden" style={{ background: "var(--bg2)" }}>
                        <div className="h-full rounded-full" style={{ width: `${p}%`, background: full ? GREEN : "var(--gold)", minWidth: b.filled > 0 ? 4 : 0 }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>
          )}

          <p className="text-[11px] text-center mt-2" style={{ color: "var(--w3)" }}>
            {T("Live — reflects the current pipeline every time you open this page.", "Live — spiegelt bei jedem Öffnen die aktuelle Pipeline wider.", "En direct — reflète le pipeline actuel à chaque ouverture.")}
          </p>
        </>
      )}
    </main>
  );
}
