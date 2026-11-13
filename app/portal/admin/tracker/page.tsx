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
import { Modal } from "@/components/ui/Modal";
import { b2StageLabel, normalizeB2Stage } from "@/lib/b2Journey";
import { Search, Plus, Check, X, Pencil, NotebookPen, FolderUp, CalendarClock, GripVertical, MoreHorizontal } from "lucide-react";
import { PageHead, Btn, Card, Seg, Dot, Field, Empty, Pager, usePaged, STATUS_DOT, STATUS_TINT, type Status } from "@/components/fx/kit";
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

// One flat tone per step state — the one status palette (components/fx/kit, LAW #4):
// done = green, failed = red, needed now = orange, not yet = grey.
type Tone = "done" | "fail" | "need" | "todo";
const TONE: Record<Tone, Status> = { done: "approved", fail: "rejected", need: "pending", todo: "missing" };

// The board's own small classes (the one design: hairline rows, tinted steps, quiet ticks).
// Phone: name on top, the three steps under it, the later ticks under those.
const TRACKER_CSS = `
.trk-row{display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px;padding:5px 8px 5px 4px;border-radius:12px}
.trk-grip{flex:none;display:grid;place-items:center;width:20px;height:30px;background:none;border:0;padding:0;color:var(--w3)}
.trk-av{flex:none;width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:var(--bg2);color:var(--w3);font-family:var(--font-serif);font-size:13px}
.trk-who{flex:1 1 150px;min-width:0}
.trk-name{font-size:14px;line-height:1.35;font-weight:500;color:var(--w);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.trk-sub{display:flex;align-items:center;gap:6px;margin-top:1px;font-size:12px;line-height:1.35;color:var(--w3);white-space:nowrap;min-width:0}
.trk-sub>.t{overflow:hidden;text-overflow:ellipsis;min-width:0}
.trk-steps{display:flex;gap:5px;flex:none}
.trk-later{display:flex;gap:4px;flex:none}
.trk-act{display:flex;flex:none}
.trk-more{display:none!important}
.trk-step{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:30px;padding:0 12px;border-radius:999px;font-size:12.5px;font-weight:500;color:var(--w);cursor:pointer;font-family:inherit;white-space:nowrap;min-width:0}
.trk-tick{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:999px;border:1px solid var(--border);background:var(--card);font-size:12px;color:var(--w2);cursor:pointer;font-family:inherit;white-space:nowrap}
.trk-tick>i{width:11px;height:11px;border-radius:50%;flex:none}
.trk-stats{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 22px;margin-top:12px}
.trk-stat{display:inline-flex;align-items:baseline;gap:6px;white-space:nowrap;min-width:0}
.trk-stat b{font-family:var(--font-serif);font-weight:400;font-size:22px;line-height:1;color:var(--w);font-variant-numeric:tabular-nums}
.trk-stat b i{font-style:normal;font-size:14px;color:var(--w3)}
.trk-stat span{font-size:12.5px;color:var(--w3)}
.trk-extra{display:inline-flex;flex-wrap:wrap;align-items:center;gap:2px 14px;font-size:12.5px;color:var(--w3)}
.trk-card{padding:11px 18px}
.trk-show-ph{display:none}
@media (max-width:640px){
.trk-card{padding:12px 14px}
.trk-show-ph{display:inline}
.trk-extra{grid-column:1/-1}
.trk-meta{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.trk-hide-ph{display:none!important}
.trk-ib{width:36px;padding:0!important}
.trk-row{padding:8px 8px 9px 4px}
.trk-steps{order:5;flex:1 1 100%}
.trk-steps>button{flex:1;height:28px;padding:0 4px;gap:4px;font-size:11.5px}
.trk-m .trk-later,.trk-m .trk-act{display:none}
.trk-more{display:inline-flex!important}
.trk-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:10px}
.trk-stat{flex-direction:column;align-items:flex-start;gap:3px}
.trk-stat span{font-size:11.5px;max-width:100%;overflow:hidden;text-overflow:ellipsis}
}`;

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

  // HOOKS MUST ALL RUN BEFORE THE `loading` EARLY RETURN BELOW.
  // These three (useSensors + useSensor x2 + useCallback) used to sit AFTER it,
  // so the first render — while loading — ran fewer hooks than the second, and
  // React threw #310 ("rendered more hooks than during the previous render") the
  // instant the data arrived. The whole Batch Tracker page died on load.
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

  if (loading) return <PageLoader />;

  const fmtDay = (d: string) => new Date(d + "T00:00:00").toLocaleDateString(lang === "de" ? "de-DE" : lang === "fr" ? "fr-FR" : "en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const fmtWindow = (b: Batch) => [b.targetStart, b.targetEnd].filter((d): d is string => !!d).map(fmtDay).join(" → ");

  // One obvious step (Interview 1 · Agreement · Interview 2): the colour is the state (LAW #4).
  const Step = ({ label, tone, onClick, title }: { label: string; tone: Tone; onClick: () => void; title?: string }) => (
    <button type="button" onClick={onClick} title={title} className="trk-step"
      style={{ background: STATUS_TINT[TONE[tone]], border: `1px solid ${tone === "todo" ? "var(--border)" : "transparent"}` }}>
      <Dot st={TONE[tone]} size={7} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
    </button>
  );

  // Quiet tick for the later stages (contract · visa · arrived) — like the approved prep ticks.
  const Pill = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button type="button" onClick={onClick} aria-pressed={active} className="trk-tick"
      style={active ? { background: STATUS_TINT.approved, borderColor: "transparent", color: "var(--w)" } : undefined}>
      <i style={{ border: `1.5px solid ${active ? STATUS_DOT.approved : "var(--w3)"}`, background: active ? STATUS_DOT.approved : "transparent" }} />
      {children}
    </button>
  );

  const laterTicks = (c: Cand) => (
    <>
      <Pill active={c.contractDone} onClick={() => apply(c.userId, { contractDone: !c.contractDone }, { contract_done: !c.contractDone })}>{T("Contract", "Vertrag", "Contrat")}</Pill>
      <Pill active={c.visaGranted} onClick={() => apply(c.userId, { visaGranted: !c.visaGranted }, { visa_granted: !c.visaGranted })}>{T("Visa", "Visum", "Visa")}</Pill>
      <Pill active={c.arrivedDone} onClick={() => apply(c.userId, { arrivedDone: !c.arrivedDone }, { arrived_done: !c.arrivedDone })}>{T("Arrived", "Angekommen", "Arrivé")}</Pill>
    </>
  );

  // Phone: the row keeps the three steps; the later ticks + the two row actions open in one popup (···).
  const memberMore = (c: Cand, close: () => void) => (
    <div className="px-5 py-4" style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{laterTicks(c)}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <Btn size="sm" onClick={() => { close(); openPropose(c); }}>
          <CalendarClock size={14} />{T("Propose interview times", "Interview-Termine vorschlagen", "Proposer des créneaux d'entretien")}
        </Btn>
        <Btn kind="quiet" size="sm" onClick={() => { close(); removeFromBatch(c); }}>
          <X size={14} />{T("Remove from batch", "Aus Batch entfernen", "Retirer du lot")}
        </Btn>
      </div>
    </div>
  );

  const memberRow = (c: Cand, onMore: (id: string) => void) => {
    const i1tone: Tone = c.interview1Status === "passed" ? "done" : c.interview1Status === "failed" ? "fail" : "todo";
    const i2tone: Tone = c.interview2Status === "passed" ? "done" : c.interview2Status === "failed" ? "fail" : "todo";
    // Agreement is REQUIRED after Interview 1 → orange "need" once I1 passed but not yet signed.
    const agTone: Tone = c.agreementSigned ? "done" : c.interview1Status === "passed" ? "need" : "todo";
    const stage = normalizeB2Stage(c.b2Stage);
    const passed = stage === "passed";
    // B2 in the one palette: passed green, on its way orange, still studying grey; failed once = red ring.
    const b2st: Status = passed ? "approved" : stage === "studying" ? "missing" : "pending";
    const late = isB2Late(c);
    const b2Line = `B2: ${c.b2Stage ? b2StageLabel(stage, lang) : T("not set", "offen", "non défini")}${c.b2ExamDate ? ` · ${fmtDay(c.b2ExamDate)}` : ""}`;
    return (
      <SortableRow key={c.userId} id={c.userId}>
        {({ listeners, isDragging }) => (
          <div className="group trk-row trk-m" style={{
            background: "var(--card)",
            border: `1px solid ${isDragging ? "var(--w)" : "var(--border)"}`,
            boxShadow: isDragging ? "0 14px 30px -16px rgba(21,19,15,.35)" : "none",
          }}>
            {/* Handle: dragging is handle-only so taps on steps stay taps. bv-touch = 44px hit area on phones. */}
            <button type="button" {...listeners} aria-label={T("Reorder", "Verschieben", "Réordonner")}
              className="bv-touch trk-grip opacity-40 group-hover:opacity-100 transition-opacity"
              style={{ cursor: isDragging ? "grabbing" : "grab", touchAction: "none" }}>
              <GripVertical size={15} />
            </button>
            {/* Minimal profile avatar — initials, no photo to load */}
            <span aria-hidden className="trk-av">{initialsOf(c.name)}</span>
            <div className="trk-who">
              <div className="trk-name" title={c.name}>{c.name}</div>
              <div className="trk-sub" title={b2Line}>
                <span aria-hidden style={{ width: 7, height: 7, borderRadius: 99, flex: "none", background: STATUS_DOT[b2st], boxShadow: c.b2Failed && !passed ? "0 0 0 2px rgba(220,38,38,.55)" : "none" }} />
                <span className="t">{b2Line}</span>
                {late && <b style={{ flex: "none", fontWeight: 600, color: STATUS_DOT.rejected }}>{T("too late", "zu spät", "trop tard")}</b>}
              </div>
            </div>
            {/* the three steps that matter: Interview 1 → Agreement → Interview 2 */}
            <div className="trk-steps">
              <Step label={`${T("Interview", "Interview", "Entretien")} 1`} tone={i1tone} onClick={() => cycleInterview(c, 1)} />
              <Step label={T("Agreement", "Vereinbarung", "Accord")} tone={agTone} onClick={() => toggleAgreement(c)}
                title={T("Signed right after Interview 1", "Wird direkt nach Interview 1 unterschrieben", "Se signe juste après l'entretien 1")} />
              <Step label={`${T("Interview", "Interview", "Entretien")} 2`} tone={i2tone} onClick={() => cycleInterview(c, 2)} />
            </div>
            {/* later stages: quiet ticks, out of the way until they matter */}
            <div className="trk-later">{laterTicks(c)}</div>
            <Btn kind="quiet" size="sm" icon className="trk-more" onClick={() => onMore(c.userId)}
              title={T("More", "Mehr", "Plus")} aria-label={T("More", "Mehr", "Plus")}>
              <MoreHorizontal size={17} />
            </Btn>
            <div className="trk-act">
              <Btn kind="quiet" size="sm" icon onClick={() => openPropose(c)}
                title={T("Propose interview times", "Interview-Termine vorschlagen", "Proposer des créneaux d'entretien")}
                aria-label={T("Propose interview times", "Interview-Termine vorschlagen", "Proposer des créneaux d'entretien")}>
                <CalendarClock size={15} />
              </Btn>
              <Btn kind="quiet" size="sm" icon onClick={() => removeFromBatch(c)}
                title={T("Remove from batch", "Aus Batch entfernen", "Retirer du lot")}
                aria-label={T("Remove from batch", "Aus Batch entfernen", "Retirer du lot")}>
                <X size={15} />
              </Btn>
            </div>
          </div>
        )}
      </SortableRow>
    );
  };

  // THE POOL row: the pre-batch journey contact → call → CV → medical; ready ones tinted green.
  const poolRow = (c: Cand) => {
    const ready = poolReady(c);
    return (
      <div key={c.userId} className="group trk-row trk-pool" style={{ background: ready ? STATUS_TINT.approved : "var(--card)", border: `1px solid ${ready ? "transparent" : "var(--border)"}` }}>
        <span aria-hidden className="trk-av" style={ready ? { background: "var(--card)", color: STATUS_DOT.approved } : undefined}>{initialsOf(c.name)}</span>
        <div className="trk-who" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="trk-name" style={{ minWidth: 0 }} title={c.name}>{c.name}</span>
          {ready && (
            <span style={{ flex: "none", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, color: STATUS_DOT.approved }}>
              <Check size={12} strokeWidth={2.6} />{T("ready", "bereit", "prêt")}
            </span>
          )}
        </div>
        <div className="trk-steps">
          <Step label={T("Contact", "Kontakt", "Contact")} tone={c.poolContacted ? "done" : "todo"}
            onClick={() => apply(c.userId, { poolContacted: !c.poolContacted }, { pool_contacted: !c.poolContacted })} />
          <Step label={T("Call", "Anruf", "Appel")} tone={c.poolCallDone ? "done" : "todo"}
            onClick={() => apply(c.userId, { poolCallDone: !c.poolCallDone }, { pool_call_done: !c.poolCallDone })} />
          <Step label={T("CV", "Lebenslauf", "CV")} tone={c.poolCvDone ? "done" : "todo"}
            onClick={() => apply(c.userId, { poolCvDone: !c.poolCvDone }, { pool_cv_done: !c.poolCvDone })} />
          <Step label={T("Medical", "Medical", "Médical")} tone={c.poolMedicalDone ? "done" : "todo"}
            onClick={() => apply(c.userId, { poolMedicalDone: !c.poolMedicalDone }, { pool_medical_done: !c.poolMedicalDone })} />
        </div>
        {selectedBatch && (
          <div className="trk-act">
            <Btn size="sm" style={{ height: 30 }} onClick={() => addToBatch(c)} title={T("Add to this batch", "Zu diesem Batch hinzufügen", "Ajouter à ce lot")}>
              <Plus size={13} strokeWidth={2.4} />{T("Place", "Platzieren", "Placer")}
            </Btn>
          </div>
        )}
      </div>
    );
  };

  const field = (label: string, input: React.ReactNode) => <Field label={label}>{input}</Field>;
  const batchMeta = batch
    ? [`${members.length}/${batch.seats} ${T("seats", "Plätze", "places")}`, fmtWindow(batch), [batch.agency, batch.employer].filter(Boolean).join(" → ")].filter(Boolean).join(" · ")
    : "";

  return (
    <main id="bv-main" className="mx-auto px-5 bv-page-bottom trk-main" style={{ maxWidth: 1080, paddingTop: 88, paddingBottom: 12 }}>
      <style>{TRACKER_CSS}</style>
      <PageHead
        back={{ label: T("Back", "Zurück", "Retour"), onClick: () => router.push("/portal/admin") }}
        title={T("Batch Tracker", "Batch-Tracker", "Suivi du lot")}
        sub={<>
          <span className="trk-hide-ph">{T("Tap a step: green done, red failed. Drag the handle to reorder.",
            "Schritt antippen: grün erledigt, rot nicht bestanden. Am Griff ziehen sortiert.",
            "Touchez une étape : vert fait, rouge échoué. Glissez la poignée pour trier.")}</span>
          <span className="trk-show-ph">{T("Tap a step: green done, red failed.", "Antippen: grün erledigt, rot nicht bestanden.", "Touchez : vert fait, rouge échoué.")}</span>
        </>}
        actions={batches.length > 1 || isSupreme ? (
          <>
            {batches.length > 1 && (
              <select value={selectedBatch} onChange={(e) => setSelectedBatch(e.target.value)} aria-label={T("Batch", "Batch", "Lot")}
                className="bvk-input" style={{ height: 34, width: "auto", maxWidth: 250, borderRadius: 999, padding: "0 12px", fontSize: 13, background: "var(--card)" }}>
                {batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            )}
            {isSupreme && (
              <Btn size="sm" className="trk-ib" onClick={() => setShowNew(true)}
                title={T("New batch", "Neuer Batch", "Nouveau lot")} aria-label={T("New batch", "Neuer Batch", "Nouveau lot")}>
                <Plus size={14} strokeWidth={2} /><span className="trk-hide-ph">{T("New batch", "Neuer Batch", "Nouveau lot")}</span>
              </Btn>
            )}
            {isSupreme && (
              <Btn size="sm" className="trk-ib" onClick={syncBatch} disabled={syncing || !batch}
                aria-label={T("Sync this batch → Drive", "Batch → Drive", "Lot → Drive")}
                title={T("Copy this batch's candidates' approved docs into your Google Drive (Agency X Borivon / batch / candidate). Manual — only when you click.",
                         "Kopiert die genehmigten Dokumente der Kandidaten dieses Batches in dein Google Drive. Manuell — nur auf Klick.",
                         "Copie les documents approuvés des candidats de ce lot dans ton Google Drive. Manuel — seulement au clic.")}>
                <FolderUp size={14} strokeWidth={2} />
                <span className="trk-hide-ph">{syncing ? T("Syncing…", "Synchronisiere…", "Sync…") : T("Sync this batch → Drive", "Batch → Drive", "Lot → Drive")}</span>
              </Btn>
            )}
          </>
        ) : undefined}
      />

      {syncMsg && (
        <p style={{ margin: "-6px 0 14px", fontSize: 12.5, lineHeight: 1.5, color: "var(--w2)" }}>
          {syncMsg}
          {syncUrl && (
            <>
              {" "}
              <a href={syncUrl} target="_blank" rel="noreferrer" style={{ color: "var(--w)", fontWeight: 600, textDecoration: "underline", textUnderlineOffset: 3 }}>
                {T("Open the folder →", "Ordner öffnen →", "Ouvrir le dossier →")}
              </a>
            </>
          )}
        </p>
      )}

      {!batch ? (
        <Card>
          <Empty>{T("No open batch yet — create one on the Batches page first.", "Noch kein offener Batch — erstelle zuerst einen auf der Batches-Seite.", "Aucun lot ouvert — créez-en un d'abord sur la page Lots.")}</Empty>
        </Card>
      ) : (
        <>
          {/* The batch: name, window, seats — and the progress at a glance, leading with the beginning */}
          <Card className="trk-card" style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
              <div style={{ minWidth: 0, flex: 1, fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 22, lineHeight: 1.2, color: "var(--w)", overflowWrap: "anywhere", paddingTop: 2 }}>{batch.name}</div>
              <div style={{ display: "flex", gap: 6, flex: "none" }}>
                {/* Batch note — every admin (supreme + sub-admins) can write it. */}
                <Btn size="sm" className="trk-ib" onClick={openNotes} title={T("Batch note", "Batch-Notiz", "Note du lot")} aria-label={T("Batch note", "Batch-Notiz", "Note du lot")}>
                  <NotebookPen size={14} strokeWidth={2} style={batch.notes ? { color: "var(--gold)" } : undefined} />
                  <span className="trk-hide-ph">{T("Note", "Notiz", "Note")}</span>
                </Btn>
                {isSupreme && (
                  <Btn size="sm" className="trk-ib" onClick={openEdit} title={T("Edit", "Bearbeiten", "Modifier")} aria-label={T("Edit", "Bearbeiten", "Modifier")}>
                    <Pencil size={14} strokeWidth={2} /><span className="trk-hide-ph">{T("Edit", "Bearbeiten", "Modifier")}</span>
                  </Btn>
                )}
              </div>
            </div>
            <div className="trk-meta" title={batchMeta} style={{ marginTop: 2, fontSize: 12.5, color: "var(--w3)" }}>{batchMeta}</div>
            {/* the count per step, as quiet serif numbers (green when the whole batch is through) */}
            <div className="trk-stats">
              {([
                [T("B2 passed", "B2 bestanden", "B2 réussi"), summary.b2],
                [T("Interview 1", "Interview 1", "Entretien 1"), summary.i1],
                [T("Agreement", "Vereinbarung", "Accord"), summary.agreement],
                [T("Interview 2", "Interview 2", "Entretien 2"), summary.i2],
              ] as const).map(([label, n]) => (
                <div key={label} className="trk-stat">
                  <b style={members.length > 0 && n === members.length ? { color: STATUS_DOT.approved } : undefined}>{n}<i>/{members.length}</i></b>
                  <span>{label}</span>
                </div>
              ))}
              <div className="trk-extra">
                {summary.b2late > 0 && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--w)", fontWeight: 600 }}>
                    <Dot st="rejected" size={7} />{T("B2 too late", "B2 zu spät", "B2 trop tard")}: {summary.b2late}
                  </span>
                )}
                <span>{T("Contract", "Vertrag", "Contrat")} {summary.contract} · {T("Visa", "Visum", "Visa")} {summary.visa} · {T("Arrived", "Angekommen", "Arrivés")} {summary.arrived}</span>
              </div>
            </div>
            {/* The batch note, visible at a glance (the whole note opens with "Notiz") */}
            {batch.notes && (
              <p className="trk-hide-ph" title={batch.notes} style={{ margin: "10px 0 0", paddingTop: 9, borderTop: "1px solid var(--border)", fontSize: 12.5, lineHeight: 1.45, color: "var(--w2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {batch.notes}
              </p>
            )}
          </Card>

          {err && <p role="alert" style={{ margin: "0 0 10px", fontSize: 12.5, color: STATUS_DOT.rejected }}>{err}</p>}

          {/* The list's toolbar: the batch and THE POOL (everyone with no batch yet — the bench you draw
              from the day a hospital calls with slots) one tap apart, and the one black button: add. */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
            {members.length > 0 ? (
              <Seg value={poolOpen ? "pool" : "batch"} onChange={(v) => setPoolOpen(v === "pool")}
                options={[
                  ["batch", <>{T("In this batch", "Im Batch", "Dans le lot")} {members.length}</>],
                  ["pool", <>Pool {pool.length}{poolReadyCount > 0 && <span style={{ color: STATUS_DOT.approved }}> · {poolReadyCount} {T("ready", "bereit", "prêts")}</span>}</>],
                ]} />
            ) : <span />}
            <Btn kind="primary" size="sm" className="trk-ib" onClick={() => setAddOpen((v) => !v)}
              aria-label={T("Add candidate", "Kandidat hinzufügen", "Ajouter un candidat")} title={T("Add candidate", "Kandidat hinzufügen", "Ajouter un candidat")}>
              <Plus size={15} strokeWidth={2} /><span className="trk-hide-ph">{T("Add candidate", "Kandidat hinzufügen", "Ajouter un candidat")}</span>
            </Btn>
          </div>

          {members.length === 0 ? (
            <Card>
              <Empty>{T("No candidates in this batch yet — add some above.", "Noch keine Kandidaten in diesem Batch — oben hinzufügen.", "Aucun candidat dans ce lot — ajoutez-en ci-dessus.")}</Empty>
            </Card>
          ) : !poolOpen ? (
            <MemberBoard members={members} sensors={sensors} onDragEnd={onDragEnd} row={memberRow} more={memberMore} />
          ) : (
            <>
              <p className="trk-hide-ph" style={{ margin: "0 0 10px", fontSize: 12.5, color: "var(--w3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                title={T("No place yet: onboarding call, CV, medical — when a hospital calls, offer the ready ones.",
                         "Noch ohne Platz: Onboarding-Call, Lebenslauf, Medical — ruft ein Krankenhaus an, die Bereiten anbieten.",
                         "Sans place : appel d'intégration, CV, médical — quand un hôpital appelle, proposez celles qui sont prêtes.")}>
                {T("No place yet — call, CV, medical; offer the ready ones first.",
                   "Noch ohne Platz — Anruf, Lebenslauf, Medical; die Bereiten zuerst anbieten.",
                   "Sans place — appel, CV, médical ; proposez d'abord les prêtes.")}
              </p>
              <div style={{ position: "relative", marginBottom: 10 }}>
                <Search size={14} aria-hidden style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: "var(--w3)", pointerEvents: "none" }} />
                <input value={poolQuery} onChange={(e) => setPoolQuery(e.target.value)}
                  placeholder={T("Search the pool…", "Pool durchsuchen…", "Rechercher…")}
                  className="bvk-input" style={{ height: 38, paddingLeft: 34 }} />
              </div>
              {pool.length === 0 ? (
                <Card><Empty>{T("Nobody waiting.", "Niemand wartet.", "Personne en attente.")}</Empty></Card>
              ) : (
                <PagedRows items={pool} perLaptop={5} perPhone={2} row={poolRow} />
              )}
            </>
          )}

          {/* Add a candidate to this batch — a popup (LAW #36) instead of a panel that pushes the board down */}
          <Modal open={addOpen} onClose={() => setAddOpen(false)} size="sm"
            title={T("Add candidate", "Kandidat hinzufügen", "Ajouter un candidat")} subtitle={batch.name}>
            <AddPicker T={T} query={addQuery} setQuery={setAddQuery} items={addable} onAdd={(c) => { addToBatch(c); }} />
          </Modal>
        </>
      )}

      {/* Batch note — supreme admin + sub-admins. Candidates never see this page. */}
      <Modal open={showNotes} onClose={() => !saving && setShowNotes(false)} size="sm" busy={saving}
        title={T("Batch note", "Batch-Notiz", "Note du lot")}
        subtitle={batch ? batch.name : ""}
        footer={<><Btn kind="quiet" size="sm" onClick={() => setShowNotes(false)} disabled={saving}>{T("Cancel", "Abbrechen", "Annuler")}</Btn>
          <Btn kind="primary" size="sm" onClick={saveNotes} disabled={saving}>{T("Save", "Speichern", "Enregistrer")}</Btn></>}>
        <div className="px-5 py-4">
          <textarea value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)} rows={7} autoFocus
            placeholder={T("Anything about this batch — what's agreed, what's pending, who to chase…", "Alles zu diesem Batch — was vereinbart ist, was offen ist, wer nachzufassen ist…", "Tout sur ce lot — ce qui est convenu, en attente, qui relancer…")}
            className="bvk-input" style={{ minHeight: 150 }} />
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--w3)" }}>
            {T("Visible to you and your sub-admins only.", "Nur für dich und deine Sub-Admins sichtbar.", "Visible seulement par vous et vos sous-admins.")}
          </p>
        </div>
      </Modal>

      {/* Supreme-only: EDIT this batch — fix the start date, name, seats, agency, employer. */}
      <Modal open={showEdit} onClose={() => !saving && setShowEdit(false)} size="sm" busy={saving}
        title={T("Edit batch", "Batch bearbeiten", "Modifier le lot")}
        subtitle={T("Fix the dates, name, seats, agency or employer.", "Termine, Name, Plätze, Agentur oder Arbeitgeber korrigieren.", "Corrigez les dates, le nom, les places, l'agence ou l'employeur.")}
        footer={<><Btn kind="quiet" size="sm" onClick={() => setShowEdit(false)} disabled={saving}>{T("Cancel", "Abbrechen", "Annuler")}</Btn>
          <Btn kind="primary" size="sm" onClick={saveEdit} disabled={saving || !editForm.name.trim()}>{T("Save", "Speichern", "Enregistrer")}</Btn></>}>
        <div className="px-5 py-4" style={{ display: "grid", gap: 12 }}>
          {field(T("Name", "Name", "Nom"),
            <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="bvk-input" />)}
          <div style={{ display: "grid", gridTemplateColumns: "96px minmax(0,1fr)", gap: 12 }}>
            {field(T("Seats", "Plätze", "Places"),
              <input type="number" min={1} max={1000} value={editForm.seats} onChange={(e) => setEditForm({ ...editForm, seats: Math.max(1, Number(e.target.value) || 1) })} className="bvk-input" />)}
            {field(T("Agency (optional)", "Agentur (optional)", "Agence (optionnel)"),
              <select value={editForm.orgId} onChange={(e) => setEditForm({ ...editForm, orgId: e.target.value })} className="bvk-input">
                <option value="">{T("— none —", "— keine —", "— aucune —")}</option>
                {organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>)}
          </div>
          {field(T("Employer (optional)", "Arbeitgeber (optional)", "Employeur (optionnel)"),
            <select value={editForm.employerId} onChange={(e) => setEditForm({ ...editForm, employerId: e.target.value })} className="bvk-input">
              <option value="">{T("— none —", "— keiner —", "— aucun —")}</option>
              {employers.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>)}
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 12 }}>
            {field(T("Window start", "Fenster-Start", "Début fenêtre"),
              <input type="date" value={editForm.targetStart} onChange={(e) => setEditForm({ ...editForm, targetStart: e.target.value })} className="bvk-input" />)}
            {field(T("Window end", "Fenster-Ende", "Fin fenêtre"),
              <input type="date" value={editForm.targetEnd} onChange={(e) => setEditForm({ ...editForm, targetEnd: e.target.value })} className="bvk-input" />)}
          </div>
        </div>
      </Modal>

      {/* Supreme-only: create a new batch — name + date window + agency + employer. */}
      <Modal open={showNew} onClose={() => !saving && setShowNew(false)} size="sm" busy={saving}
        title={T("New batch", "Neuer Batch", "Nouveau lot")}
        subtitle={T("An employer intake, e.g. \"UKSH Kiel — April 2027\".", "Ein Arbeitgeber-Intake, z.B. \"UKSH Kiel — April 2027\".", "Un recrutement employeur, p.ex. \"UKSH Kiel — April 2027\".")}
        footer={<><Btn kind="quiet" size="sm" onClick={() => setShowNew(false)} disabled={saving}>{T("Cancel", "Abbrechen", "Annuler")}</Btn>
          <Btn kind="primary" size="sm" onClick={createBatch} disabled={saving || !form.name.trim()}>{T("Create", "Erstellen", "Créer")}</Btn></>}>
        <div className="px-5 py-4" style={{ display: "grid", gap: 12 }}>
          {field(T("Name", "Name", "Nom"),
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="UKSH Kiel — April 2027" className="bvk-input" />)}
          <div style={{ display: "grid", gridTemplateColumns: "96px minmax(0,1fr)", gap: 12 }}>
            {field(T("Seats", "Plätze", "Places"),
              <input type="number" min={1} max={1000} value={form.seats} onChange={(e) => setForm({ ...form, seats: Math.max(1, Number(e.target.value) || 1) })} className="bvk-input" />)}
            {field(T("Agency (optional)", "Agentur (optional)", "Agence (optionnel)"),
              <select value={form.orgId} onChange={(e) => setForm({ ...form, orgId: e.target.value })} className="bvk-input">
                <option value="">{T("— none —", "— keine —", "— aucune —")}</option>
                {organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>)}
          </div>
          {field(T("Employer (optional)", "Arbeitgeber (optional)", "Employeur (optionnel)"),
            <select value={form.employerId} onChange={(e) => setForm({ ...form, employerId: e.target.value })} className="bvk-input">
              <option value="">{T("— none —", "— keiner —", "— aucun —")}</option>
              {employers.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>)}
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 12 }}>
            {field(T("Window start", "Fenster-Start", "Début fenêtre"),
              <input type="date" value={form.targetStart} onChange={(e) => setForm({ ...form, targetStart: e.target.value })} className="bvk-input" />)}
            {field(T("Window end", "Fenster-Ende", "Fin fenêtre"),
              <input type="date" value={form.targetEnd} onChange={(e) => setForm({ ...form, targetEnd: e.target.value })} className="bvk-input" />)}
          </div>
        </div>
      </Modal>

      {/* Interview self-scheduler — propose up to 3 times to the candidate. */}
      <Modal open={!!proposeFor} onClose={() => !proposing && setProposeFor(null)} size="sm" busy={proposing}
        title={T("Propose interview times", "Interview-Termine vorschlagen", "Proposer des créneaux")}
        subtitle={proposeFor ? proposeFor.name : ""}
        footer={<><Btn kind="quiet" size="sm" onClick={() => setProposeFor(null)} disabled={proposing}>{T("Cancel", "Abbrechen", "Annuler")}</Btn>
          <Btn kind="primary" size="sm" onClick={submitPropose} disabled={proposing}>{T("Send to candidate", "An Kandidat senden", "Envoyer au candidat")}</Btn></>}>
        <div className="px-5 py-4" style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12.5, color: "var(--w3)" }}>{T("Which interview", "Welches Interview", "Quel entretien")}</span>
            <Seg value={proposeRound === 2 ? "2" : "1"} onChange={(v) => setProposeRound(v === "2" ? 2 : 1)}
              options={[["1", T("Interview 1", "Interview 1", "Entretien 1")], ["2", T("Interview 2", "Interview 2", "Entretien 2")]]} />
          </div>
          <div className="bvk-field">
            <span>{T("Offer up to 3 times", "Bis zu 3 Termine anbieten", "Proposez jusqu'à 3 créneaux")}</span>
            {proposeSlots.map((s, i) => (
              <input key={i} type="datetime-local" value={s} onChange={(e) => setProposeSlots((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))}
                className="bvk-input" aria-label={`${T("Time", "Termin", "Créneau")} ${i + 1}`} />
            ))}
          </div>
          {field(T("Note (optional)", "Notiz (optional)", "Note (optionnel)"),
            <input value={proposeNote} onChange={(e) => setProposeNote(e.target.value)} placeholder={T("e.g. video call, ~30 min", "z.B. Videoanruf, ~30 Min.", "p.ex. appel vidéo, ~30 min")} className="bvk-input" />)}
          {proposeMsg && <p style={{ margin: 0, fontSize: 12.5, color: "var(--w2)" }}>{proposeMsg}</p>}
        </div>
      </Modal>
    </main>
  );
}

