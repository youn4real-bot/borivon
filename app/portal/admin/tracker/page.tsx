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
import { ArrowLeft, Users, CalendarRange, Search, Plus, Check, X, Pencil, NotebookPen, FolderUp, CalendarClock, GripVertical } from "lucide-react";
import { DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, sortableKeyboardCoordinates, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/** Sortable wrapper for one tracker row. Render-prop so the card can place the
 *  drag HANDLE itself — dragging is handle-only, or every tap on a step button
 *  would start a drag instead of setting the step. */
function SortableRow({ id, children }: { id: string; children: (h: { listeners: Record<string, unknown> | undefined; isDragging: boolean }) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div ref={setNodeRef} {...attributes}
      style={{
        transform: CSS.Transform.toString(transform), transition,
        opacity: isDragging ? 0.6 : 1,
        zIndex: isDragging ? 20 : undefined,
        position: "relative",
      }}>
      {children({ listeners: listeners as Record<string, unknown> | undefined, isDragging })}
    </div>
  );
}

/** Initials for the little profile avatar — first + last, never more than 2. */
function initialsOf(name: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return ((parts[0][0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "")).toUpperCase();
}

type Batch = { id: string; name: string; agency: string | null; employer: string | null; orgId: string | null; employerId: string | null; notes: string; seats: number; filled: number; targetStart: string | null; targetEnd: string | null };
type Employer = { id: string; name: string };
type Org = { id: string; name: string };
type Cand = {
  userId: string; name: string; batchId: string | null; funnelStage: string | null;
  b2Stage: string | null; b2Failed: boolean; b2ExamDate: string | null;
  interview1Status: string | null; interview1Date: string | null;
  interview2Status: string | null; interview2Date: string | null;
  boardOrder: number | null;
  poolContacted: boolean; poolCallDone: boolean; poolCvDone: boolean; poolMedicalDone: boolean;
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
  // Direct link to the Drive folder the sync actually wrote to — so "did it land
  // in WORK?" is one click to verify instead of hunting through Drive.
  const [syncUrl, setSyncUrl] = useState("");
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
  // Interview self-scheduler — propose times to a candidate.
  const [proposeFor, setProposeFor] = useState<Cand | null>(null);
  const [proposeRound, setProposeRound] = useState<1 | 2>(1);
  const [proposeSlots, setProposeSlots] = useState<string[]>(["", "", ""]);
  const [proposeNote, setProposeNote] = useState("");
  const [proposeMsg, setProposeMsg] = useState("");
  const [proposing, setProposing] = useState(false);
  // Pool panel — collapsed by default so the batch stays the focus.
  const [poolOpen, setPoolOpen] = useState(false);
  const [poolQuery, setPoolQuery] = useState("");

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

  // Interview self-scheduler — open the propose modal for a candidate.
  const openPropose = (c: Cand) => { setProposeFor(c); setProposeRound(1); setProposeSlots(["", "", ""]); setProposeNote(""); setProposeMsg(""); };
  const submitPropose = async () => {
    if (!proposeFor || proposing) return;
    const slots = proposeSlots.map((s) => s.trim()).filter(Boolean);
    if (slots.length === 0) { setProposeMsg(T("Add at least one time.", "Mindestens einen Termin angeben.", "Ajoutez au moins un créneau.")); return; }
    setProposing(true);
    const res = await fetch("/api/portal/admin/interview-proposals", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ candidateUserId: proposeFor.userId, round: proposeRound, slots, note: proposeNote.trim() || undefined }),
    }).catch(() => null);
    setProposing(false);
    if (res && res.ok) { setProposeMsg(T("Sent — the candidate can now pick a time.", "Gesendet — der Kandidat kann jetzt wählen.", "Envoyé — le candidat peut choisir.")); setTimeout(() => setProposeFor(null), 1200); }
    else setProposeMsg(T("Could not send.", "Konnte nicht senden.", "Échec de l'envoi."));
  };

  // Sync the SELECTED batch → Drive (supreme only): copy every approved doc of
  // every candidate in this batch into the founder's Drive tree
  // ("<Agency> X Borivon / <Batch> / <Candidate>"). Idempotent + cheap (sha-skip),
  // safe to click repeatedly; the route is time-budgeted so the button loops
  // until it reports done.
  const syncBatch = async () => {
    if (syncing || !batch) return;
    setSyncing(true);
    setSyncUrl("");
    setSyncMsg(T("Working…", "Arbeite…", "En cours…"));
    let totalUploaded = 0;
    let totalArchived = 0; // outdated copies pulled out of the agency's view
    let totalMissing = 0;  // approved docs whose stored file couldn't be read — must be seen, not hidden
    let candidates = 0;
    let folder = "";
    let hint = "";
    const errUsers = new Set<string>();
    try {
      for (let pass = 0; pass < 15; pass++) {
        const res = await fetch("/api/portal/admin/batch-drive-sync", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ batchId: batch.id }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          setSyncMsg(j.error || T("Sync failed.", "Synchronisation fehlgeschlagen.", "Échec de la synchronisation."));
          setSyncing(false);
          return;
        }
        totalUploaded += j.uploaded ?? 0;
        totalArchived += j.archived ?? 0;
        totalMissing += j.missing ?? 0;
        candidates = j.candidates ?? candidates;
        if (j.folder) folder = j.folder;
        if (j.folderUrl) setSyncUrl(String(j.folderUrl));
        if (j.hint) hint = j.hint;
        for (const e of (j.errors ?? [])) errUsers.add(e.userId);
        setSyncMsg(T(
          `Working… ${totalUploaded} files copied so far`,
          `Arbeite… ${totalUploaded} Dateien bisher kopiert`,
          `En cours… ${totalUploaded} fichiers copiés`,
        ));
        if (j.done) break;
      }
      setSyncMsg(T(
        `Done — copied ${totalUploaded} files across ${candidates} candidates${totalArchived ? `, moved ${totalArchived} outdated to Archiv` : ""}${totalMissing ? `, ⚠ ${totalMissing} could not be copied (missing file)` : ""}${errUsers.size ? `, ${errUsers.size} errored` : ""}. In your Drive: "${folder || batch.name}".`,
        `Fertig — ${totalUploaded} Dateien für ${candidates} Kandidaten kopiert${totalArchived ? `, ${totalArchived} veraltete ins Archiv verschoben` : ""}${totalMissing ? `, ⚠ ${totalMissing} nicht kopierbar (Datei fehlt)` : ""}${errUsers.size ? `, ${errUsers.size} Fehler` : ""}. In deinem Drive: "${folder || batch.name}".`,
        `Terminé — ${totalUploaded} fichiers copiés pour ${candidates} candidats${totalArchived ? `, ${totalArchived} obsolètes déplacés vers Archiv` : ""}${totalMissing ? `, ⚠ ${totalMissing} non copiés (fichier manquant)` : ""}${errUsers.size ? `, ${errUsers.size} en erreur` : ""}. Dans ton Drive : "${folder || batch.name}".`,
      ) + (hint ? ` (${hint})` : ""));
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
    // Board order first (what the founder dragged), name as the stable fallback
    // so an un-dragged board looks exactly as it always did.
    () => candidates.filter((c) => c.batchId === selectedBatch).sort((a, b) => {
      const ao = a.boardOrder, bo = b.boardOrder;
      if (ao != null && bo != null) return ao - bo;
      if (ao != null) return -1;
      if (bo != null) return 1;
      return a.name.localeCompare(b.name);
    }),
    [candidates, selectedBatch],
  );
  const addable = useMemo(() => {
    const q = addQuery.trim().toLowerCase();
    return candidates
      .filter((c) => c.batchId !== selectedBatch)
      .filter((c) => !q || c.name.toLowerCase().includes(q))
      .slice(0, 40);
  }, [candidates, selectedBatch, addQuery]);

  // ── THE POOL ── candidates with NO batch yet: the warm bench. A nurse messages
  // on WhatsApp, we do an onboarding call and make her a free CV + medical; months
  // later a hospital calls with slots and she remembers who treated her well. They
  // were previously invisible on this board (17 of 76 candidates were in a batch),
  // so the majority of the database had nowhere to be seen or worked.
  const poolReady = (c: Cand) => c.poolContacted && c.poolCallDone && c.poolCvDone && c.poolMedicalDone;
  const poolDoneCount = (c: Cand) =>
    (c.poolContacted ? 1 : 0) + (c.poolCallDone ? 1 : 0) + (c.poolCvDone ? 1 : 0) + (c.poolMedicalDone ? 1 : 0);
  const pool = useMemo(() => {
    const q = poolQuery.trim().toLowerCase();
    return candidates
      .filter((c) => !c.batchId)
      .filter((c) => !q || c.name.toLowerCase().includes(q))
      // READY FIRST — the whole point: when a hospital calls, the people you can
      // offer today are at the top. Then most-progressed, then alphabetical.
      .sort((a, b) => (poolDoneCount(b) - poolDoneCount(a)) || a.name.localeCompare(b.name));
  }, [candidates, poolQuery]);
  const poolReadyCount = useMemo(() => pool.filter(poolReady).length, [pool]);

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

  // Drag to reorder the board. Handle-only (see SortableRow) with a small
  // activation distance, so a tap on a step button is never mistaken for a drag
  // — on a touch screen that difference is the whole usability of the page.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = useCallback((e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = members.map((m) => m.userId);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const next = arrayMove(ids, from, to);
    // Optimistic: stamp the new position locally so the list settles instantly,
    // then persist the whole order in ONE request (never half-applied).
    setCandidates((cs) => cs.map((c) => {
      const i = next.indexOf(c.userId);
      return i >= 0 ? { ...c, boardOrder: i } : c;
    }));
    fetch("/api/portal/tracker", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ reorder: next }),
    })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        // Tell the truth if the order won't survive a reload (migration not run).
        if (r.ok && j?.persisted === false) {
          setErr(T("Order shown but not saved — run the board_order migration.",
                   "Reihenfolge angezeigt, aber nicht gespeichert — board_order-Migration ausführen.",
                   "Ordre affiché mais non enregistré — exécute la migration board_order."));
        } else if (!r.ok) {
          setErr(T("Could not save the new order.", "Reihenfolge konnte nicht gespeichert werden.", "Impossible d'enregistrer l'ordre."));
        }
      })
      .catch(() => setErr(T("Could not save the new order.", "Reihenfolge konnte nicht gespeichert werden.", "Impossible d'enregistrer l'ordre.")));
  }, [members, token, T]);

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
            <button onClick={syncBatch} disabled={syncing || !batch} className="bv-btn bv-btn-ghost inline-flex"
              title={T("Copy this batch's candidates' approved docs into your Google Drive (Agency X Borivon / batch / candidate). Manual — only when you click.",
                       "Kopiert die genehmigten Dokumente der Kandidaten dieses Batches in dein Google Drive. Manuell — nur auf Klick.",
                       "Copie les documents approuvés des candidats de ce lot dans ton Google Drive. Manuel — seulement au clic.")}>
              <FolderUp size={15} strokeWidth={2} /> {syncing ? T("Syncing…", "Synchronisiere…", "Sync…") : T("Sync this batch → Drive", "Batch → Drive", "Lot → Drive")}
            </button>
          )}
        </div>
      </div>
      {syncMsg && (
        <div className="mb-4 text-[13px] px-3 py-2 rounded-md" style={{ background: "var(--card)", color: "var(--w2)", border: "1px solid var(--border)" }}>
          {syncMsg}
          {syncUrl && (
            <>
              {" "}
              <a href={syncUrl} target="_blank" rel="noreferrer" className="font-semibold underline" style={{ color: "var(--gold)" }}>
                {T("Open the folder →", "Ordner öffnen →", "Ouvrir le dossier →")}
              </a>
            </>
          )}
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
                {T("Tap a step to set it — green = done, red = failed. Drag the handle to reorder. The agreement is signed right after Interview 1.",
                   "Tippe auf einen Schritt — grün = erledigt, rot = nicht bestanden. Zum Umsortieren am Griff ziehen. Die Vereinbarung wird direkt nach Interview 1 unterschrieben.",
                   "Touchez une étape — vert = fait, rouge = échoué. L'accord se signe juste après l'entretien 1.")}
              </p>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={members.map((m) => m.userId)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-2">
                    {members.map((c) => {
                      const i1tone: Tone = c.interview1Status === "passed" ? "done" : c.interview1Status === "failed" ? "fail" : "todo";
                      const i2tone: Tone = c.interview2Status === "passed" ? "done" : c.interview2Status === "failed" ? "fail" : "todo";
                      // Agreement is REQUIRED after Interview 1 → amber "need" once I1 passed but not yet signed.
                      const agTone: Tone = c.agreementSigned ? "done" : c.interview1Status === "passed" ? "need" : "todo";
                      const stage = normalizeB2Stage(c.b2Stage);
                      const passed = stage === "passed";
                      const dot = passed ? "#16a34a" : b2StageColor(stage);
                      const late = isB2Late(c);
                      return (
                        <SortableRow key={c.userId} id={c.userId}>
                          {({ listeners, isDragging }) => (
                            <div className="group px-3 py-3 sm:px-3.5 transition-shadow" style={{
                              background: "var(--card)",
                              border: `1px solid ${isDragging ? "var(--border-gold)" : "var(--border)"}`,
                              borderRadius: "var(--r-xl)",
                              boxShadow: isDragging ? "var(--shadow-md)" : "none",
                            }}>
                              {/* ── identity row: handle · avatar · name+B2 · actions ── */}
                              <div className="flex items-center gap-2.5">
                                {/* Handle: dragging is handle-only so taps on steps stay taps.
                                    bv-touch gives it a 44px hit area on phones. */}
                                <button {...listeners} aria-label={T("Reorder", "Verschieben", "Réordonner")}
                                  className="bv-touch flex-shrink-0 -ml-1 p-0.5 rounded-md opacity-40 group-hover:opacity-100 transition-opacity"
                                  style={{ color: "var(--w3)", cursor: isDragging ? "grabbing" : "grab", touchAction: "none" }}>
                                  <GripVertical size={16} />
                                </button>

                                {/* Minimal profile avatar — initials, no photo to load */}
                                <span aria-hidden className="flex-shrink-0 grid place-items-center rounded-full text-[11px] font-bold"
                                  style={{ width: 32, height: 32, background: "var(--bg2)", color: "var(--gold)", border: "1px solid var(--border)" }}>
                                  {initialsOf(c.name)}
                                </span>

                                <div className="min-w-0 flex-1">
                                  <p className="text-[13.5px] font-semibold truncate leading-tight" style={{ color: "var(--w)" }}>{c.name}</p>
                                  <div className="mt-0.5 flex items-center gap-1.5 flex-wrap text-[11px] leading-tight">
                                    <span aria-hidden style={{ width: 7, height: 7, borderRadius: 99, background: dot, boxShadow: c.b2Failed && !passed ? "0 0 0 2px rgba(239,68,68,0.55)" : "none" }} />
                                    <span style={{ color: "var(--w3)" }}>
                                      B2: {c.b2Stage ? b2StageLabel(stage, lang) : T("not set", "offen", "non défini")}
                                      {c.b2ExamDate && <> · {fmtDay(c.b2ExamDate)}</>}
                                    </span>
                                    {late && <span className="px-1.5 rounded-full font-semibold" style={{ background: "rgba(239,68,68,0.12)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.4)" }}>{T("too late", "zu spät", "trop tard")}</span>}
                                  </div>
                                </div>

                                {/* Actions stay quiet until you hover the card — less noise per row */}
                                <div className="flex items-center gap-1 flex-shrink-0 opacity-55 group-hover:opacity-100 transition-opacity">
                                  <button onClick={() => openPropose(c)} title={T("Propose interview times", "Interview-Termine vorschlagen", "Proposer des créneaux d'entretien")}
                                    className="bv-touch grid place-items-center rounded-lg h-8 w-8 hover:[background:var(--bg2)]" style={{ color: "var(--w3)" }}>
                                    <CalendarClock size={15} />
                                  </button>
                                  <button onClick={() => removeFromBatch(c)} title={T("Remove from batch", "Aus Batch entfernen", "Retirer du lot")}
                                    className="bv-touch grid place-items-center rounded-lg h-8 w-8 hover:[background:var(--bg2)]" style={{ color: "var(--w3)" }}>
                                    <X size={15} />
                                  </button>
                                </div>
                              </div>

                              {/* ── the three steps that matter: Interview 1 → Agreement → Interview 2 ── */}
                              <div className="mt-2.5 flex items-stretch gap-1.5">
                                <Step label={`${T("Interview", "Interview", "Entretien")} 1`} tone={i1tone} onClick={() => cycleInterview(c, 1)} />
                                <Step label={T("Agreement", "Vereinbarung", "Accord")} tone={agTone} onClick={() => toggleAgreement(c)} />
                                <Step label={`${T("Interview", "Interview", "Entretien")} 2`} tone={i2tone} onClick={() => cycleInterview(c, 2)} />
                              </div>

                              {/* ── later stages: muted, and out of the way until they matter ── */}
                              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                <span className="text-[9.5px] font-semibold uppercase tracking-wider mr-0.5" style={{ color: "var(--w3)" }}>{T("Later", "Später", "Ensuite")}</span>
                                <Pill active={c.contractDone} onClick={() => apply(c.userId, { contractDone: !c.contractDone }, { contract_done: !c.contractDone })}>{T("Contract", "Vertrag", "Contrat")}</Pill>
                                <Pill active={c.visaGranted} onClick={() => apply(c.userId, { visaGranted: !c.visaGranted }, { visa_granted: !c.visaGranted })}>{T("Visa", "Visum", "Visa")}</Pill>
                                <Pill active={c.arrivedDone} onClick={() => apply(c.userId, { arrivedDone: !c.arrivedDone }, { arrived_done: !c.arrivedDone })}>{T("Arrived", "Angekommen", "Arrivé")}</Pill>
                              </div>
                            </div>
                          )}
                        </SortableRow>
                      );
                    })}
                  </div>
                </SortableContext>
              </DndContext>

              {/* ── THE POOL ── everyone with no batch yet. This is the bench you
                  draw from the day a hospital calls with slots, so the people who
                  are actually offerable (all four steps green) sit at the top. */}
              <div className="mt-6 rounded-2xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                <button onClick={() => setPoolOpen((v) => !v)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:[background:var(--bg2)] transition-colors">
                  <span className="flex items-center gap-2 min-w-0">
                    <Users size={15} style={{ color: "var(--gold)" }} />
                    <span className="text-[13.5px] font-semibold" style={{ color: "var(--w)" }}>
                      {T("Pool", "Pool", "Vivier")}
                    </span>
                    <span className="text-[12px]" style={{ color: "var(--w3)" }}>
                      {pool.length} {T("waiting for a place", "warten auf einen Platz", "en attente d'une place")}
                    </span>
                    {poolReadyCount > 0 && (
                      <span className="px-1.5 py-px rounded-full text-[11px] font-semibold"
                        style={{ background: "rgba(22,163,74,0.12)", color: "#16a34a", border: "1px solid rgba(22,163,74,0.38)" }}>
                        {poolReadyCount} {T("ready", "bereit", "prêts")}
                      </span>
                    )}
                  </span>
                  <span className="text-[12px] flex-shrink-0" style={{ color: "var(--w3)" }}>{poolOpen ? "▲" : "▼"}</span>
                </button>

                {poolOpen && (
                  <div className="px-3 pb-3 sm:px-3.5">
                    <p className="mb-2.5 text-[11.5px] leading-relaxed" style={{ color: "var(--w3)" }}>
                      {T("Nurses who reached out but have no place yet. Do the onboarding call, give them the free CV and medical — then when a hospital calls, offer the ones who are ready.",
                         "Pflegekräfte ohne Platz. Onboarding-Call machen, kostenlosen Lebenslauf + Medical geben — wenn dann ein Krankenhaus anruft, bietest du die Bereiten an.",
                         "Infirmières sans place. Fais l'appel d'intégration, offre le CV et le médical — quand un hôpital appelle, propose celles qui sont prêtes.")}
                    </p>
                    <div className="mb-2.5 flex items-center gap-2 px-2.5 py-1.5 rounded-lg" style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
                      <Search size={14} style={{ color: "var(--w3)" }} />
                      <input value={poolQuery} onChange={(e) => setPoolQuery(e.target.value)}
                        placeholder={T("Search the pool…", "Pool durchsuchen…", "Rechercher…")}
                        className="w-full bg-transparent outline-none text-[13px]" style={{ color: "var(--w)" }} />
                    </div>

                    {pool.length === 0 ? (
                      <p className="py-6 text-center text-[13px]" style={{ color: "var(--w3)" }}>
                        {T("Nobody waiting.", "Niemand wartet.", "Personne en attente.")}
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {pool.map((c) => {
                          const ready = poolReady(c);
                          return (
                            <div key={c.userId} className="group px-3 py-2.5 rounded-xl" style={{
                              background: "var(--bg2)",
                              border: `1px solid ${ready ? "rgba(22,163,74,0.38)" : "var(--border)"}`,
                            }}>
                              <div className="flex items-center gap-2.5">
                                <span aria-hidden className="flex-shrink-0 grid place-items-center rounded-full text-[10.5px] font-bold"
                                  style={{ width: 28, height: 28, background: "var(--card)", color: ready ? "#16a34a" : "var(--gold)", border: "1px solid var(--border)" }}>
                                  {initialsOf(c.name)}
                                </span>
                                <p className="flex-1 min-w-0 text-[13px] font-semibold truncate" style={{ color: "var(--w)" }}>{c.name}</p>
                                {ready && (
                                  <span className="flex-shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: "#16a34a" }}>
                                    <Check size={12} strokeWidth={2.6} />{T("ready", "bereit", "prêt")}
                                  </span>
                                )}
                                {selectedBatch && (
                                  <button onClick={() => addToBatch(c)}
                                    title={T("Add to this batch", "Zu diesem Batch hinzufügen", "Ajouter à ce lot")}
                                    className="bv-touch flex-shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11.5px] font-semibold opacity-70 group-hover:opacity-100 transition-opacity"
                                    style={{ background: "var(--card)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>
                                    <Plus size={12} strokeWidth={2.6} />{T("Place", "Platzieren", "Placer")}
                                  </button>
                                )}
                              </div>
                              {/* The pre-batch journey: contact → call → free CV → medical */}
                              <div className="mt-2 flex items-stretch gap-1.5">
                                <Step label={T("Contact", "Kontakt", "Contact")} tone={c.poolContacted ? "done" : "todo"}
                                  onClick={() => apply(c.userId, { poolContacted: !c.poolContacted }, { pool_contacted: !c.poolContacted })} />
                                <Step label={T("Call", "Anruf", "Appel")} tone={c.poolCallDone ? "done" : "todo"}
                                  onClick={() => apply(c.userId, { poolCallDone: !c.poolCallDone }, { pool_call_done: !c.poolCallDone })} />
                                <Step label={T("CV", "Lebenslauf", "CV")} tone={c.poolCvDone ? "done" : "todo"}
                                  onClick={() => apply(c.userId, { poolCvDone: !c.poolCvDone }, { pool_cv_done: !c.poolCvDone })} />
                                <Step label={T("Medical", "Medical", "Médical")} tone={c.poolMedicalDone ? "done" : "todo"}
                                  onClick={() => apply(c.userId, { poolMedicalDone: !c.poolMedicalDone }, { pool_medical_done: !c.poolMedicalDone })} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
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

      {/* Interview self-scheduler — propose up to 3 times to the candidate. */}
      <Modal open={!!proposeFor} onClose={() => !proposing && setProposeFor(null)} size="sm" busy={proposing}
        title={T("Propose interview times", "Interview-Termine vorschlagen", "Proposer des créneaux")}
        subtitle={proposeFor ? proposeFor.name : ""}
        footer={<><GhostButton onClick={() => setProposeFor(null)} disabled={proposing}>{T("Cancel", "Abbrechen", "Annuler")}</GhostButton>
          <GoldButton onClick={submitPropose} disabled={proposing}>{T("Send to candidate", "An Kandidat senden", "Envoyer au candidat")}</GoldButton></>}>
        <div className="px-5 py-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-[12px]" style={{ color: "var(--w3)" }}>{T("Which interview", "Welches Interview", "Quel entretien")}:</span>
            {([1, 2] as const).map((r) => (
              <button key={r} onClick={() => setProposeRound(r)} className="px-3 py-1 text-[12px] font-semibold rounded-full"
                style={proposeRound === r ? { background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" } : { background: "var(--bg2)", color: "var(--w3)", border: "1px solid var(--border)" }}>
                {r === 1 ? T("Interview 1", "Interview 1", "Entretien 1") : T("Interview 2", "Interview 2", "Entretien 2")}
              </button>
            ))}
          </div>
          <div className="space-y-2">
            <span className="text-[12px]" style={{ color: "var(--w3)" }}>{T("Offer up to 3 times", "Bis zu 3 Termine anbieten", "Proposez jusqu'à 3 créneaux")}</span>
            {proposeSlots.map((s, i) => (
              <input key={i} type="datetime-local" value={s} onChange={(e) => setProposeSlots((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))}
                className="w-full px-3 py-2 text-[13.5px] rounded-md" style={{ background: "var(--bg2)", color: "var(--w)", border: "1px solid var(--border)" }} />
            ))}
          </div>
          <label className="block">
            <span className="text-[12px]" style={{ color: "var(--w3)" }}>{T("Note (optional)", "Notiz (optional)", "Note (optionnel)")}</span>
            <input value={proposeNote} onChange={(e) => setProposeNote(e.target.value)} placeholder={T("e.g. video call, ~30 min", "z.B. Videoanruf, ~30 Min.", "p.ex. appel vidéo, ~30 min")}
              className="w-full mt-1 px-3 py-2 text-[13.5px] rounded-md" style={{ background: "var(--bg2)", color: "var(--w)", border: "1px solid var(--border)" }} />
          </label>
          {proposeMsg && <p className="text-[12px]" style={{ color: "var(--w2)" }}>{proposeMsg}</p>}
        </div>
      </Modal>
    </main>
  );
}
