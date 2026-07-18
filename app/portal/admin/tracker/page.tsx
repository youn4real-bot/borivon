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
import { b2StageLabel, b2StageColor, normalizeB2Stage } from "@/lib/b2Journey";
import { ArrowLeft, Users, CalendarRange, Search, Plus, Check, X, Pencil, NotebookPen, FolderUp } from "lucide-react";

type Batch = { id: string; name: string; agency: string | null; employer: string | null; orgId: string | null; employerId: string | null; notes: string; seats: number; filled: number; targetStart: string | null; targetEnd: string | null };
type Employer = { id: string; name: string };
type Org = { id: string; name: string };
type Cand = {
  userId: string; name: string; batchId: string | null; funnelStage: string | null;
  b2Stage: string | null; b2Failed: boolean; b2ExamDate: string | null;
  interview1Status: string | null; interview1Date: string | null;
  interview2Status: string | null; interview2Date: string | null;
  agreementSigned: boolean;
  contractDone: boolean; visaApptDate: string | null; visaGranted: boolean; arrivedDone: boolean;
};

// The tracker interview cycle is a plain 3-state: none → passed → failed → none
// (every click visibly changes; no invisible "pending" step).
const nextInterview = (cur: string | null): string | null => (cur === "passed" ? "failed" : cur === "failed" ? null : "passed");

