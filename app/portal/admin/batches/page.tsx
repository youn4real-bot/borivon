"use client";

/**
 * The Batch Board (supreme admin) — see which candidates are assigned to which
 * employer intake batch (UKSH ~10 every ~3 months) and where each sits on the
 * funnel. Reached from the profile-avatar menu → "Batches". This is the website
 * companion to the Telegram bot's batch tools + daily dropout radar.
 */
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import { PageLoader } from "@/components/ui/states";
import { Modal, GoldButton, GhostButton } from "@/components/ui/Modal";
import { ArrowLeft, Plus, Users, CalendarRange } from "lucide-react";

type Batch = { id: string; name: string; employerId: string | null; employer: string | null; seats: number; filled: number; targetStart: string | null; targetEnd: string | null; status: string; notes: string | null };
type Cand = { userId: string; name: string; funnelStage: string | null; batchId: string | null };
type Employer = { id: string; name: string };

// Funnel ladder (keys MUST match lib/batchBoard FUNNEL_STAGES + the bot enum).
const STAGES: { key: string; label: string }[] = [
  { key: "funneling", label: "Funneling" },
  { key: "screening", label: "Screening call" },
  { key: "interview1", label: "Interview 1" },
  { key: "waiting_2nd", label: "Waiting 2nd interview" },
  { key: "interview2", label: "Interview 2" },
  { key: "passed", label: "Passed" },
  { key: "departed", label: "Departed" },
];
const stageLabel = (k: string | null) => STAGES.find((s) => s.key === k)?.label ?? "—";

