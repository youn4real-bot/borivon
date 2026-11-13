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
import { Users, CalendarRange } from "lucide-react";
import { PageHead, Card, Dot, Empty, Seg as SegSwitch, STATUS_DOT, type Status } from "@/components/fx/kit";

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

// the one design: colours only from the kit status palette (components/fx/kit STATUS_DOT); on a phone the
// panels show one at a time behind a segmented switch (nobody scrolls)
type Sec = "funnel" | "interviews" | "milestones" | "b2" | "batches";
const ANALYTICS_CSS = `
.bva-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;align-items:start}
.bva-col{display:flex;flex-direction:column;gap:12px;min-width:0}
.bva-tabs{display:none}
.bva-tabs .bvk-seg button{white-space:nowrap}
@media (max-width:640px){
.bva-grid{grid-template-columns:1fr;gap:0}
.bva-col{gap:0}
.bva-tabs{display:block}
.bva-tabs .bvk-seg button{padding:6px 10px}
.bva-sec{display:none}
.bva-sec[data-on="1"]{display:block}
}`;

export default function AdminAnalyticsPage() {
  const router = useRouter();
  const { lang } = useLang();
  const T = (en: string, de: string, fr: string) => (lang === "de" ? de : lang === "fr" ? fr : en);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Data | null>(null);
  const [sec, setSec] = useState<Sec>("funnel");

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
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <span style={{ fontSize: 12.5, width: 150, flex: "none", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "var(--w2)" }}>{label}</span>
      <div style={{ flex: 1, height: 6, borderRadius: 999, overflow: "hidden", background: "var(--bg2)" }}>
        <div style={{ height: "100%", borderRadius: 999, width: `${of > 0 ? Math.round((count / of) * 100) : 0}%`, background: color, minWidth: count > 0 ? 4 : 0 }} />
      </div>
      <span style={{ fontSize: 13, fontWeight: 600, width: 30, textAlign: "right", flex: "none", color: "var(--w)", fontVariantNumeric: "tabular-nums" }}>{count}</span>
    </div>
  );

  // A three-part segmented bar: passed (green) · failed (red) · not-yet (neutral).
  const SegBar = ({ seg }: { seg: Seg }) => {
    const t = seg.passed + seg.failed + seg.notYet;
    const w = (n: number) => (t > 0 ? `${(n / t) * 100}%` : "0%");
    return (
      <div style={{ display: "flex", height: 6, borderRadius: 999, overflow: "hidden", background: "var(--bg2)" }}>
        <div style={{ width: w(seg.passed), background: STATUS_DOT.approved }} />
        <div style={{ width: w(seg.failed), background: STATUS_DOT.rejected }} />
      </div>
    );
  };

  // Section wrapper — a titled paper card (on a phone only the chosen one shows).
  const Panel = ({ id, title, sub, children }: { id: Sec; title: string; sub?: string; children: React.ReactNode }) => (
    <Card className="bva-sec" data-on={sec === id ? "1" : "0"} style={{ padding: "18px 20px" }}>
      <h2 style={{ margin: 0, fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 21, lineHeight: 1.2, color: "var(--w)" }}>{title}</h2>
      {sub && <p style={{ fontSize: 12.5, color: "var(--w3)", margin: "3px 0 0" }}>{sub}</p>}
      <div style={{ marginTop: 14 }}>{children}</div>
    </Card>
  );

  // A compact number: big serif, its colour as a dot (the kit status palette).
  const Stat = ({ n, label, st }: { n: number; label: string; st?: Status }) => (
    <div style={{ flex: "1 1 0", minWidth: 0 }}>
      <div style={{ fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 30, lineHeight: 1.1, color: "var(--w)", fontVariantNumeric: "tabular-nums" }}>{n}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--w3)", marginTop: 2 }}>{st && <Dot st={st} size={7} />}{label}</div>
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

  const secs: [Sec, string][] = [["funnel", T("Funnel", "Trichter", "Entonnoir")], ["interviews", T("Interviews", "Interviews", "Entretiens")], ["milestones", T("Milestones", "Meilensteine", "Jalons")], ["b2", "B2"]];
  if ((data?.batches.length ?? 0) > 0) secs.push(["batches", T("Batches", "Batches", "Lots")]);

  // the one design (founder 2026-11-13): serif head with the total big, every part as a paper card in one
  // grid (laptop) — on a phone one card at a time behind a segmented switch; bars in the kit colours
  return (
    <main id="bv-main" className="mx-auto px-5 py-8 sm:py-12 bv-page-bottom" style={{ maxWidth: 960, paddingTop: 88 }}>
      <style>{ANALYTICS_CSS}</style>
      <PageHead back={{ label: T("Back", "Zurück", "Retour"), onClick: () => router.push("/portal/admin") }}
        title={T("Analytics", "Analytik", "Analytique")}
        sub={T("The whole pipeline at a glance.", "Die gesamte Pipeline auf einen Blick.", "Tout le pipeline en un coup d'œil.")}
        actions={data && total > 0 ? (
          <div className="bva-total" style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <Users size={16} strokeWidth={1.8} style={{ color: "var(--gold)", alignSelf: "center" }} />
            <span style={{ fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 34, lineHeight: 1, color: "var(--w)", fontVariantNumeric: "tabular-nums" }}>{total}</span>
            <span style={{ fontSize: 12.5, color: "var(--w3)" }}>{T("candidates tracked", "erfasste Kandidaten", "candidats suivis")}</span>
          </div>
        ) : undefined} />

      {!data || total === 0 ? (
        <Card><Empty>{T("No candidates in scope yet.", "Noch keine Kandidaten im Bereich.", "Aucun candidat dans le périmètre.")}</Empty></Card>
      ) : (
        <>
          <div className="bva-tabs" style={{ marginBottom: 12 }}><SegSwitch value={sec} onChange={setSec} options={secs} /></div>

          <div className="bva-grid">
            <div className="bva-col">
            {/* Funnel breakdown */}
            <Panel id="funnel" title={T("Funnel", "Trichter", "Entonnoir")} sub={T("Where every candidate sits on the sales ladder.", "Wo jeder Kandidat auf der Leiter steht.", "Où se situe chaque candidat dans le parcours.")}>
              <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                {data.funnel.map((f) => (
                  <Bar key={f.key} label={funnelLabelOf(f.key, f.label)} count={f.count} of={funnelMax}
                    color={f.key === "passed" || f.key === "departed" ? STATUS_DOT.approved : f.waiting ? STATUS_DOT.pending : f.key === "__none__" ? STATUS_DOT.missing : "var(--w2)"} />
                ))}
              </div>
            </Panel>

            {/* B2 readiness */}
            <Panel id="b2" title={T("B2 German readiness", "B2 Deutsch-Bereitschaft", "Préparation B2 allemand")}
              sub={T("How many can pass the German exam in time.", "Wie viele die Deutschprüfung rechtzeitig bestehen.", "Combien peuvent réussir l'examen à temps.")}>
              <div style={{ display: "flex", gap: 12 }}>
                <Stat n={data.b2.passed} label={T("Passed", "Bestanden", "Réussi")} st="approved" />
                <Stat n={data.b2.inProgress} label={T("In progress", "In Arbeit", "En cours")} st="pending" />
                <Stat n={data.b2.failed} label={T("Failed", "Nicht bestanden", "Échoué")} st="rejected" />
                <Stat n={data.b2.notSet} label={T("Not set", "Offen", "Non défini")} st="missing" />
              </div>
            </Panel>
            </div>

            <div className="bva-col">
              {/* Interview conversion */}
              <Panel id="interviews" title={T("Interview outcomes", "Interview-Ergebnisse", "Résultats des entretiens")}
                sub={T("Green = passed · red = failed · rest not yet.", "Grün = bestanden · rot = nicht bestanden · Rest noch offen.", "Vert = réussi · rouge = échoué · le reste pas encore.")}>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {([["i1", T("Interview 1", "Interview 1", "Entretien 1")], ["i2", T("Interview 2", "Interview 2", "Entretien 2")]] as const).map(([k, label]) => {
                    const seg = data.interviews[k];
                    return (
                      <div key={k}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                          <span style={{ fontSize: 13, fontWeight: 500, color: "var(--w)" }}>{label}</span>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 10, fontSize: 12, color: "var(--w3)" }}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Dot st="approved" size={7} /><b style={{ color: "var(--w)", fontWeight: 600 }}>{seg.passed}</b> {T("passed", "bestanden", "réussi")}</span>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Dot st="rejected" size={7} /><b style={{ color: "var(--w)", fontWeight: 600 }}>{seg.failed}</b> {T("failed", "nicht bestanden", "échoué")}</span>
                            <span>{seg.notYet} {T("not yet", "offen", "pas encore")}</span>
                          </span>
                        </div>
                        <SegBar seg={seg} />
                      </div>
                    );
                  })}
                </div>
              </Panel>

              {/* Milestones reached */}
              <Panel id="milestones" title={T("Milestones reached", "Erreichte Meilensteine", "Jalons atteints")}>
                <div style={{ display: "flex", gap: 12 }}>
                  <Stat n={data.milestones.agreement} label={T("Agreement", "Vereinbarung", "Accord")} st="approved" />
                  <Stat n={data.milestones.contract} label={T("Contract", "Vertrag", "Contrat")} st="approved" />
                  <Stat n={data.milestones.visa} label={T("Visa", "Visum", "Visa")} st="approved" />
                  <Stat n={data.milestones.arrived} label={T("Arrived", "Angekommen", "Arrivés")} st="approved" />
                </div>
              </Panel>

              {/* Open batches — fill */}
              {data.batches.length > 0 && (
                <Panel id="batches" title={T("Open batches", "Offene Batches", "Lots ouverts")} sub={T("Seats filled vs. target.", "Belegte vs. angestrebte Plätze.", "Places occupées vs. objectif.")}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {data.batches.map((b) => {
                      const p = b.seats > 0 ? Math.min(100, Math.round((b.filled / b.seats) * 100)) : 0;
                      const full = b.filled >= b.seats && b.seats > 0;
                      return (
                        <div key={b.id} style={{ minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
                            <span style={{ fontSize: 13, fontWeight: 500, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--w)" }}>{b.name}</span>
                            <span style={{ flex: "none", fontSize: 12, color: "var(--w3)", display: "inline-flex", alignItems: "baseline", gap: 8 }}>
                              {[b.agency, b.employer].filter(Boolean).length > 0 && <span>{[b.agency, b.employer].filter(Boolean).join(" → ")}</span>}
                              {b.targetStart && <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><CalendarRange size={11} />{fmtDay(b.targetStart)}</span>}
                              <span style={{ fontVariantNumeric: "tabular-nums" }}><b style={{ color: "var(--w)", fontWeight: 600 }}>{b.filled}</b>/{b.seats}</span>
                            </span>
                          </div>
                          <div style={{ height: 6, borderRadius: 999, overflow: "hidden", background: "var(--bg2)" }}>
                            <div style={{ height: "100%", borderRadius: 999, width: `${p}%`, background: full ? STATUS_DOT.approved : "var(--w2)", minWidth: b.filled > 0 ? 4 : 0 }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Panel>
              )}
            </div>
          </div>

          <p style={{ fontSize: 11.5, textAlign: "center", marginTop: 12, color: "var(--w3)" }}>
            {T("Live — reflects the current pipeline every time you open this page.", "Live — spiegelt bei jedem Öffnen die aktuelle Pipeline wider.", "En direct — reflète le pipeline actuel à chaque ouverture.")}
          </p>
        </>
      )}
    </main>
  );
}