// One flat tone per step state — no gradients, no gold, deliberately calm.
type Tone = "done" | "fail" | "need" | "todo";
const TONE: Record<Tone, { bg: string; fg: string; bd: string }> = {
  done: { bg: "rgba(22,163,74,0.12)",  fg: "#16a34a", bd: "rgba(22,163,74,0.38)" },
  fail: { bg: "rgba(239,68,68,0.10)",  fg: "#ef4444", bd: "rgba(239,68,68,0.38)" },
  need: { bg: "rgba(245,158,11,0.12)", fg: "#c98212", bd: "rgba(245,158,11,0.42)" },
  todo: { bg: "var(--bg2)",            fg: "var(--w3)", bd: "var(--border)" },
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
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [employers, setEmployers] = useState<Employer[]>([]);
  const [organizations, setOrganizations] = useState<Org[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", seats: 12, orgId: "", employerId: "", targetStart: "", targetEnd: "" });
  // Edit an EXISTING batch (fix the date, name, seats, agency, employer).
  const [showEdit, setShowEdit] = useState(false);
  const [editForm, setEditForm] = useState({ name: "", seats: 12, orgId: "", employerId: "", targetStart: "", targetEnd: "" });
  // Batch notes — every admin (supreme + sub-admins) can write them.
  const [showNotes, setShowNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");

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
    const next = nextInterview(n === 1 ? c.interview1Status : c.interview2Status);
    if (n === 1) apply(c.userId, { interview1Status: next }, { interview1_status: next });
    else apply(c.userId, { interview2Status: next }, { interview2_status: next });
  };
  const toggleAgreement = (c: Cand) => apply(c.userId, { agreementSigned: !c.agreementSigned }, { agreement_signed: !c.agreementSigned });
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

  // Batch notes — open prefilled, save through the all-admins tracker route.
  const openNotes = () => { if (!batch) return; setNotesDraft(batch.notes ?? ""); setShowNotes(true); };
  const saveNotes = async () => {
    if (!batch || saving) return;
    setSaving(true);
    const res = await fetch("/api/portal/tracker", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ batchId: batch.id, notes: notesDraft }),
    }).catch(() => null);
    setSaving(false);
    if (res && res.ok) { setShowNotes(false); await load(token); }
    else setErr(T("Could not save the note.", "Notiz konnte nicht gespeichert werden.", "Impossible d'enregistrer la note."));
  };

  // Calmaroi → Drive backfill (supreme only): copy every Calmaroi candidate's
  // approved docs into the founder's Drive tree. Idempotent + cheap (sha-skip),
  // so it's safe to click repeatedly. Going forward it's automatic on approval.
  const syncCalmaroi = async () => {
    if (syncing) return;
    setSyncing(true); setSyncMsg("");
    try {
      const res = await fetch("/api/portal/admin/calmaroi-drive-sync", {
        method: "POST", headers: { Authorization: `Bearer ${token}` },
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        setSyncMsg(T(
          `Done — ${j.candidates} Calmaroi candidates: ${j.uploaded} files copied, ${j.unchanged} already up to date${j.errors?.length ? `, ${j.errors.length} errored` : ""}.`,
          `Fertig — ${j.candidates} Calmaroi-Kandidaten: ${j.uploaded} Dateien kopiert, ${j.unchanged} bereits aktuell${j.errors?.length ? `, ${j.errors.length} Fehler` : ""}.`,
          `Terminé — ${j.candidates} candidats Calmaroi : ${j.uploaded} fichiers copiés, ${j.unchanged} déjà à jour${j.errors?.length ? `, ${j.errors.length} en erreur` : ""}.`,
        ) + (j.hint ? ` (${j.hint})` : ""));
      } else {
        setSyncMsg(j.error || T("Sync failed.", "Synchronisation fehlgeschlagen.", "Échec de la synchronisation."));
      }
    } catch {
      setSyncMsg(T("Sync failed.", "Synchronisation fehlgeschlagen.", "Échec de la synchronisation."));
    } finally { setSyncing(false); }
  };

  // Open the edit modal prefilled with the selected batch's current values.
  const openEdit = () => {
    if (!batch) return;
    setEditForm({
      name: batch.name ?? "", seats: batch.seats ?? 12,
      orgId: batch.orgId ?? "", employerId: batch.employerId ?? "",
      targetStart: batch.targetStart ?? "", targetEnd: batch.targetEnd ?? "",
    });
    setShowEdit(true);
  };

  // Supreme-only: save the edits. Empty agency/employer/date clears that field.
  const saveEdit = async () => {
    if (!batch || !editForm.name.trim() || saving) return;
    setSaving(true);
    const res = await fetch("/api/portal/batches", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        batchId: batch.id,
        name: editForm.name.trim(), seats: editForm.seats,
        orgId: editForm.orgId, employerId: editForm.employerId,
        targetStart: editForm.targetStart, targetEnd: editForm.targetEnd,
      }),
    }).catch(() => null);
    setSaving(false);
    if (res && res.ok) { setShowEdit(false); await load(token); }
    else setErr(T("Could not save the batch.", "Batch konnte nicht gespeichert werden.", "Impossible d'enregistrer le lot."));
  };
  // "Too late" = the B2 exam lands after this batch's window (they can't be ready
  // in time), and they haven't already passed. The founder filters these out.
  const b2Deadline = useMemo(() => (batch ? batch.targetEnd || batch.targetStart : null), [batch]);
  const isB2Late = useCallback(
    (c: Cand) => c.b2Stage !== "passed" && !!c.b2ExamDate && !!b2Deadline && c.b2ExamDate > b2Deadline,
    [b2Deadline],
  );
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

  // Batch progress summary — leads with the beginning that matters most.
  const summary = useMemo(() => {
    const s = { i1: 0, agreement: 0, i2: 0, contract: 0, visa: 0, arrived: 0, b2: 0, b2late: 0 };
    for (const c of members) {
      if (c.b2Stage === "passed") s.b2++;
      if (isB2Late(c)) s.b2late++;
      if (c.interview1Status === "passed") s.i1++;
      if (c.agreementSigned) s.agreement++;
      if (c.interview2Status === "passed") s.i2++;
      if (c.contractDone) s.contract++;
      if (c.visaGranted) s.visa++;
      if (c.arrivedDone) s.arrived++;
    }
    return s;
  }, [members, isB2Late]);

  if (loading) return <PageLoader />;

  const fmtWindow = (b: Batch) => [b.targetStart, b.targetEnd].filter(Boolean).join(" → ");
  const fmtDay = (d: string) => new Date(d + "T00:00:00").toLocaleDateString(lang === "de" ? "de-DE" : lang === "fr" ? "fr-FR" : "en-GB", { day: "2-digit", month: "short", year: "numeric" });

  // One big, obvious step in the primary row (Interview 1 · Agreement · Interview 2).
  const Step = ({ label, tone, onClick }: { label: string; tone: Tone; onClick: () => void }) => {
    const t = TONE[tone];
    return (
      <button onClick={onClick}
        className="flex-1 min-w-0 flex items-center justify-center gap-1.5 px-2 py-3 rounded-xl transition-colors"
        style={{ background: t.bg, color: t.fg, border: `1px solid ${t.bd}` }}>
        {tone === "done" ? <Check size={15} strokeWidth={2.6} />
          : tone === "fail" ? <X size={15} strokeWidth={2.6} />
          : <span aria-hidden style={{ width: 9, height: 9, borderRadius: 99, border: `2px solid ${t.fg}` }} />}
        <span className="text-[12.5px] font-semibold truncate">{label}</span>
      </button>
    );
  };

  // Small, muted toggle for the later "after" stages (contract · visa · arrived).
  const Pill = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button onClick={onClick}
      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11.5px] font-semibold rounded-full transition-colors"
      style={{
        background: active ? "rgba(22,163,74,0.12)" : "var(--bg2)",
        color: active ? "#16a34a" : "var(--w3)",
        border: `1px solid ${active ? "rgba(22,163,74,0.38)" : "var(--border)"}`,
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
          {isSupreme && (
            <button onClick={syncCalmaroi} disabled={syncing} className="bv-btn bv-btn-ghost inline-flex"
              title={T("Copy every Calmaroi candidate's approved docs into your Google Drive (Calmaroi X Borivon / batch / candidate). Runs automatically on approval too.",
                       "Kopiert alle genehmigten Dokumente der Calmaroi-Kandidaten in dein Google Drive. Läuft auch automatisch bei Genehmigung.",
                       "Copie les documents approuvés de chaque candidat Calmaroi dans ton Google Drive. S'exécute aussi automatiquement à l'approbation.")}>
              <FolderUp size={15} strokeWidth={2} /> {syncing ? T("Syncing…", "Synchronisiere…", "Sync…") : T("Sync Calmaroi → Drive", "Calmaroi → Drive", "Calmaroi → Drive")}
            </button>
          )}
        </div>
      </div>
      {syncMsg && (
        <div className="mb-4 text-[13px] px-3 py-2 rounded-md" style={{ background: "var(--card)", color: "var(--w2)", border: "1px solid var(--border)" }}>
          {syncMsg}
        </div>
      )}

      {!batch ? (
        <div className="text-center py-16 text-[14px]" style={{ color: "var(--w3)" }}>
          {T("No open batch yet — create one on the Batches page first.", "Noch kein offener Batch — erstelle zuerst einen auf der Batches-Seite.", "Aucun lot ouvert — créez-en un d'abord sur la page Lots.")}
        </div>
      ) : (
        <>
          {/* Batch header + summary */}
          <div className="p-4 sm:p-5 mb-5" style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r-xl)" }}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-[16px] font-semibold" style={{ color: "var(--w)" }}>{batch.name}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]" style={{ color: "var(--w3)" }}>
                  {(batch.agency || batch.employer) && <span>{[batch.agency, batch.employer].filter(Boolean).join(" → ")}</span>}
                  {fmtWindow(batch) && <span className="inline-flex items-center gap-1"><CalendarRange size={12} /> {fmtWindow(batch)}</span>}
                  <span className="inline-flex items-center gap-1"><Users size={12} /> {members.length}/{batch.seats}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Batch note — every admin (supreme + sub-admins) can write it. */}
                <button onClick={openNotes} className="bv-btn bv-btn-ghost inline-flex"
                  title={T("Batch note", "Batch-Notiz", "Note du lot")}>
                  <NotebookPen size={14} strokeWidth={2} style={batch.notes ? { color: "var(--gold)" } : undefined} />
                  {T("Note", "Notiz", "Note")}
                </button>
                {isSupreme && (
                  <button onClick={openEdit} className="bv-btn bv-btn-ghost inline-flex">
                    <Pencil size={14} strokeWidth={2} /> {T("Edit", "Bearbeiten", "Modifier")}
                  </button>
                )}
                <button onClick={() => setAddOpen((v) => !v)} className="bv-btn bv-btn-gold inline-flex">
                  <Plus size={15} strokeWidth={2} /> {T("Add candidate", "Kandidat hinzufügen", "Ajouter un candidat")}
                </button>
              </div>
            </div>
            {/* progress chips — lead with the beginning */}
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px]" style={{ color: "var(--w2)" }}>
              <span>{T("B2 passed", "B2 bestanden", "B2 réussi")}: <b style={{ color: "var(--w)" }}>{summary.b2}/{members.length}</b></span>
              {summary.b2late > 0 && <span style={{ color: "#ef4444", fontWeight: 600 }}>{T("B2 too late", "B2 zu spät", "B2 trop tard")}: {summary.b2late}</span>}
              <span>{T("Interview 1", "Interview 1", "Entretien 1")}: <b style={{ color: "var(--w)" }}>{summary.i1}/{members.length}</b></span>
              <span>{T("Agreement", "Vereinbarung", "Accord")}: <b style={{ color: "var(--w)" }}>{summary.agreement}/{members.length}</b></span>
              <span>{T("Interview 2", "Interview 2", "Entretien 2")}: <b style={{ color: "var(--w)" }}>{summary.i2}/{members.length}</b></span>
              <span className="opacity-70">{T("Contract", "Vertrag", "Contrat")} {summary.contract} · {T("Visa", "Visum", "Visa")} {summary.visa} · {T("Arrived", "Angekommen", "Arrivés")} {summary.arrived}</span>
            </div>
            {/* The batch note, shown inline so it's visible at a glance */}
            {batch.notes && (
              <p className="mt-3 pt-3 text-[12px] whitespace-pre-wrap" style={{ borderTop: "1px solid var(--border)", color: "var(--w2)" }}>{batch.notes}</p>
            )}
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
            <>
              <p className="mb-2.5 text-[11.5px]" style={{ color: "var(--w3)" }}>
                {T("Tap a step to set it — green = done, red = failed. The agreement is signed right after Interview 1.",
                   "Tippe auf einen Schritt — grün = erledigt, rot = nicht bestanden. Die Vereinbarung wird direkt nach Interview 1 unterschrieben.",
                   "Touchez une étape — vert = fait, rouge = échoué. L'accord se signe juste après l'entretien 1.")}
              </p>
              <div className="space-y-2.5">
                {members.map((c) => {
                  const i1tone: Tone = c.interview1Status === "passed" ? "done" : c.interview1Status === "failed" ? "fail" : "todo";
                  const i2tone: Tone = c.interview2Status === "passed" ? "done" : c.interview2Status === "failed" ? "fail" : "todo";
                  // Agreement is REQUIRED after Interview 1 → amber "need" once I1 passed but not yet signed.
                  const agTone: Tone = c.agreementSigned ? "done" : c.interview1Status === "passed" ? "need" : "todo";
                  return (
                    <div key={c.userId} className="p-4" style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r-xl)" }}>
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="min-w-0">
                          <p className="text-[14px] font-semibold truncate" style={{ color: "var(--w)" }}>{c.name}</p>
                          {/* B2 readiness — status + the date they'll pass, flagged red if too late for the window */}
                          {(() => {
                            const stage = normalizeB2Stage(c.b2Stage);
                            const passed = stage === "passed";
                            const dot = passed ? "#16a34a" : b2StageColor(stage);
                            const late = isB2Late(c);
                            return (
                              <div className="mt-1 flex items-center gap-2 flex-wrap text-[11px]">
                                <span className="inline-flex items-center gap-1.5" style={{ color: "var(--w3)" }}>
                                  <span aria-hidden style={{ width: 8, height: 8, borderRadius: 99, background: dot, boxShadow: c.b2Failed && !passed ? "0 0 0 2px rgba(239,68,68,0.55)" : "none" }} />
                                  <span style={{ color: "var(--w2)" }}>B2: {c.b2Stage ? b2StageLabel(stage, lang) : T("not set", "offen", "non défini")}</span>
                                  {c.b2ExamDate && <span>· {fmtDay(c.b2ExamDate)}</span>}
                                </span>
                                {late && <span className="px-1.5 py-px rounded-full font-semibold" style={{ background: "rgba(239,68,68,0.12)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.4)" }}>{T("too late", "zu spät", "trop tard")}</span>}
                              </div>
                            );
                          })()}
                        </div>
                        <button onClick={() => removeFromBatch(c)} className="text-[11px] flex-shrink-0 hover:opacity-70" style={{ color: "var(--w3)" }}>{T("Remove", "Entfernen", "Retirer")}</button>
                      </div>

                      {/* The beginning that matters: Interview 1 → Agreement → Interview 2 */}
                      <div className="flex items-stretch gap-2">
                        <Step label={`${T("Interview", "Interview", "Entretien")} 1`} tone={i1tone} onClick={() => cycleInterview(c, 1)} />
                        <Step label={T("Agreement", "Vereinbarung", "Accord")} tone={agTone} onClick={() => toggleAgreement(c)} />
                        <Step label={`${T("Interview", "Interview", "Entretien")} 2`} tone={i2tone} onClick={() => cycleInterview(c, 2)} />
                      </div>

                      {/* Later stages — smaller and muted; the beginning is what counts */}
                      <div className="mt-2.5 flex flex-wrap items-center gap-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--w3)" }}>{T("Later", "Später", "Ensuite")}</span>
                        <Pill active={c.contractDone} onClick={() => apply(c.userId, { contractDone: !c.contractDone }, { contract_done: !c.contractDone })}>{T("Contract", "Vertrag", "Contrat")}</Pill>
                        <Pill active={c.visaGranted} onClick={() => apply(c.userId, { visaGranted: !c.visaGranted }, { visa_granted: !c.visaGranted })}>{T("Visa", "Visum", "Visa")}</Pill>
                        <Pill active={c.arrivedDone} onClick={() => apply(c.userId, { arrivedDone: !c.arrivedDone }, { arrived_done: !c.arrivedDone })}>{T("Arrived", "Angekommen", "Arrivé")}</Pill>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}

      {/* Batch note — supreme admin + sub-admins. Candidates never see this page. */}
      <Modal open={showNotes} onClose={() => !saving && setShowNotes(false)} size="sm" busy={saving}
        title={T("Batch note", "Batch-Notiz", "Note du lot")}
        subtitle={batch ? batch.name : ""}
        footer={<><GhostButton onClick={() => setShowNotes(false)} disabled={saving}>{T("Cancel", "Abbrechen", "Annuler")}</GhostButton>
          <GoldButton onClick={saveNotes} disabled={saving}>{T("Save", "Speichern", "Enregistrer")}</GoldButton></>}>
        <div className="px-5 py-4">
          <textarea value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)} rows={7} autoFocus
            placeholder={T("Anything about this batch — what's agreed, what's pending, who to chase…", "Alles zu diesem Batch — was vereinbart ist, was offen ist, wer nachzufassen ist…", "Tout sur ce lot — ce qui est convenu, en attente, qui relancer…")}
            className="w-full px-3 py-2 text-[14px] rounded-md outline-none resize-y"
            style={{ background: "var(--bg2)", color: "var(--w)", border: "1px solid var(--border)", minHeight: 150 }} />
          <p className="mt-2 text-[11px]" style={{ color: "var(--w3)" }}>
            {T("Visible to you and your sub-admins only.", "Nur für dich und deine Sub-Admins sichtbar.", "Visible seulement par vous et vos sous-admins.")}
          </p>
        </div>
      </Modal>

      {/* Supreme-only: EDIT this batch — fix the start date, name, seats, agency, employer. */}
      <Modal open={showEdit} onClose={() => !saving && setShowEdit(false)} size="sm" busy={saving}
        title={T("Edit batch", "Batch bearbeiten", "Modifier le lot")}
        subtitle={T("Fix the dates, name, seats, agency or employer.", "Termine, Name, Plätze, Agentur oder Arbeitgeber korrigieren.", "Corrigez les dates, le nom, les places, l'agence ou l'employeur.")}
        footer={<><GhostButton onClick={() => setShowEdit(false)} disabled={saving}>{T("Cancel", "Abbrechen", "Annuler")}</GhostButton>
          <GoldButton onClick={saveEdit} disabled={saving || !editForm.name.trim()}>{T("Save", "Speichern", "Enregistrer")}</GoldButton></>}>
        <div className="px-5 py-4 space-y-3">
          <label className="block">
            <span className="text-[12px]" style={{ color: "var(--w3)" }}>{T("Name", "Name", "Nom")}</span>
            <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              className="w-full mt-1 px-3 py-2 text-[14px] rounded-md" style={{ background: "var(--bg2)", color: "var(--w)", border: "1px solid var(--border)" }} />
          </label>
          <div className="flex gap-3">
            <label className="block w-24">
              <span className="text-[12px]" style={{ color: "var(--w3)" }}>{T("Seats", "Plätze", "Places")}</span>
              <input type="number" min={1} max={1000} value={editForm.seats} onChange={(e) => setEditForm({ ...editForm, seats: Math.max(1, Number(e.target.value) || 1) })}
                className="w-full mt-1 px-3 py-2 text-[14px] rounded-md" style={{ background: "var(--bg2)", color: "var(--w)", border: "1px solid var(--border)" }} />
            </label>
            <label className="block flex-1">
              <span className="text-[12px]" style={{ color: "var(--w3)" }}>{T("Agency (optional)", "Agentur (optional)", "Agence (optionnel)")}</span>
              <select value={editForm.orgId} onChange={(e) => setEditForm({ ...editForm, orgId: e.target.value })}
                className="w-full mt-1 px-3 py-2 text-[14px] rounded-md" style={{ background: "var(--bg2)", color: "var(--w)", border: "1px solid var(--border)" }}>
                <option value="">{T("— none —", "— keine —", "— aucune —")}</option>
                {organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="text-[12px]" style={{ color: "var(--w3)" }}>{T("Employer (optional)", "Arbeitgeber (optional)", "Employeur (optionnel)")}</span>
            <select value={editForm.employerId} onChange={(e) => setEditForm({ ...editForm, employerId: e.target.value })}
              className="w-full mt-1 px-3 py-2 text-[14px] rounded-md" style={{ background: "var(--bg2)", color: "var(--w)", border: "1px solid var(--border)" }}>
              <option value="">{T("— none —", "— keiner —", "— aucun —")}</option>
              {employers.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
          <div className="flex gap-3">
            <label className="block flex-1">
              <span className="text-[12px]" style={{ color: "var(--w3)" }}>{T("Window start", "Fenster-Start", "Début fenêtre")}</span>
              <input type="date" value={editForm.targetStart} onChange={(e) => setEditForm({ ...editForm, targetStart: e.target.value })}
                className="w-full mt-1 px-3 py-2 text-[14px] rounded-md" style={{ background: "var(--bg2)", color: "var(--w)", border: "1px solid var(--border)" }} />
            </label>
            <label className="block flex-1">
              <span className="text-[12px]" style={{ color: "var(--w3)" }}>{T("Window end", "Fenster-Ende", "Fin fenêtre")}</span>
              <input type="date" value={editForm.targetEnd} onChange={(e) => setEditForm({ ...editForm, targetEnd: e.target.value })}
                className="w-full mt-1 px-3 py-2 text-[14px] rounded-md" style={{ background: "var(--bg2)", color: "var(--w)", border: "1px solid var(--border)" }} />
            </label>
          </div>
        </div>
      </Modal>

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