/** The batch board, one page at a time (nobody scrolls). Dragging reorders within the page shown;
 *  the order is still saved for the whole batch in one request (onDragEnd works on every member). */
function MemberBoard({ members, sensors, onDragEnd, row, more }: {
  members: Cand[];
  sensors: ReturnType<typeof useSensors>;
  onDragEnd: (e: DragEndEvent) => void;
  row: (c: Cand, onMore: (id: string) => void) => React.ReactNode;
  /** phone: the later ticks + row actions of one candidate, in a popup (LAW #36) */
  more: (c: Cand, close: () => void) => React.ReactNode;
}) {
  const { slice, page, pages, setPage } = usePaged(members, 6, 2);
  const [moreId, setMoreId] = useState<string | null>(null);
  const moreOf = moreId ? members.find((m) => m.userId === moreId) ?? null : null;
  return (
    <>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={slice.map((m) => m.userId)} strategy={verticalListSortingStrategy}>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>{slice.map((c) => row(c, setMoreId))}</div>
        </SortableContext>
      </DndContext>
      <Pager page={page} pages={pages} onPage={setPage} />
      <Modal open={!!moreOf} onClose={() => setMoreId(null)} size="sm" title={moreOf?.name}>
        {moreOf && more(moreOf, () => setMoreId(null))}
      </Modal>
    </>
  );
}

