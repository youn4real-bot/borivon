"use client";

/**
 * Batch Tracker (ALL admins) — the ritual board: pull up an employer intake
 * batch (e.g. "UKSH Kiel — April 2027") and drive EVERY candidate's progress
 * from one screen — funnel stage, interview 1 & 2 (status + date), contract,
 * visa, arrival — each editable inline with an optimistic write.
 *
 * Backed by /api/portal/tracker (scoped by LAW #25: sub-admins see only their
 * candidates; org-admins only their org's). Companion to /portal/admin/batches
 * (supreme-only seat/funnel overview) and the Telegram batch tools.
 */
import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import { PageLoader } from "@/components/ui/states";
import { Modal, GoldButton, GhostButton } from "@/components/ui/Modal";
import { ArrowLeft, Users, CalendarRange, Search, Plus, Check } from "lucide-react";

type Batch = { id: string; name: string; agency: string | null; employer: string | null; seats: number; filled: number; targetStart: string | null; targetEnd: string | null };
type Employer = { id: string; name: string };
type Org = { id: string; name: string };
type Cand = {
  userId: string; name: string; batchId: string | null; funnelStage: string | null;
  interview1Status: string | null; interview1Date: string | null;
  interview2Status: string | null; interview2Date: string | null;
  contractDone: boolean; visaApptDate: string | null; visaGranted: boolean; arrivedDone: boolean;
};

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

// Interview status cycle: none → pending → passed → failed → none.
const NEXT_STATUS: Record<string, string | null> = { "": "pending", pending: "passed", passed: "failed", failed: "" };
const STATUS_COLOR = (s: string | null): { bg: string; fg: string; bd: string } => {
  if (s === "passed") return { bg: "var(--success-bg, rgba(22,163,74,0.14))", fg: "#16a34a", bd: "rgba(22,163,74,0.4)" };
  if (s === "failed") return { bg: "rgba(239,68,68,0.13)", fg: "#ef4444", bd: "rgba(239,68,68,0.4)" };
  if (s === "pending") return { bg: "rgba(245,158,11,0.14)", fg: "#f59e0b", bd: "rgba(245,158,11,0.4)" };
  return { bg: "var(--bg2)", fg: "var(--w3)", bd: "var(--border)" };
};