export default function AdminBatchesPage() {
  const router = useRouter();
  const { lang } = useLang();
  const T = (en: string, de: string, fr: string) => (lang === "de" ? de : lang === "fr" ? fr : en);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState("");
  const [batches, setBatches] = useState<Batch[]>([]);
  const [candidates, setCandidates] = useState<Cand[]>([]);
  const [employers, setEmployers] = useState<Employer[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", seats: 10, employerId: "", targetStart: "", targetEnd: "" });

  const load = useCallback(async (tk: string) => {
    const res = await fetch("/api/portal/batches", { headers: { Authorization: `Bearer ${tk}` } });
    if (res.status === 401 || res.status === 403) { router.replace("/portal/dashboard"); return; }
    const j = await res.json().catch(() => ({}));
    setBatches((j.batches ?? []) as Batch[]);
    setCandidates((j.candidates ?? []) as Cand[]);
    setEmployers((j.employers ?? []) as Employer[]);
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
      setToken(tk);
      await load(tk);
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [router, load]);

  // PATCH a candidate's stage and/or batch, then refresh.
  const patchCand = async (candidateUserId: string, patch: { stage?: string; batchId?: string | null }) => {
    await fetch("/api/portal/batches", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ candidateUserId, ...patch }),
    }).catch(() => {});
    await load(token);
  };

  const createBatch = async () => {
    if (!form.name.trim() || saving) return;
    setSaving(true);
    const res = await fetch("/api/portal/batches", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name.trim(), seats: form.seats,
        employerId: form.employerId || undefined,
        targetStart: form.targetStart || undefined, targetEnd: form.targetEnd || undefined,
      }),
    }).catch(() => null);
    setSaving(false);
    if (res && res.ok) { setShowNew(false); setForm({ name: "", seats: 10, employerId: "", targetStart: "", targetEnd: "" }); await load(token); }
  };

  const closeBatch = async (batchId: string) => {
    await fetch("/api/portal/batches", {
      method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ batchId, close: true }),
    }).catch(() => {});
    await load(token);
  };

  if (loading) return <PageLoader />;

  const openBatches = batches.filter((b) => b.status === "open");
  const onFunnelNoBatch = candidates.filter((c) => c.funnelStage && !c.batchId);
  const notOnFunnel = candidates.filter((c) => !c.funnelStage);
  const fmtWindow = (b: Batch) => [b.targetStart, b.targetEnd].filter(Boolean).join(" → ") || T("no window set", "kein Zeitfenster", "pas de fenêtre");

  // Reusable per-candidate row: stage select + batch select.
  const CandRow = ({ c }: { c: Cand }) => (
    <div className="flex items-center justify-between gap-2 py-1.5 flex-wrap">
      <span className="text-[13px] min-w-0 truncate" style={{ color: "var(--w)" }}>{c.name}</span>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <select value={c.funnelStage ?? ""} onChange={(e) => patchCand(c.userId, { stage: e.target.value })}
          className="text-[12px] px-2 py-1 rounded-md" style={{ background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)" }}>
          <option value="" disabled>{T("stage…", "Phase…", "étape…")}</option>
          {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <select value={c.batchId ?? ""} onChange={(e) => patchCand(c.userId, { batchId: e.target.value || null })}
          className="text-[12px] px-2 py-1 rounded-md" style={{ background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)" }}>
          <option value="">{T("— no batch —", "— kein Batch —", "— aucun —")}</option>
          {openBatches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>
    </div>
  );

  return (
    <main id="bv-main" className="mx-auto px-5 py-8 sm:py-12 bv-page-bottom" style={{ maxWidth: 960 }}>
      <button onClick={() => router.push("/portal/admin")} className="bv-btn bv-btn-ghost mb-6 inline-flex">
        <ArrowLeft size={15} strokeWidth={2} /> {T("Back to admin", "Zurück zum Admin", "Retour à l'admin")}
      </button>

      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="bv-h1">{T("Batches", "Batches", "Lots")}</h1>
          <p className="bv-body mt-1">{T("Employer intakes + where each candidate sits on the funnel.", "Arbeitgeber-Intakes + wo jeder Kandidat im Funnel steht.", "Recrutements employeur + position de chaque candidat dans le funnel.")}</p>
        </div>
        <button onClick={() => setShowNew(true)} className="bv-btn bv-btn-gold inline-flex"><Plus size={15} strokeWidth={2} /> {T("New batch", "Neuer Batch", "Nouveau lot")}</button>
      </div>

      {openBatches.length === 0 ? (
        <div className="text-center py-12 text-[14px]" style={{ color: "var(--w3)" }}>
          {T("No open batches yet — create one to start assigning candidates.", "Noch keine offenen Batches — erstelle einen, um Kandidaten zuzuweisen.", "Aucun lot ouvert — créez-en un pour assigner des candidats.")}
        </div>
      ) : (
        <div className="space-y-4">
          {openBatches.map((b) => {
            const members = candidates.filter((c) => c.batchId === b.id);
            const pct = b.seats > 0 ? Math.min(100, Math.round((b.filled / b.seats) * 100)) : 0;
            return (
              <div key={b.id} className="p-4 sm:p-5" style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r-xl)", boxShadow: "var(--shadow-sm)" }}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold" style={{ color: "var(--w)" }}>{b.name}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]" style={{ color: "var(--w3)" }}>
                      {b.employer && <span>{b.employer}</span>}
                      <span className="inline-flex items-center gap-1"><CalendarRange size={12} /> {fmtWindow(b)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="inline-flex items-center gap-1.5 text-[12px]" style={{ color: b.filled >= b.seats ? "var(--gold)" : "var(--w2)" }}>
                      <Users size={13} /> {b.filled}/{b.seats}
                    </span>
                    <button onClick={() => closeBatch(b.id)} className="text-[11.5px]" style={{ color: "var(--w3)" }}>{T("Close", "Schließen", "Clôturer")}</button>
                  </div>
                </div>
                {/* seat fill bar */}
                <div className="mt-3 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--bg2)" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: "var(--gold)" }} />
                </div>
                {b.filled < b.seats && (
                  <p className="mt-1.5 text-[11.5px]" style={{ color: "var(--w3)" }}>{T(`Funnel ${b.seats - b.filled} more to fill this intake.`, `Noch ${b.seats - b.filled} Kandidaten für dieses Intake.`, `Encore ${b.seats - b.filled} à trouver pour ce lot.`)}</p>
                )}
                {members.length > 0 && (
                  <div className="mt-3 pt-2" style={{ borderTop: "1px solid var(--border)" }}>
                    {members.map((c) => <CandRow key={c.userId} c={c} />)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {onFunnelNoBatch.length > 0 && (
        <section className="mt-8">
          <h2 className="text-[13px] font-semibold mb-2" style={{ color: "var(--w2)" }}>{T("On the funnel — not in a batch yet", "Im Funnel — noch keinem Batch zugewiesen", "Dans le funnel — pas encore dans un lot")}</h2>
          <div className="p-4" style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r-xl)" }}>
            {onFunnelNoBatch.map((c) => <CandRow key={c.userId} c={c} />)}
          </div>
        </section>
      )}

      {notOnFunnel.length > 0 && (
        <section className="mt-8">
          <h2 className="text-[13px] font-semibold mb-2" style={{ color: "var(--w2)" }}>{T("Add a candidate to the funnel", "Kandidat zum Funnel hinzufügen", "Ajouter un candidat au funnel")}</h2>
          <p className="text-[11.5px] mb-2" style={{ color: "var(--w3)" }}>{T("Pick a stage to start tracking them.", "Wähle eine Phase, um sie zu verfolgen.", "Choisissez une étape pour les suivre.")}</p>
          <div className="p-4 max-h-[320px] overflow-y-auto" style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r-xl)" }}>
            {notOnFunnel.map((c) => (
              <div key={c.userId} className="flex items-center justify-between gap-2 py-1.5">
                <span className="text-[13px] min-w-0 truncate" style={{ color: "var(--w2)" }}>{c.name}</span>
                <select defaultValue="" onChange={(e) => { if (e.target.value) patchCand(c.userId, { stage: e.target.value }); }}
                  className="text-[12px] px-2 py-1 rounded-md flex-shrink-0" style={{ background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)" }}>
                  <option value="">{T("add to funnel…", "hinzufügen…", "ajouter…")}</option>
                  {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
            ))}
          </div>
        </section>
      )}

      <Modal open={showNew} onClose={() => !saving && setShowNew(false)} size="sm" busy={saving}
        title={T("New batch", "Neuer Batch", "Nouveau lot")}
        subtitle={T("An employer intake, e.g. \"UKSH — Q2 2026\".", "Ein Arbeitgeber-Intake, z.B. \"UKSH — Q2 2026\".", "Un recrutement employeur, p.ex. \"UKSH — Q2 2026\".")}
        footer={<><GhostButton onClick={() => setShowNew(false)} disabled={saving}>{T("Cancel", "Abbrechen", "Annuler")}</GhostButton>
          <GoldButton onClick={createBatch} disabled={saving || !form.name.trim()}>{T("Create", "Erstellen", "Créer")}</GoldButton></>}>
        <div className="px-5 py-4 space-y-3">
          <label className="block">
            <span className="text-[12px]" style={{ color: "var(--w3)" }}>{T("Name", "Name", "Nom")}</span>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="UKSH — Q2 2026"
              className="w-full mt-1 px-3 py-2 text-[14px] rounded-md" style={{ background: "var(--bg2)", color: "var(--w)", border: "1px solid var(--border)" }} />
          </label>
          <div className="flex gap-3">
            <label className="block w-28">
              <span className="text-[12px]" style={{ color: "var(--w3)" }}>{T("Seats", "Plätze", "Places")}</span>
              <input type="number" min={1} max={1000} value={form.seats} onChange={(e) => setForm({ ...form, seats: Math.max(1, Number(e.target.value) || 1) })}
                className="w-full mt-1 px-3 py-2 text-[14px] rounded-md" style={{ background: "var(--bg2)", color: "var(--w)", border: "1px solid var(--border)" }} />
            </label>
            <label className="block flex-1">
              <span className="text-[12px]" style={{ color: "var(--w3)" }}>{T("Employer", "Arbeitgeber", "Employeur")}</span>
              <select value={form.employerId} onChange={(e) => setForm({ ...form, employerId: e.target.value })}
                className="w-full mt-1 px-3 py-2 text-[14px] rounded-md" style={{ background: "var(--bg2)", color: "var(--w)", border: "1px solid var(--border)" }}>
                <option value="">{T("— none —", "— keiner —", "— aucun —")}</option>
                {employers.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </label>
          </div>
          <div className="flex gap-3">
            <label className="block flex-1">
              <span className="text-[12px]" style={{ color: "var(--w3)" }}>{T("Window start", "Fenster-Start", "Début fenêtre")}</span>
              <input type="date" value={form.targetStart} onChange={(e) => setForm({ ...form, targetStart: e.target.value })}
                className="w-full mt-1 px-3 py-2 text-[14px] rounded-md" style={{ background: "var(--bg2)", color: "var(--w)", border: "1px solid var(--border)" }} />
            </label>
            <label className="block flex-1">
              <span className="text-[12px]" style={{ color: "var(--w3)" }}>{T("Window end", "Fenster-Ende", "Fin fenêtre")}</span>
              <input type="date" value={form.targetEnd} onChange={(e) => setForm({ ...form, targetEnd: e.target.value })}
                className="w-full mt-1 px-3 py-2 text-[14px] rounded-md" style={{ background: "var(--bg2)", color: "var(--w)", border: "1px solid var(--border)" }} />
            </label>
          </div>
        </div>
      </Modal>
    </main>
  );
}