/** Any list of rows, flipping instead of scrolling. */
function PagedRows<X>({ items, perLaptop, perPhone, row }: { items: X[]; perLaptop: number; perPhone: number; row: (x: X) => React.ReactNode }) {
  const { slice, page, pages, setPage } = usePaged(items, perLaptop, perPhone);
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>{slice.map(row)}</div>
      <Pager page={page} pages={pages} onPage={setPage} />
    </>
  );
}

/** Add-candidate picker (inside the popup): search + the people not in this batch yet, paged. */
function AddPicker({ T, query, setQuery, items, onAdd }: {
  T: (en: string, de: string, fr: string) => string;
  query: string;
  setQuery: (v: string) => void;
  items: Cand[];
  onAdd: (c: Cand) => void;
}) {
  const { slice, page, pages, setPage } = usePaged(items, 7, 6);
  return (
    <div className="px-5 py-4">
      <div style={{ position: "relative", marginBottom: 6 }}>
        <Search size={14} aria-hidden style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: "var(--w3)", pointerEvents: "none" }} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} autoFocus
          placeholder={T("Search a candidate to add…", "Kandidat suchen…", "Rechercher un candidat…")}
          className="bvk-input" style={{ paddingLeft: 34 }} />
      </div>
      {items.length === 0 ? (
        <Empty>{T("No candidates to add.", "Keine Kandidaten zum Hinzufügen.", "Aucun candidat à ajouter.")}</Empty>
      ) : (
        <>
          {slice.map((c) => (
            <div key={c.userId} className="bvk-row" style={{ padding: "8px 2px" }}>
              <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {c.name}
                {c.batchId ? <span style={{ marginLeft: 8, fontSize: 12, color: "var(--w3)" }}>({T("in another batch", "in anderem Batch", "dans un autre lot")})</span> : null}
              </span>
              <Btn size="sm" onClick={() => onAdd(c)}>{T("Add", "Hinzufügen", "Ajouter")}</Btn>
            </div>
          ))}
          <Pager page={page} pages={pages} onPage={setPage} />
        </>
      )}
    </div>
  );
}