export default function AdminTrackerPage() {
  const router = useRouter();
  const { lang } = useLang();
  const T = (en: string, de: string, fr: string) => (lang === "de" ? de : lang === "fr" ? fr : en);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState("");
  const [batches, setBatches] = useState<Batch[]>([]);
  const [candidates, setCandidates] = useState<Cand[]>([]);
  const [selectedBatch, setSelectedBatch] = useState<string>("");
  const [addOpen, setAddOpen] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  const [err, setErr] = useState("");
  const [isSupreme, setIsSupreme] = useState(false);
  const [employers, setEmployers] = useState<Employer[]>([]);
  const [organizations, setOrganizations] = useState<Org[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", seats: 12, orgId: "", employerId: "", targetStart: "", targetEnd: "" });

  const load = useCallback(async (tk: string) => {
    const res = await fetch("/api/portal/tracker", { headers: { Authorization: `Bearer ${tk}` } });
    if (res.status === 401 || res.status === 403) { router.replace("/portal/dashboard"); return; }
    const j = await res.json().catch(() => ({}));
    const bs = (j.batches ?? []) as Batch[];
    setBatches(bs);
    setCandidates((j.candidates ?? []) as Cand[]);
    setIsSupreme(j.role === "admin");
    setEmployers((j.employers ?? []) as Employer[]);
    setOrganizations((j.organizations ?? []) as Org[]);
    setSelectedBatch((cur) => {
      if (cur && bs.some((b) => b.id === cur)) return cur;
      // Default to the UKSH / April 2027 batch if present, else the first open one.
      const preferred = bs.find((b) => /uksh|april\s*2027/i.test(b.name));
      return preferred?.id ?? bs[0]?.id ?? "";
    });
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

  // Keep the access token fresh — Supabase silently rotates the JWT ~hourly.
  // WITHOUT this, a page left open long enough kept using a stale token and
  // every write 401'd → "Could not save" (the portal convention: every
  // long-lived authenticated page attaches this listener).
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session?.access_token) setToken(session.access_token);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Optimistic per-candidate write: apply local immediately, roll back on failure.
  const apply = useCallback(async (userId: string, localPatch: Partial<Cand>, serverPatch: Record<string, unknown>) => {
    setErr("");
    let prev: Cand[] = [];
    setCandidates((cs) => { prev = cs; return cs.map((c) => (c.userId === userId ? { ...c, ...localPatch } : c)); });
    const doPatch = (tk: string) => fetch("/api/portal/tracker", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" },
      body: JSON.stringify({ candidateUserId: userId, patch: serverPatch }),
    }).catch(() => null);
    let res = await doPatch(token);
    // Self-heal a stale token: refresh the session once and retry before failing.
    if (res && (res.status === 401 || res.status === 403)) {
      try {
        const { data } = await supabase.auth.refreshSession();
        const fresh = data?.session?.access_token;
        if (fresh) { setToken(fresh); res = await doPatch(fresh); }
      } catch { /* fall through to the error path */ }
    }
    if (!res || !res.ok) {
      setCandidates(prev);
      setErr(T("Could not save — try again.", "Konnte nicht speichern — erneut versuchen.", "Échec de l'enregistrement — réessayez."));
    }
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const cycleInterview = (c: Cand, n: 1 | 2) => {
    const cur = (n === 1 ? c.interview1Status : c.interview2Status) ?? "";
    const next = NEXT_STATUS[cur] ?? "pending";
    if (n === 1) apply(c.userId, { interview1Status: next || null }, { interview1_status: next || null });
    else apply(c.userId, { interview2Status: next || null }, { interview2_status: next || null });
  };
  const setStage = (c: Cand, stage: string) => apply(c.userId, { funnelStage: stage || null }, { funnel_stage: stage || null });
  const addToBatch = (c: Cand) => apply(c.userId, { batchId: selectedBatch }, { batch_id: selectedBatch });
  const removeFromBatch = (c: Cand) => apply(c.userId, { batchId: null }, { batch_id: null });

  // Supreme-only: create a new batch (name + date window + agency + employer),
  // then select it. Reuses the supreme-gated POST /api/portal/batches.
  const createBatch = async () => {
    if (!form.name.trim() || saving) return;
    setSaving(true);
    const res = await fetch("/api/portal/batches", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name.trim(), seats: form.seats,
        orgId: form.orgId || undefined, employerId: form.employerId || undefined,
        targetStart: form.targetStart || undefined, targetEnd: form.targetEnd || undefined,
      }),
    }).catch(() => null);
    setSaving(false);
    if (res && res.ok) {
      const created = await res.json().catch(() => ({}));
      setShowNew(false);
      setForm({ name: "", seats: 12, orgId: "", employerId: "", targetStart: "", targetEnd: "" });
      await load(token);
      if (created?.id) setSelectedBatch(created.id);
    } else {
      setErr(T("Could not create the batch.", "Batch konnte nicht erstellt werden.", "Impossible de créer le lot."));
    }
  };

  const batch = useMemo(() => batches.find((b) => b.id === selectedBatch) ?? null, [batches, selectedBatch]);
  const members = useMemo(
    () => candidates.filter((c) => c.batchId === selectedBatch).sort((a, b) => a.name.localeCompare(b.name)),
    [candidates, selectedBatch],
  );
  const addable = useMemo(() => {
    const q = addQuery.trim().toLowerCase();
    return candidates
      .filter((c) => c.batchId !== selectedBatch)
      .filter((c) => !q || c.name.toLowerCase().includes(q))
      .slice(0, 40);
  }, [candidates, selectedBatch, addQuery]);

  // Batch progress summary — how many have passed interview 1 / 2 / arrived.
  const summary = useMemo(() => {
    const s = { i1: 0, i2: 0, contract: 0, visa: 0, arrived: 0 };
    for (const c of members) {
      if (c.interview1Status === "passed") s.i1++;
      if (c.interview2Status === "passed") s.i2++;
      if (c.contractDone) s.contract++;
      if (c.visaGranted) s.visa++;
      if (c.arrivedDone) s.arrived++;
    }
    return s;
  }, [members]);

  if (loading) return <PageLoader />;

  const fmtWindow = (b: Batch) => [b.targetStart, b.targetEnd].filter(Boolean).join(" → ");

  const Pill = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button onClick={onClick}
      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11.5px] font-semibold rounded-full transition-colors"
      style={{
        background: active ? "var(--success-bg, rgba(22,163,74,0.14))" : "var(--bg2)",
        color: active ? "#16a34a" : "var(--w3)",
        border: `1px solid ${active ? "rgba(22,163,74,0.4)" : "var(--border)"}`,
      }}>
      {active && <Check size={12} strokeWidth={2.5} />}{children}
    </button>
  );

  return (
    <main id="bv-main" className="mx-auto px-5 py-8 sm:py-12 bv-page-bottom" style={{ maxWidth: 1040 }}>
      <button onClick={() => router.push("/portal/admin")} className="bv-btn bv-btn-ghost mb-6 inline-flex">
        <ArrowLeft size={15} strokeWidth={2} /> {T("Back to admin", "Zurück zum Admin", "Retour à l'admin")}
      </button>

      <div className="mb-5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="bv-h1">{T("Batch Tracker", "Batch-Tracker", "Suivi du lot")}</h1>
          <p className="bv-body mt-1">{T("Track every candidate's progress in one batch.", "Verfolge den Fortschritt jedes Kandidaten in einem Batch.", "Suivez la progression de chaque candidat d'un lot.")}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {batches.length > 1 && (
            <select value={selectedBatch} onChange={(e) => setSelectedBatch(e.target.value)}
              className="text-[13px] px-3 py-2 rounded-md" style={{ background: "var(--card)", color: "var(--w)", border: "1px solid var(--border)" }}>
              {batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          {isSupreme && (
            <button onClick={() => setShowNew(true)} className="bv-btn bv-btn-ghost inline-flex">
              <Plus size={15} strokeWidth={2} /> {T("New batch", "Neuer Batch", "Nouveau lot")}
            </button>
          )}
        </div>
      </div>

      {!batch ? (
        <div className="text-center py-16 text-[14px]" style={{ color: "var(--w3)" }}>
          {T("No open batch yet — create one on the Batches page first.", "Noch kein offener Batch — erstelle zuerst einen auf der Batches-Seite.", "Aucun lot ouvert — créez-en un d'abord sur la page Lots.")}
        </div>
      ) : (
        <>
          {/* Batch header + summary */}
          <div className="p-4 sm:p-5 mb-5" style={{ background: "var(--card)", border: "1px solid var(--border-gold)", borderRadius: "var(--r-xl)", boxShadow: "var(--shadow-sm)" }}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-[16px] font-semibold" style={{ color: "var(--w)" }}>{batch.name}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]" style={{ color: "var(--w3)" }}>
                  {(batch.agency || batch.employer) && <span>{[batch.agency, batch.employer].filter(Boolean).join(" → ")}</span>}
                  {fmtWindow(batch) && <span className="inline-flex items-center gap-1"><CalendarRange size={12} /> {fmtWindow(batch)}</span>}
                  <span className="inline-flex items-center gap-1"><Users size={12} /> {members.length}/{batch.seats}</span>
                </div>
              </div>
              <button onClick={() => setAddOpen((v) => !v)} className="bv-btn bv-btn-gold inline-flex flex-shrink-0">
                <Plus size={15} strokeWidth={2} /> {T("Add candidate", "Kandidat hinzufügen", "Ajouter un candidat")}
              </button>
            </div>
            {/* progress chips */}
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px]" style={{ color: "var(--w2)" }}>
              <span>{T("Interview 1 passed", "Interview 1 bestanden", "Entretien 1 réussi")}: <b style={{ color: "var(--w)" }}>{summary.i1}/{members.length}</b></span>
              <span>{T("Interview 2 passed", "Interview 2 bestanden", "Entretien 2 réussi")}: <b style={{ color: "var(--w)" }}>{summary.i2}/{members.length}</b></span>
              <span>{T("Contract", "Vertrag", "Contrat")}: <b style={{ color: "var(--w)" }}>{summary.contract}</b></span>
              <span>{T("Visa", "Visum", "Visa")}: <b style={{ color: "var(--w)" }}>{summary.visa}</b></span>
              <span>{T("Arrived", "Angekommen", "Arrivés")}: <b style={{ color: "var(--w)" }}>{summary.arrived}</b></span>
            </div>
          </div>

          {err && <p className="mb-3 text-[12px]" style={{ color: "#ef4444" }}>{err}</p>}

          {/* Add-candidate picker */}
          {addOpen && (
            <div className="mb-5 p-4" style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r-xl)" }}>
              <div className="relative mb-2">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--w3)" }} />
                <input value={addQuery} onChange={(e) => setAddQuery(e.target.value)} autoFocus
                  placeholder={T("Search a candidate to add…", "Kandidat suchen…", "Rechercher un candidat…")}
                  className="w-full pl-8 pr-3 py-2 text-[13px] rounded-md outline-none" style={{ background: "var(--bg2)", color: "var(--w)", border: "1px solid var(--border)" }} />
              </div>
              <div className="max-h-[300px] overflow-y-auto">
                {addable.length === 0 ? (
                  <p className="text-[12px] py-2 text-center" style={{ color: "var(--w3)" }}>{T("No candidates to add.", "Keine Kandidaten zum Hinzufügen.", "Aucun candidat à ajouter.")}</p>
                ) : addable.map((c) => (
                  <div key={c.userId} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="text-[13px] min-w-0 truncate" style={{ color: "var(--w2)" }}>{c.name}{c.batchId ? <span className="ml-2 text-[10.5px]" style={{ color: "var(--w3)" }}>({T("in another batch", "in anderem Batch", "dans un autre lot")})</span> : null}</span>
                    <button onClick={() => { addToBatch(c); }} className="flex-shrink-0 px-2.5 py-1 text-[11px] font-semibold rounded-md" style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>{T("Add", "Hinzufügen", "Ajouter")}</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Member rows */}
          {members.length === 0 ? (
            <div className="text-center py-14 text-[14px]" style={{ color: "var(--w3)" }}>
              {T("No candidates in this batch yet — add some above.", "Noch keine Kandidaten in diesem Batch — oben hinzufügen.", "Aucun candidat dans ce lot — ajoutez-en ci-dessus.")}
            </div>
          ) : (
            <div className="space-y-3">
              {members.map((c) => {
                const i1 = STATUS_COLOR(c.interview1Status);
                const i2 = STATUS_COLOR(c.interview2Status);
                const statusLabel = (s: string | null) => s === "passed" ? T("passed", "bestanden", "réussi") : s === "failed" ? T("failed", "nicht bestanden", "échoué") : s === "pending" ? T("pending", "ausstehend", "en attente") : T("—", "—", "—");
                return (
                  <div key={c.userId} className="p-4" style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r-xl)" }}>
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <p className="text-[14px] font-semibold min-w-0 truncate" style={{ color: "var(--w)" }}>{c.name}</p>
                      <select value={c.funnelStage ?? ""} onChange={(e) => setStage(c, e.target.value)}
                        className="text-[12px] px-2 py-1 rounded-md flex-shrink-0" style={{ background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)" }}>
                        <option value="">{T("stage…", "Phase…", "étape…")}</option>
                        {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                      </select>
                    </div>

                    {/* interviews */}
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {([1, 2] as const).map((n) => {
                        const s = n === 1 ? c.interview1Status : c.interview2Status;
                        const d = n === 1 ? c.interview1Date : c.interview2Date;
                        const col = n === 1 ? i1 : i2;
                        return (
                          <div key={n} className="flex items-center gap-2">
                            <span className="text-[11.5px] w-[68px] flex-shrink-0" style={{ color: "var(--w3)" }}>{T("Interview", "Interview", "Entretien")} {n}</span>
                            <button onClick={() => cycleInterview(c, n)}
                              className="px-2.5 py-1 text-[11.5px] font-semibold rounded-full transition-colors"
                              style={{ background: col.bg, color: col.fg, border: `1px solid ${col.bd}` }}>
                              {statusLabel(s)}
                            </button>
                            <input type="date" value={d ?? ""}
                              onChange={(e) => n === 1
                                ? apply(c.userId, { interview1Date: e.target.value || null }, { interview1_date: e.target.value || null })
                                : apply(c.userId, { interview2Date: e.target.value || null }, { interview2_date: e.target.value || null })}
                              className="text-[11.5px] px-2 py-1 rounded-md" style={{ background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)" }} />
                          </div>
                        );
                      })}
                    </div>

                    {/* milestones */}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Pill active={c.contractDone} onClick={() => apply(c.userId, { contractDone: !c.contractDone }, { contract_done: !c.contractDone })}>{T("Contract", "Vertrag", "Contrat")}</Pill>
                      <Pill active={c.visaGranted} onClick={() => apply(c.userId, { visaGranted: !c.visaGranted }, { visa_granted: !c.visaGranted })}>{T("Visa", "Visum", "Visa")}</Pill>
                      <div className="inline-flex items-center gap-1">
                        <span className="text-[10.5px]" style={{ color: "var(--w3)" }}>{T("Visa appt", "Visum-Termin", "RDV visa")}</span>
                        <input type="date" value={c.visaApptDate ?? ""} onChange={(e) => apply(c.userId, { visaApptDate: e.target.value || null }, { visa_appt_date: e.target.value || null })}
                          className="text-[11px] px-1.5 py-1 rounded-md" style={{ background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)" }} />
                      </div>
                      <Pill active={c.arrivedDone} onClick={() => apply(c.userId, { arrivedDone: !c.arrivedDone }, { arrived_done: !c.arrivedDone })}>{T("Arrived", "Angekommen", "Arrivé")}</Pill>
                      <button onClick={() => removeFromBatch(c)} className="ml-auto text-[11px]" style={{ color: "var(--w3)" }}>{T("Remove", "Entfernen", "Retirer")}</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Supreme-only: create a new batch — name + date window + agency + employer. */}
      <Modal open={showNew} onClose={() => !saving && setShowNew(false)} size="sm" busy={saving}
        title={T("New batch", "Neuer Batch", "Nouveau lot")}
        subtitle={T("An employer intake, e.g. \"UKSH Kiel — April 2027\".", "Ein Arbeitgeber-Intake, z.B. \"UKSH Kiel — April 2027\".", "Un recrutement employeur, p.ex. \"UKSH Kiel — April 2027\".")}
        footer={<><GhostButton onClick={() => setShowNew(false)} disabled={saving}>{T("Cancel", "Abbrechen", "Annuler")}</GhostButton>
          <GoldButton onClick={createBatch} disabled={saving || !form.name.trim()}>{T("Create", "Erstellen", "Créer")}</GoldButton></>}>
        <div className="px-5 py-4 space-y-3">
          <label className="block">
            <span className="text-[12px]" style={{ color: "var(--w3)" }}>{T("Name", "Name", "Nom")}</span>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="UKSH Kiel — April 2027"
              className="w-full mt-1 px-3 py-2 text-[14px] rounded-md" style={{ background: "var(--bg2)", color: "var(--w)", border: "1px solid var(--border)" }} />
          </label>
          <div className="flex gap-3">
            <label className="block w-24">
              <span className="text-[12px]" style={{ color: "var(--w3)" }}>{T("Seats", "Plätze", "Places")}</span>
              <input type="number" min={1} max={1000} value={form.seats} onChange={(e) => setForm({ ...form, seats: Math.max(1, Number(e.target.value) || 1) })}
                className="w-full mt-1 px-3 py-2 text-[14px] rounded-md" style={{ background: "var(--bg2)", color: "var(--w)", border: "1px solid var(--border)" }} />
            </label>
            <label className="block flex-1">
              <span className="text-[12px]" style={{ color: "var(--w3)" }}>{T("Agency (optional)", "Agentur (optional)", "Agence (optionnel)")}</span>
              <select value={form.orgId} onChange={(e) => setForm({ ...form, orgId: e.target.value })}
                className="w-full mt-1 px-3 py-2 text-[14px] rounded-md" style={{ background: "var(--bg2)", color: "var(--w)", border: "1px solid var(--border)" }}>
                <option value="">{T("— none —", "— keine —", "— aucune —")}</option>
                {organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="text-[12px]" style={{ color: "var(--w3)" }}>{T("Employer (optional)", "Arbeitgeber (optional)", "Employeur (optionnel)")}</span>
            <select value={form.employerId} onChange={(e) => setForm({ ...form, employerId: e.target.value })}
              className="w-full mt-1 px-3 py-2 text-[14px] rounded-md" style={{ background: "var(--bg2)", color: "var(--w)", border: "1px solid var(--border)" }}>
              <option value="">{T("— none —", "— keiner —", "— aucun —")}</option>
              {employers.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
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
