"use client";

/**
 * Anerkennung / Visa Autopilot — admin Pipeline board ("who's stuck where").
 *
 * Every candidate the admin can see, one row each, ordered most-urgent-first and
 * color-coded by health (blocked → overdue → due soon → on track → done). Click
 * a row → jump to that candidate in the admin panel (where the journey lives).
 * Read-only overview; edits happen in the candidate's journey checklist.
 */

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import { PageLoader } from "@/components/ui/states";
import { JOURNEY_PRESETS, SEQUENTIAL_PRESETS } from "@/lib/candidateJourney";
import { JourneyMap } from "@/components/JourneyMap";
import { CandidateTable } from "@/components/CandidateTable";
import { Modal, GoldButton, GhostButton } from "@/components/ui/Modal";
import { normalizeB2Stage, b2StageLabel, b2StageColor, B2_FAILED_COLOR, B2_STAGES } from "@/lib/b2Journey";
import { normalizeAnerkennungStage, anerkennungStageLabel, anerkennungStageColor, ANERKENNUNG_STAGES } from "@/lib/anerkennungJourney";
import { impfungStageLabel, IMPFUNG_STAGE_BY_KEY, type ImpfungStage } from "@/lib/impfungJourney";
import { NURSE_SPECIALTIES, specialtyLabel } from "@/lib/nurseSpecialties";
import { translateDocLabel } from "@/lib/fileKeys";
import type { PassportProfile } from "@/lib/passportReview";
import type { StuckVerdict } from "@/lib/pipelineStuck";
import { relativeTimeShort } from "@/lib/relativeTime";
import { Toaster, toast } from "sonner";
import { ArrowLeft, AlertTriangle, CheckCircle2, Search, Map as MapIcon, LayoutGrid, BadgeCheck, ArrowRight, Bell, FileText, Printer, Pencil, ChevronLeft, ChevronRight, ChevronDown, Check } from "lucide-react";

// Document review reused VERBATIM from the dashboard — opened as a popup ON TOP
// of the peek so the admin never has to leave the candidate to approve/reject.
// Dynamically imported so the heavy PDF/DOCX/image viewers stay out of the
// pipeline bundle until a doc is actually opened.
const AdminDocPreviewModal = dynamic(
  () => import("@/components/AdminDocPreviewModal").then((m) => m.AdminDocPreviewModal),
  { ssr: false },
);
type PeekDoc = { id: string; user_id: string; file_name: string; file_type: string; uploaded_at: string; status: string; feedback: string | null; drive_file_id: string | null; uploaded_by_admin?: boolean; rotation?: number | null };

// Passport-data review (extracted fields + LAW #38 human-only confirm boxes) —
// the dashboard's flow, opened over the peek. Dynamic so it's only fetched when
// a passport is actually reviewed.
const PassportReviewModal = dynamic(
  () => import("@/components/PassportReviewModal").then((m) => m.PassportReviewModal),
  { ssr: false },
);

type Health = "on_track" | "due_soon" | "overdue" | "blocked" | "done";
type Status = {
  progress: number; doneCount: number; totalPresets: number;
  current: { key: string; owner: string; position: number; dueDate: string | null; blocked: boolean; blockedReason: string | null; daysToDue: number | null } | null;
  reached: { key: string; position: number } | null;
  overdueCount: number; blockedCount: number; health: Health;
};
type Sellable = { sellable: boolean; cvDone: boolean; diplomaApproved: boolean };
type FollowUp = { needed: boolean; reasons: string[] };
type OpenTask = { key: string | null; text: string | null; owner: string | null; dueDate: string | null; blocked: boolean };
type Facts = { specialty: string | null; yearsExperience: number | null; workplace: string | null; availableFrom: string | null };
type DocPackItem = { key: string; status: "approved" | "pending" | "missing" };
type DocPack = { items: DocPackItem[]; collected: number; total: number };
type SelfReport = { kind: string; outcome: string; note: string | null; created_at: string };
type PipelineFacts = {
  interview1: string | null; interview2: string | null;
  interview1Date: string | null; interview2Date: string | null;
  visaApptDate: string | null; flightDate: string | null; flightInfo: string | null;
  housingDone: boolean; visaGranted: boolean;
  contractDone: boolean; recognitionDone: boolean; vorabDone: boolean; docsReady: boolean; arrivedDone: boolean;
};
type Row = { userId: string; name: string; photo: string | null; status: Status; sellable: Sellable; b2Stage?: string; b2Failed?: boolean; anerkennungStage?: string; impfungStage?: string; impfungDoses?: { got: number; need: number }; followUp?: FollowUp; openTasks?: OpenTask[]; facts?: Facts; docPack?: DocPack; reports?: SelfReport[]; pipeline?: PipelineFacts; needsUpdate?: boolean; lastActivityAt?: string | null; stuck?: StuckVerdict };

const HEALTH_STYLE: Record<Health, { dot: string; label: { en: string; de: string; fr: string } }> = {
  blocked:  { dot: "#ef4444", label: { en: "Blocked",   de: "Blockiert",   fr: "Bloqué" } },
  overdue:  { dot: "#f97316", label: { en: "Overdue",   de: "Überfällig",  fr: "En retard" } },
  due_soon: { dot: "#f59e0b", label: { en: "Due soon",  de: "Bald fällig", fr: "Bientôt dû" } },
  on_track: { dot: "#16a34a", label: { en: "On track",  de: "Im Plan",     fr: "Sur la bonne voie" } },
  done:     { dot: "#6b7280", label: { en: "Complete",  de: "Fertig",      fr: "Terminé" } },
};

function presetLabel(key: string | undefined, lang: string): string {
  if (!key) return "—";
  const p = JOURNEY_PRESETS.find((x) => x.key === key);
  if (!p) return key;
  return p.label[(lang as "en" | "fr" | "de")] ?? p.label.en;
}

export default function AdminPipelinePage() {
  const router = useRouter();
  const { lang } = useLang();
  const T = (en: string, de: string, fr: string) => (lang === "de" ? de : lang === "fr" ? fr : en);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [today, setToday] = useState("");
  const [q, setQ] = useState("");
  const [view, setView] = useState<"board" | "map">("board");
  const [track, setTrack] = useState<"journey" | "b2">("journey");
  const [sheetOpen, setSheetOpen] = useState(false); // employer profile sheet
  // Clicking a candidate opens a quick cross-track summary (peek) — NOT a jump
  // straight to their dossier. The dossier is one button away inside the popup.
  const [peek, setPeek] = useState<Row | null>(null);
  // Live JWT (kept fresh) + the peeked candidate's documents, so the admin can
  // review/approve/reject papers (e.g. the CV) right here without leaving.
  const [accessToken, setAccessToken] = useState("");
  const [peekDocs, setPeekDocs] = useState<PeekDoc[] | null>(null);
  const [peekProfile, setPeekProfile] = useState<PassportProfile | null>(null); // candidate profile (passport fields)
  const [docReview, setDocReview] = useState<PeekDoc | null>(null); // open doc-preview popup
  const [passportOpen, setPassportOpen] = useState(false); // open passport-data review popup
  // Quick one-off note to the candidate (masked as "Borivon"), sent from the peek.
  const [msgText, setMsgText] = useState("");
  const [sendingMsg, setSendingMsg] = useState(false);
  const [msgSent, setMsgSent] = useState(false);
  const [nudging, setNudging] = useState(false);
  const [nudged, setNudged] = useState<string | null>(null); // userId whose reminder just sent
  // Editable nurse-profile facts (specialty/experience) for the peeked candidate.
  const [factsDraft, setFactsDraft] = useState({ specialty: "", years: "", workplace: "", availableFrom: "" });
  const [factsSaving, setFactsSaving] = useState(false);
  const [factsEdit, setFactsEdit] = useState(false); // nurse-profile editor open?
  // Guided peek — one question at a time. `stepIndex` null = follow the live
  // current milestone; a number = the admin paged to a specific step to revisit.
  // `pipeDraft` holds editable values for whichever step is on screen.
  const [savingStep, setSavingStep] = useState(false);
  const [stepIndex, setStepIndex] = useState<number | null>(null);
  const [moreOpen, setMoreOpen] = useState(false); // collapsed "More" (status · profile · updates)
  const [pipeDraft, setPipeDraft] = useState({ interview1: "", interview2: "", interview1Date: "", interview2Date: "", visaApptDate: "", flightDate: "", flightInfo: "", housingDone: false });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { router.replace("/portal"); return; }
      let token = session.access_token ?? "";
      const expMs = (session.expires_at ?? 0) * 1000;
      if (!expMs || expMs - Date.now() < 60_000) {
        try { const { data: r } = await supabase.auth.refreshSession(); if (r?.session?.access_token) token = r.session.access_token; } catch { /* keep */ }
        if (cancelled) return;
      }
      setAccessToken(token);
      const res = await fetch("/api/portal/journey/pipeline", { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 401 || res.status === 403) { router.replace("/portal/dashboard"); return; }
      const j = await res.json().catch(() => ({ candidates: [] }));
      if (cancelled) return;
      setRows((j.candidates ?? []) as Row[]);
      setToday(j.today ?? "");
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [router]);

  // Keep the JWT fresh (it rotates ~hourly) so the doc-review popup's
  // authenticated fetches / approve-reject calls never 401 mid-session.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session?.access_token) setAccessToken(session.access_token);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // When a candidate is peeked, load THEIR documents (admin-scoped, LAW #25) so
  // the guided steps can surface the real paper to review (CV, etc.) inline.
  useEffect(() => {
    const uid = peek?.userId;
    if (!uid) { setPeekDocs(null); setPeekProfile(null); return; }
    let cancelled = false;
    setPeekDocs(null); setPeekProfile(null); setPassportOpen(false); setDocReview(null);
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? "";
      if (token) setAccessToken(token);
      const res = await fetch(`/api/portal/admin?userId=${encodeURIComponent(uid)}`, { headers: { Authorization: `Bearer ${token}` } });
      if (cancelled) return;
      if (res.ok) {
        const j = await res.json().catch(() => ({ docs: [], profiles: {} }));
        setPeekDocs(((j.docs ?? []) as PeekDoc[]).filter((d) => d.user_id === uid));
        setPeekProfile((j.profiles?.[uid] ?? null) as PassportProfile | null);
      } else { setPeekDocs([]); setPeekProfile(null); }
    })();
    return () => { cancelled = true; };
  }, [peek?.userId]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => `${r.name} ${specialtyLabel(r.facts?.specialty, lang)} ${r.facts?.specialty ?? ""} ${r.facts?.workplace ?? ""}`.toLowerCase().includes(needle));
  }, [rows, q, lang]);

  // The B2 / Impfung tracks ignore the journey-specific filter tabs (sellable /
  // attention) — those are about the main journey. They respect only the search.
  const searchOnlyRows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => `${r.name} ${specialtyLabel(r.facts?.specialty, lang)} ${r.facts?.specialty ?? ""} ${r.facts?.workplace ?? ""}`.toLowerCase().includes(needle));
  }, [rows, q, lang]);

  // Sync the editable nurse-facts form whenever a different candidate is peeked.
  useEffect(() => {
    if (!peek) return;
    setFactsDraft({
      specialty: peek.facts?.specialty ?? "",
      years: peek.facts?.yearsExperience != null ? String(peek.facts.yearsExperience) : "",
      workplace: peek.facts?.workplace ?? "",
      availableFrom: peek.facts?.availableFrom ?? "",
    });
    setFactsEdit(false);
    setPipeDraft({
      interview1: peek.pipeline?.interview1 ?? "",
      interview2: peek.pipeline?.interview2 ?? "",
      interview1Date: peek.pipeline?.interview1Date ?? "",
      interview2Date: peek.pipeline?.interview2Date ?? "",
      visaApptDate: peek.pipeline?.visaApptDate ?? "",
      flightDate: peek.pipeline?.flightDate ?? "",
      flightInfo: peek.pipeline?.flightInfo ?? "",
      housingDone: peek.pipeline?.housingDone ?? false,
    });
    setStepIndex(null);
    setMoreOpen(false);
    setMsgText("");
    setMsgSent(false);
    // Re-init ONLY when the candidate changes — in-place edits (B2 / Anerkennung
    // / facts / a saved step) keep the open "More" panel + drafts intact instead
    // of snapping everything shut on every peek mutation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peek?.userId]);

  // Drag-and-drop: drop a face on a stage lane to move them. Optimistic (instant
  // glide via Motion) → persist to the right route (B2 or Anerkennung, both gated
  // by LAW #25) → roll back on failure. Branches on the currently shown track.
  const moveStage = async (userId: string, toStage: string) => {
    const snapshot = rows;
    setRows((rs) => rs.map((r) => (r.userId === userId ? { ...r, b2Stage: toStage } : r)));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? "";
      const res = await fetch("/api/portal/journey/b2", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ candidateId: userId, stage: toStage }),
      });
      if (!res.ok) { setRows(snapshot); toast.error(T("Couldn't move — try again", "Verschieben fehlgeschlagen", "Déplacement échoué")); }
    } catch {
      setRows(snapshot);
      toast.error(T("Couldn't move — try again", "Verschieben fehlgeschlagen", "Déplacement échoué"));
    }
  };

  // Set a candidate's B2 or Anerkennung stage straight from the peek's Status
  // panel — optimistic on the board AND the open peek so it reflects instantly
  // (without collapsing "More"); reverts via reload on failure. LAW #25 server-side.
  const setPeekStage = async (track: "b2" | "anerk", userId: string, stage: string) => {
    const patch = track === "b2" ? { b2Stage: stage } : { anerkennungStage: stage };
    setRows((rs) => rs.map((r) => (r.userId === userId ? { ...r, ...patch } : r)));
    setPeek((p) => (p && p.userId === userId ? { ...p, ...patch } : p));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? accessToken;
      const url = track === "b2" ? "/api/portal/journey/b2" : "/api/portal/journey/anerkennung";
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ candidateId: userId, stage }) });
      if (res.ok) toast.success(T("Updated ✓", "Aktualisiert ✓", "Mis à jour ✓"));
      else { toast.error(T("Couldn't update", "Update fehlgeschlagen", "Échec de la mise à jour")); void reload(); }
    } catch { toast.error(T("Couldn't update", "Update fehlgeschlagen", "Échec de la mise à jour")); void reload(); }
  };

  // Send a follow-up reminder to a candidate (in-app bell notification, masked
  // as coming from "Borivon"). One click from the peek popup.
  const sendNudge = async (userId: string) => {
    setNudging(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? "";
      const res = await fetch("/api/portal/journey/nudge", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ candidateId: userId }),
      });
      if (res.ok) { setNudged(userId); toast.success(T("Reminder sent", "Erinnerung gesendet", "Rappel envoyé")); }
      else toast.error(T("Couldn't send reminder", "Senden fehlgeschlagen", "Échec de l'envoi"));
    } catch { toast.error(T("Couldn't send reminder", "Senden fehlgeschlagen", "Échec de l'envoi")); }
    setNudging(false);
  };

  // Quick note to the candidate from the peek — posts to the shared Borivon
  // inbox (candidate sees "Borivon", never an individual admin). LAW #25 gated.
  const sendMessage = async () => {
    if (!peek || !msgText.trim()) return;
    setSendingMsg(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? accessToken;
      const res = await fetch("/api/portal/admin/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ threadUserId: peek.userId, body: msgText.trim() }),
      });
      if (res.ok) { setMsgText(""); setMsgSent(true); setTimeout(() => setMsgSent(false), 2500); toast.success(T("Message sent", "Nachricht gesendet", "Message envoyé")); }
      else toast.error(T("Couldn't send", "Senden fehlgeschlagen", "Échec de l'envoi"));
    } catch { toast.error(T("Couldn't send", "Senden fehlgeschlagen", "Échec de l'envoi")); }
    setSendingMsg(false);
  };

  const updateFact = (patch: Partial<typeof factsDraft>) => setFactsDraft((d) => ({ ...d, ...patch }));

  // Persist nurse profile facts (specialty / experience / workplace / availability).
  const saveFacts = async () => {
    if (!peek) return;
    const id = peek.userId;
    setFactsSaving(true);
    const payload = {
      candidateId: id,
      specialty: factsDraft.specialty || null,
      yearsExperience: factsDraft.years === "" ? null : Number(factsDraft.years),
      workplace: factsDraft.workplace,
      availableFrom: factsDraft.availableFrom || null,
    };
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? "";
      const res = await fetch("/api/portal/journey/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const newFacts: Facts = { specialty: payload.specialty, yearsExperience: payload.yearsExperience, workplace: payload.workplace || null, availableFrom: payload.availableFrom };
        setRows((rs) => rs.map((r) => (r.userId === id ? { ...r, facts: newFacts } : r)));
        setPeek((p) => (p && p.userId === id ? { ...p, facts: newFacts } : p));
        setFactsEdit(false);
        toast.success(T("Profile saved", "Profil gespeichert", "Profil enregistré"));
      } else {
        toast.error(T("Couldn't save", "Speichern fehlgeschlagen", "Échec de l'enregistrement"));
      }
    } catch { toast.error(T("Couldn't save", "Speichern fehlgeschlagen", "Échec de l'enregistrement")); }
    setFactsSaving(false);
  };

  // Re-fetch the board so server-recomputed journey positions reflect new inputs.
  const reload = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? "";
      const res = await fetch("/api/portal/journey/pipeline", { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const j = await res.json();
        const next = (j.candidates ?? []) as Row[];
        setRows(next);
        // Keep the OPEN peek in sync so the guided step advances to the next
        // question the instant an answer is saved (server recomputes `current`).
        setPeek((p) => (p ? (next.find((r) => r.userId === p.userId) ?? p) : p));
      }
    } catch { /* keep current */ }
  };

  // Guided step save — persist ONE milestone's answer to candidate_pipeline, then
  // reload so the board AND the open peek both advance to the next question. The
  // optimistic merge gives instant feedback; reload() makes `status` truthful.
  const saveStep = async (fields: Record<string, unknown>, optimistic: Partial<PipelineFacts>) => {
    if (!peek) return;
    const id = peek.userId;
    setSavingStep(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? "";
      const res = await fetch("/api/portal/pipeline", { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ userId: id, ...fields }) });
      if (res.ok) {
        setPeek((p) => (p && p.userId === id ? { ...p, pipeline: { ...(p.pipeline as PipelineFacts), ...optimistic } } : p));
        toast.success(T("Saved ✓", "Gespeichert ✓", "Enregistré ✓"));
        await reload();
      } else {
        toast.error(T("Couldn't save", "Speichern fehlgeschlagen", "Échec de l'enregistrement"));
      }
    } catch { toast.error(T("Couldn't save", "Speichern fehlgeschlagen", "Échec de l'enregistrement")); }
    setSavingStep(false);
  };

  if (loading) return <PageLoader />;

  const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "?";

  // Two views only: Board (unified grid, default) + Map (the visual rail).
  const viewOpts: [("board" | "map"), typeof MapIcon, string][] = [
    ["board", LayoutGrid, T("Board", "Tafel", "Tableau")],
    ["map", MapIcon, T("Map", "Karte", "Carte")],
  ];

  return (
    <main id="bv-main" className="mx-auto px-4 sm:px-5 py-5 sm:py-7 bv-page-bottom" style={{ maxWidth: 1080 }}>
      <button onClick={() => router.push("/portal/admin")} className="bv-press inline-flex items-center gap-1.5 mb-3 text-[12px]" style={{ color: "var(--w3)" }}>
        <ArrowLeft size={14} strokeWidth={2} /> {T("Back to admin", "Zurück zum Admin", "Retour à l'admin")}
      </button>

      {/* Compact top bar — title · stats · track + view, all tight. */}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.4, color: "var(--w)" }}>{T("Pipeline", "Pipeline", "Pipeline")}</h1>
        <div className="inline-flex items-center gap-1.5">
          {view !== "board" && ([
            ["journey", T("Journey", "Reise", "Parcours")],
            ["b2", T("B2 German", "B2 Deutsch", "B2 allemand")],
          ] as const).map(([v, label]) => (
            <button key={v} onClick={() => setTrack(v)}
              className="px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors"
              style={track === v ? { background: "var(--gold)", color: "#131312" } : { background: "var(--bg2)", color: "var(--w3)", border: "1px solid var(--border)" }}>
              {label}
            </button>
          ))}
          {view !== "board" && <span style={{ width: 1, height: 18, background: "var(--border)", margin: "0 2px" }} />}
          {viewOpts.map(([v, Icon, label]) => (
            <button key={v} onClick={() => setView(v)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors"
              style={view === v ? { background: "var(--gold)", color: "#131312" } : { background: "var(--bg2)", color: "var(--w3)", border: "1px solid var(--border)" }}>
              <Icon size={13} /> <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Search — slim. */}
      <div className="relative mb-2.5">
        <Search size={14} className="absolute" style={{ left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--w3)" }} />
        <input value={q} onChange={(e) => setQ(e.target.value)} className="bv-input" style={{ paddingLeft: 34, height: 38, fontSize: 13 }}
          placeholder={T("Search candidate…", "Kandidat suchen…", "Rechercher…")} />
      </div>

      {/* Two views: Board (unified sortable grid) and Map (the visual rail). */}
      {view === "board" ? (
        <CandidateTable rows={shown} lang={lang} onPick={(uid) => setPeek(rows.find((r) => r.userId === uid) ?? null)} />
      ) : (
        <JourneyMap rows={track !== "journey" ? searchOnlyRows : shown} lang={lang} track={track}
          onPick={(uid) => setPeek(rows.find((r) => r.userId === uid) ?? null)}
          onMoveStage={moveStage} />
      )}
      {/* Candidate peek — quick cross-track summary; the dossier is one click away. */}
      <Modal
        open={!!peek}
        onClose={() => setPeek(null)}
        size="md"
        title={peek?.name ?? ""}
        footer={peek ? (
          <>
            <GhostButton onClick={() => setPeek(null)}>{T("Close", "Schließen", "Fermer")}</GhostButton>
            <button onClick={() => setSheetOpen(true)}
              className="bv-press text-[12.5px] font-semibold px-3.5 py-2 rounded-lg inline-flex items-center gap-1.5"
              style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>
              <FileText size={14} /> {T("Employer sheet", "Arbeitgeber-Blatt", "Fiche employeur")}
            </button>
            <GoldButton onClick={() => { const id = peek.userId; setPeek(null); router.push(`/portal/admin?nav_user_id=${encodeURIComponent(id)}`); }}>
              {T("Open full profile", "Profil öffnen", "Profil complet")} <ArrowRight size={14} strokeWidth={2.5} />
            </GoldButton>
          </>
        ) : null}>
        {peek && (() => {
          const b2s = normalizeB2Stage(peek.b2Stage);
          const anerk = normalizeAnerkennungStage(peek.anerkennungStage);
          const imp = (peek.impfungStage ?? "not_required") as ImpfungStage;
          const impDef = imp !== "not_required" && imp !== "not_started" ? IMPFUNG_STAGE_BY_KEY[imp] : undefined;
          const pct = Math.round(peek.status.progress * 100);
          const hs = HEALTH_STYLE[peek.status.health];
          const card: CSSProperties = { borderRadius: 16, border: "1px solid var(--border)", background: "var(--bg2)", padding: 16, boxShadow: "0 1px 2px rgba(0,0,0,0.05)" };
          const cap: CSSProperties = { fontSize: 10.5, fontWeight: 700, color: "var(--w3)", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 10 };
          const lbl: CSSProperties = { fontSize: 10.5, fontWeight: 600, color: "var(--w3)", marginBottom: 4, display: "block" };
          const reportLabel = (rep: SelfReport) => {
            if (rep.kind === "b2") return rep.outcome === "passed" ? T("Passed B2 🎉", "B2 bestanden 🎉", "B2 réussi 🎉") : T("Didn't pass B2 — retaking", "B2 nicht bestanden", "B2 non réussi");
            if (rep.kind === "interview") return rep.outcome === "passed" ? T("Passed an interview ✅", "Gespräch bestanden ✅", "Entretien réussi ✅")
              : rep.outcome === "scheduled" ? T("Interview scheduled 📅", "Gespräch geplant 📅", "Entretien planifié 📅")
              : T("Interview didn't pass", "Gespräch nicht bestanden", "Entretien non réussi");
            return rep.note || T("Update", "Update", "Mise à jour");
          };
          const passFail = (value: string, onChange: (v: string) => void) => (
            <div className="flex gap-2">
              {([["passed", T("Passed ✅", "Bestanden ✅", "Réussi ✅"), "good"], ["failed", T("Didn't pass ✗", "Nicht bestanden ✗", "Échoué ✗"), "bad"]] as const).map(([v, label, tone]) => {
                const active = value === v;
                const st: CSSProperties = active
                  ? (tone === "good" ? { background: "var(--success-bg)", color: "var(--success)", border: "1px solid var(--success-border)" } : { background: "var(--danger-bg)", color: "var(--danger)", border: "1px solid var(--danger-border)" })
                  : { background: "var(--bg2)", color: "var(--w3)", border: "1px solid var(--border)" };
                return <button key={v} onClick={() => onChange(active ? "pending" : v)} className="bv-press text-[12px] font-semibold px-2.5 py-1.5 rounded-lg" style={st}>{label}</button>;
              })}
            </div>
          );
          // ── Guided flow — where are they, and which single step is on screen? ──
          // The peek asks ONE question at a time, computed from the candidate's live
          // position. Answering it saves + advances to the next. ◀ ▶ revisit any step.
          const firstName = peek.name.split(/\s+/).filter(Boolean)[0] || peek.name;
          const pf = peek.pipeline;
          // The candidate's German CV (Lebenslauf) doc, if uploaded — so the CV
          // step can open it for review/approve/reject inline. Latest match first
          // (docs come back newest-first from the admin route).
          const cvDoc = (peekDocs ?? []).find((d) => /lebenslauf/i.test(d.file_type)) ?? (peekDocs ?? []).find((d) => /(^|_)cv/i.test(d.file_type));
          const presets = SEQUENTIAL_PRESETS.slice().sort((a, b) => a.position - b.position);
          const total = presets.length;
          const allDone = !peek.status.current;
          const currentPos = peek.status.current?.position ?? total;
          const viewPos = stepIndex ?? Math.min(currentPos, total - 1);
          const stepKey = presets[viewPos]?.key ?? "arrived";
          const showDone = allDone && stepIndex === null;
          const stepQuestion = (k: string): string => {
            switch (k) {
              case "cv_finalized": return T(`Is ${firstName}'s German CV approved?`, `Ist der Lebenslauf von ${firstName} freigegeben?`, `Le CV allemand de ${firstName} est-il validé ?`);
              case "interview_first": return T(`Did ${firstName} pass the first interview?`, `Hat ${firstName} das erste Interview bestanden?`, `${firstName} a réussi le premier entretien ?`);
              case "interview_second": return T(`Did ${firstName} pass the second interview?`, `Hat ${firstName} das zweite Interview bestanden?`, `${firstName} a réussi le deuxième entretien ?`);
              case "contract_signed": return T("Contract sealed?", "Vertrag abgeschlossen?", "Contrat conclu ?");
              case "recognition_submitted": return T("Recognition approved?", "Anerkennung genehmigt?", "Reconnaissance approuvée ?");
              case "vorabzustimmung": return T("Vorabzustimmung issued?", "Vorabzustimmung erteilt?", "Vorabzustimmung délivrée ?");
              case "docs_collected": return T("All documents ready for the embassy?", "Alle Unterlagen für die Botschaft bereit?", "Tous les documents prêts pour l'ambassade ?");
              case "visa_appointment": return T("When is the visa appointment?", "Wann ist der Visumtermin?", "Quand est le rendez-vous visa ?");
              case "visa_approved": return T("Visa approved?", "Visum genehmigt?", "Visa approuvé ?");
              case "flight_booked": return T("When is the flight?", "Wann ist der Flug?", "Quand est le vol ?");
              case "housing_arranged": return T("Housing arranged?", "Unterkunft organisiert?", "Logement organisé ?");
              case "arrived": return T(`Has ${firstName} arrived in Germany?`, `Ist ${firstName} in Deutschland angekommen?`, `${firstName} est arrivé en Allemagne ?`);
              default: return presetLabel(k, lang);
            }
          };
          const saveInterview = (n: 1 | 2, statusVal: string, dateVal: string) => {
            const chosen = statusVal === "passed" || statusVal === "failed";
            if (n === 1) void saveStep({ ...(chosen ? { interview1_status: statusVal } : {}), interview1_date: dateVal || "" }, { ...(chosen ? { interview1: statusVal } : {}), interview1Date: dateVal || null });
            else void saveStep({ ...(chosen ? { interview2_status: statusVal } : {}), interview2_date: dateVal || "" }, { ...(chosen ? { interview2: statusVal } : {}), interview2Date: dateVal || null });
          };
          const confirmControls = (done: boolean, on: Record<string, unknown>, onOpt: Partial<PipelineFacts>, off: Record<string, unknown>, offOpt: Partial<PipelineFacts>, yes?: string) => (
            <div className="flex items-center gap-2 flex-wrap">
              {!done ? (
                <button onClick={() => void saveStep(on, onOpt)} disabled={savingStep} className="bv-press inline-flex items-center gap-1.5 text-[13px] font-bold px-4 py-2.5 rounded-xl disabled:opacity-60" style={{ background: "var(--success-bg)", color: "var(--success)", border: "1px solid var(--success-border)" }}>
                  <Check size={15} strokeWidth={2.6} /> {yes ?? T("Yes, done", "Ja, erledigt", "Oui, fait")}
                </button>
              ) : (
                <>
                  <span className="inline-flex items-center gap-1.5 text-[13px] font-bold px-4 py-2.5 rounded-xl" style={{ background: "var(--success-bg)", color: "var(--success)", border: "1px solid var(--success-border)" }}>
                    <CheckCircle2 size={15} strokeWidth={2.4} /> {T("Done ✓", "Erledigt ✓", "Fait ✓")}
                  </span>
                  <button onClick={() => void saveStep(off, offOpt)} disabled={savingStep} className="bv-press text-[12px] font-medium px-3 py-2" style={{ color: "var(--w3)" }}>{T("Undo", "Rückgängig", "Annuler")}</button>
                </>
              )}
            </div>
          );
          const saveAndNext = (onSave: () => void, disabled: boolean) => (
            <button onClick={onSave} disabled={savingStep || disabled} className="bv-press inline-flex items-center gap-1.5 self-start text-[12.5px] font-bold px-4 py-2 rounded-xl disabled:opacity-50 mt-1" style={{ background: "var(--gold)", color: "#131312" }}>
              {savingStep ? T("Saving…", "Speichern…", "Enregistrement…") : <>{T("Save & next", "Speichern & weiter", "Enregistrer & suivant")} <ArrowRight size={14} strokeWidth={2.5} /></>}
            </button>
          );
          // Compact, tappable list of the candidate's documents — each opens the
          // review popup (approve / reject / download). Used on the docs step AND
          // in "More" so any paper (passport included) is reviewable without
          // leaving her. The review modal handles passports safely (LAW #39).
          const docDot = (s: string) => s === "approved" ? "var(--success)" : s === "rejected" ? "var(--danger)" : s === "pending" ? "#f59e0b" : "var(--w3)";
          const docList = (docs: PeekDoc[]) => (
            <div className="flex flex-col gap-1.5">
              {docs.map((d) => (
                <button key={d.id} onClick={() => setDocReview(d)} className="bv-press w-full flex items-center gap-2 text-left px-3 py-2 rounded-lg" style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: docDot(d.status), flexShrink: 0 }} />
                  <span className="flex-1 truncate text-[12.5px] font-medium" style={{ color: "var(--w2)" }}>{translateDocLabel(d.file_type, lang as "en" | "fr" | "de")}</span>
                  <FileText size={13} style={{ color: "var(--w3)", flexShrink: 0 }} />
                </button>
              ))}
            </div>
          );
          return (
            <div className="p-5 flex flex-col gap-3">
              {/* Identity */}
              <div className="flex items-center gap-3.5 pb-3 mb-0.5" style={{ borderBottom: "1px solid var(--border)" }}>
                {peek.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={peek.photo} alt="" className="rounded-full object-cover flex-shrink-0" style={{ width: 60, height: 60, border: `2.5px solid ${hs.dot}`, boxShadow: `0 0 0 4px color-mix(in srgb, ${hs.dot} 14%, transparent)` }} />
                ) : (
                  <span className="rounded-full flex items-center justify-center flex-shrink-0 text-[20px] font-bold" style={{ width: 60, height: 60, background: "var(--gdim)", color: "var(--gold)", border: `2.5px solid ${hs.dot}`, boxShadow: `0 0 0 4px color-mix(in srgb, ${hs.dot} 14%, transparent)` }}>{initials(peek.name)}</span>
                )}
                <div className="min-w-0 flex items-center gap-2 flex-wrap">
                  {peek.sellable?.sellable && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "var(--gold)", color: "#131312" }}>
                      <BadgeCheck size={10} strokeWidth={2.5} /> {T("READY TO SELL", "VERKAUFSBEREIT", "PRÊT À VENDRE")}
                    </span>
                  )}
                  {(peek.pipeline?.interview1 === "failed" || peek.pipeline?.interview2 === "failed") && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "var(--danger-bg)", color: "var(--danger)", border: "1px solid var(--danger-border)" }}>
                      ⚠ {T("INTERVIEW NOT PASSED", "INTERVIEW NICHT BESTANDEN", "ENTRETIEN NON RÉUSSI")}
                    </span>
                  )}
                </div>
              </div>

              {/* Chase banner — sat at this station longer than its budget. */}
              {peek.stuck?.stuck && (
                <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl" style={{ background: "color-mix(in srgb, #ef4444 12%, transparent)", border: "1px solid color-mix(in srgb, #ef4444 42%, var(--border))" }}>
                  <span style={{ fontSize: 15, flexShrink: 0 }}>⏳</span>
                  <span className="flex-1 text-[12px] font-semibold" style={{ color: "var(--w)" }}>
                    {peek.stuck.days == null
                      ? T("No activity yet — time to chase.", "Noch keine Aktivität — nachhaken.", "Aucune activité — à relancer.")
                      : T(`Stuck here ${peek.stuck.days} days (usual ~${peek.stuck.threshold}) — chase or update below.`,
                          `Seit ${peek.stuck.days} Tagen hier (üblich ~${peek.stuck.threshold}) — nachhaken oder unten aktualisieren.`,
                          `Bloqué ici depuis ${peek.stuck.days} j (habituel ~${peek.stuck.threshold}) — relancez ou mettez à jour.`)}
                  </span>
                  <button onClick={() => sendNudge(peek.userId)} disabled={nudging || nudged === peek.userId}
                    className="bv-press inline-flex items-center gap-1.5 text-[11.5px] font-bold px-3 py-1.5 rounded-lg flex-shrink-0 disabled:opacity-70"
                    style={nudged === peek.userId ? { background: "var(--success-bg)", color: "var(--success)", border: "1px solid var(--success-border)" } : { background: "#ef4444", color: "#fff" }}>
                    {nudged === peek.userId ? <><CheckCircle2 size={13} strokeWidth={2.2} /> {T("Reminded", "Erinnert", "Relancé")}</> : <><Bell size={13} strokeWidth={2.2} /> {nudging ? T("…", "…", "…") : T("Remind", "Erinnern", "Relancer")}</>}
                  </button>
                </div>
              )}

              {/* THE one thing — a single guided question for exactly where they are. */}
              {showDone ? (
                <div style={{ ...card, textAlign: "center", padding: 22 }}>
                  <div style={{ fontSize: 30, marginBottom: 4 }}>🎉</div>
                  <div className="text-[15px] font-bold" style={{ color: "var(--w)" }}>{T("Arrived in Germany", "In Deutschland angekommen", "Arrivé en Allemagne")} 🇩🇪</div>
                  <div className="text-[12px] mt-1" style={{ color: "var(--w3)" }}>{T("Every milestone complete.", "Alle Etappen abgeschlossen.", "Toutes les étapes terminées.")}</div>
                </div>
              ) : (
                <div style={{ ...card, padding: 18 }}>
                  <div className="text-[16.5px] font-bold leading-snug mb-3.5" style={{ color: "var(--w)", letterSpacing: -0.2 }}>{stepQuestion(stepKey)}</div>
                  {(() => {
                    switch (stepKey) {
                      case "cv_finalized":
                        return (
                          <div className="flex flex-col gap-2.5">
                            {peekDocs === null ? (
                              <p className="text-[12.5px]" style={{ color: "var(--w3)" }}>{T("Loading their documents…", "Dokumente werden geladen…", "Chargement des documents…")}</p>
                            ) : cvDoc ? (
                              <>
                                <p className="text-[12.5px]" style={{ color: "var(--w2)" }}>
                                  {cvDoc.status === "rejected"
                                    ? T("Their German CV was rejected — open it to review again.", "Lebenslauf wurde abgelehnt — erneut prüfen.", "Leur CV a été refusé — rouvrez-le pour revoir.")
                                    : T("Their German CV is in — review it and approve or reject, right here.", "Lebenslauf liegt vor — hier prüfen und genehmigen oder ablehnen.", "Leur CV est là — vérifiez et approuvez ou refusez, ici même.")}
                                </p>
                                <button onClick={() => setDocReview(cvDoc)} className="bv-press inline-flex items-center gap-1.5 self-start text-[13px] font-bold px-4 py-2.5 rounded-xl" style={{ background: "var(--gold)", color: "#131312" }}>
                                  <FileText size={14} /> {T("Review CV — approve / reject", "Lebenslauf prüfen", "Vérifier le CV")}
                                </button>
                              </>
                            ) : (
                              <>
                                <p className="text-[12.5px]" style={{ color: "var(--w2)" }}>{T("No German CV uploaded yet — build or upload one in their profile.", "Noch kein Lebenslauf — im Profil erstellen oder hochladen.", "Aucun CV allemand encore — créez-en un dans leur profil.")}</p>
                                <button onClick={() => { const id = peek.userId; setPeek(null); router.push(`/portal/admin?nav_user_id=${encodeURIComponent(id)}`); }} className="bv-press inline-flex items-center gap-1.5 self-start text-[12.5px] font-bold px-4 py-2 rounded-xl" style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>
                                  {T("Open full profile", "Profil öffnen", "Profil complet")} <ArrowRight size={14} strokeWidth={2.5} />
                                </button>
                              </>
                            )}
                          </div>
                        );
                      case "interview_first":
                      case "interview_second": {
                        const n: 1 | 2 = stepKey === "interview_first" ? 1 : 2;
                        const statusVal = n === 1 ? pipeDraft.interview1 : pipeDraft.interview2;
                        const dateVal = n === 1 ? pipeDraft.interview1Date : pipeDraft.interview2Date;
                        const chosen = statusVal === "passed" || statusVal === "failed";
                        const passed = statusVal === "passed";
                        return (
                          <div className="flex flex-col gap-3">
                            {passFail(statusVal, (v) => setPipeDraft((d) => (n === 1 ? { ...d, interview1: v } : { ...d, interview2: v })))}
                            {(chosen || dateVal) && (
                              <div>
                                <label style={lbl}>{passed ? T("When was it?", "Wann war es?", "C'était quand ?") : T("When is it scheduled?", "Wann ist der Termin?", "C'est prévu quand ?")}</label>
                                <input className="bv-input" type="date" value={dateVal} onChange={(e) => setPipeDraft((d) => (n === 1 ? { ...d, interview1Date: e.target.value } : { ...d, interview2Date: e.target.value }))} style={{ fontSize: 12.5, maxWidth: 210 }} />
                              </div>
                            )}
                            {statusVal === "failed" && (
                              <p className="text-[11.5px]" style={{ color: "var(--danger)" }}>{T("Logged as not passed — they'll re-sit before moving on.", "Als nicht bestanden erfasst — Wiederholung nötig.", "Enregistré comme non réussi — à repasser.")}</p>
                            )}
                            {saveAndNext(() => saveInterview(n, statusVal, dateVal), !chosen && !dateVal)}
                          </div>
                        );
                      }
                      case "contract_signed": return confirmControls(!!pf?.contractDone, { contract_done: true }, { contractDone: true }, { contract_done: false }, { contractDone: false });
                      case "recognition_submitted": return confirmControls(!!pf?.recognitionDone, { recognition_done: true }, { recognitionDone: true }, { recognition_done: false }, { recognitionDone: false });
                      case "vorabzustimmung": return confirmControls(!!pf?.vorabDone, { vorab_done: true }, { vorabDone: true }, { vorab_done: false }, { vorabDone: false });
                      case "docs_collected":
                        return (
                          <div className="flex flex-col gap-3">
                            {peekDocs === null ? (
                              <p className="text-[12px]" style={{ color: "var(--w3)" }}>{T("Loading documents…", "Dokumente laden…", "Chargement…")}</p>
                            ) : peekDocs.length > 0 ? (
                              <div className="flex flex-col gap-1.5">
                                <span className="text-[11px] font-semibold" style={{ color: "var(--w3)" }}>{T("Tap any to review · approve · reject", "Zum Prüfen tippen", "Touchez pour vérifier")}</span>
                                {docList(peekDocs)}
                              </div>
                            ) : (
                              <p className="text-[12px]" style={{ color: "var(--w3)" }}>{T("No documents uploaded yet.", "Noch keine Dokumente.", "Aucun document encore.")}</p>
                            )}
                            {confirmControls(!!pf?.docsReady, { docs_ready: true }, { docsReady: true }, { docs_ready: false }, { docsReady: false }, T("All ready for embassy ✓", "Alle bereit ✓", "Tout est prêt ✓"))}
                          </div>
                        );
                      case "visa_appointment":
                        return (
                          <div className="flex flex-col gap-1.5">
                            <input className="bv-input" type="date" value={pipeDraft.visaApptDate} onChange={(e) => setPipeDraft((d) => ({ ...d, visaApptDate: e.target.value }))} style={{ fontSize: 12.5, maxWidth: 210 }} />
                            {saveAndNext(() => void saveStep({ visa_appt_date: pipeDraft.visaApptDate || "" }, { visaApptDate: pipeDraft.visaApptDate || null }), !pipeDraft.visaApptDate)}
                          </div>
                        );
                      case "visa_approved": return confirmControls(!!pf?.visaGranted, { visa_granted: true }, { visaGranted: true }, { visa_granted: false, visa_date: "" }, { visaGranted: false });
                      case "flight_booked":
                        return (
                          <div className="flex flex-col gap-2.5">
                            <div>
                              <label style={lbl}>{T("Flight date", "Flugdatum", "Date de vol")}</label>
                              <input className="bv-input" type="date" value={pipeDraft.flightDate} onChange={(e) => setPipeDraft((d) => ({ ...d, flightDate: e.target.value }))} style={{ fontSize: 12.5, maxWidth: 210 }} />
                            </div>
                            <div>
                              <label style={lbl}>{T("Flight info (optional)", "Fluginfo (optional)", "Infos vol (option.)")}</label>
                              <input className="bv-input" type="text" maxLength={200} value={pipeDraft.flightInfo} onChange={(e) => setPipeDraft((d) => ({ ...d, flightInfo: e.target.value }))} placeholder={T("e.g. CMN → FRA, 14:30", "z. B. CMN → FRA, 14:30", "ex. CMN → FRA, 14:30")} style={{ fontSize: 12.5 }} />
                            </div>
                            {saveAndNext(() => void saveStep({ flight_date: pipeDraft.flightDate || "", flight_info: pipeDraft.flightInfo }, { flightDate: pipeDraft.flightDate || null, flightInfo: pipeDraft.flightInfo || null }), !pipeDraft.flightDate)}
                          </div>
                        );
                      case "housing_arranged": return confirmControls(!!pf?.housingDone, { housing_done: true }, { housingDone: true }, { housing_done: false }, { housingDone: false });
                      case "arrived": return confirmControls(!!pf?.arrivedDone, { arrived_done: true }, { arrivedDone: true }, { arrived_done: false }, { arrivedDone: false }, T("Yes, arrived 🎉", "Ja, angekommen 🎉", "Oui, arrivé 🎉"));
                      default: return null;
                    }
                  })()}
                </div>
              )}

              {/* Move through steps — thin progress, ◀ ▶ to log any other step. */}
              <div className="flex items-center gap-2.5">
                <button onClick={() => setStepIndex(Math.max(0, viewPos - 1))} disabled={viewPos <= 0}
                  className="bv-press flex items-center justify-center rounded-lg flex-shrink-0 disabled:opacity-25" style={{ width: 30, height: 30, background: "var(--bg2)", border: "1px solid var(--border)", color: "var(--w2)" }} aria-label={T("Previous step", "Vorheriger Schritt", "Étape précédente")}>
                  <ChevronLeft size={16} />
                </button>
                <div className="flex-1" style={{ height: 6, borderRadius: 999, background: "var(--border)", overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: hs.dot, transition: "width .3s ease" }} />
                </div>
                {stepIndex !== null && (
                  <button onClick={() => setStepIndex(null)} className="bv-press text-[10.5px] font-bold flex-shrink-0" style={{ color: "var(--gold)" }}>{T("now", "jetzt", "actuel")} →</button>
                )}
                <button onClick={() => setStepIndex(Math.min(total - 1, viewPos + 1))} disabled={viewPos >= total - 1}
                  className="bv-press flex items-center justify-center rounded-lg flex-shrink-0 disabled:opacity-25" style={{ width: 30, height: 30, background: "var(--bg2)", border: "1px solid var(--border)", color: "var(--w2)" }} aria-label={T("Next step", "Nächster Schritt", "Étape suivante")}>
                  <ChevronRight size={16} />
                </button>
              </div>

              {/* MORE — everything secondary, collapsed so the question stays the star. */}
              <button onClick={() => setMoreOpen((o) => !o)} className="bv-press w-full flex items-center gap-1.5 text-[11.5px] font-semibold pt-0.5" style={{ color: "var(--w3)" }}>
                <ChevronDown size={14} style={{ transform: moreOpen ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
                {moreOpen ? T("Less", "Weniger", "Moins") : T("More — status · profile · updates", "Mehr — Status · Profil · Updates", "Plus — statut · profil · mises à jour")}
              </button>
              {moreOpen && (
                <div className="flex flex-col gap-3">

              {/* Nurse profile — one compact line; click to edit (progressive disclosure). */}
              {!factsEdit ? (
                <button onClick={() => setFactsEdit(true)}
                  className="bv-press w-full text-left flex items-center gap-2 text-[12.5px] px-3 py-2.5 rounded-xl"
                  style={{ background: "var(--bg2)", border: "1px solid var(--border)", color: "var(--w2)" }}>
                  <span style={{ flexShrink: 0 }}>🩺</span>
                  <span className="flex-1 truncate">
                    {[
                      peek.facts?.specialty ? specialtyLabel(peek.facts.specialty, lang) : null,
                      peek.facts?.yearsExperience != null ? `${peek.facts.yearsExperience} ${T("yrs", "J.", "ans")}` : null,
                      peek.facts?.workplace || null,
                      peek.facts?.availableFrom ? `${T("from", "ab", "dès")} ${peek.facts.availableFrom}` : null,
                    ].filter(Boolean).join("  ·  ") || T("Add nurse details", "Pflegedetails hinzufügen", "Ajouter des détails")}
                  </span>
                  <Pencil size={13} style={{ color: "var(--w3)", flexShrink: 0 }} />
                </button>
              ) : (
                <div style={card}>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="col-span-2">
                      <label style={lbl}>{T("Specialty", "Fachbereich", "Spécialité")}</label>
                      <select className="bv-input" value={factsDraft.specialty} onChange={(e) => updateFact({ specialty: e.target.value })} style={{ fontSize: 12.5 }}>
                        <option value="">{T("— none set —", "— keine —", "— aucune —")}</option>
                        {NURSE_SPECIALTIES.map((s) => <option key={s.key} value={s.key}>{specialtyLabel(s.key, lang)}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={lbl}>{T("Years", "Jahre", "Années")}</label>
                      <input className="bv-input" type="number" min={0} max={60} value={factsDraft.years} onChange={(e) => updateFact({ years: e.target.value })} style={{ fontSize: 12.5 }} />
                    </div>
                    <div>
                      <label style={lbl}>{T("Available from", "Verfügbar ab", "Disponible dès")}</label>
                      <input className="bv-input" type="date" value={factsDraft.availableFrom} onChange={(e) => updateFact({ availableFrom: e.target.value })} style={{ fontSize: 12.5 }} />
                    </div>
                    <div className="col-span-2">
                      <label style={lbl}>{T("Current workplace", "Aktueller Arbeitsplatz", "Lieu de travail actuel")}</label>
                      <input className="bv-input" type="text" maxLength={120} value={factsDraft.workplace} onChange={(e) => updateFact({ workplace: e.target.value })}
                        placeholder={T("e.g. CHU Ibn Sina — ICU", "z. B. CHU Ibn Sina — Intensiv", "ex. CHU Ibn Sina — soins intensifs")} style={{ fontSize: 12.5 }} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    <button onClick={() => void saveFacts()} disabled={factsSaving}
                      className="bv-press inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg disabled:opacity-60"
                      style={{ background: "var(--gold)", color: "#131312" }}>
                      {factsSaving ? T("Saving…", "Speichern…", "Enregistrement…") : T("Save", "Speichern", "Enregistrer")}
                    </button>
                    <button onClick={() => setFactsEdit(false)} className="bv-press text-[12px] font-medium px-3 py-1.5" style={{ color: "var(--w3)" }}>
                      {T("Cancel", "Abbrechen", "Annuler")}
                    </button>
                  </div>
                </div>
              )}

              {/* Needs-follow-up banner + one-click reminder */}
              {peek.followUp?.needed && (
                <div style={{ borderRadius: 16, border: "1px solid color-mix(in srgb, #f59e0b 45%, var(--border))", background: "color-mix(in srgb, #f59e0b 10%, transparent)", padding: 16 }}>
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle size={15} style={{ color: "#f59e0b" }} />
                    <span className="text-[13px] font-bold" style={{ color: "var(--w)" }}>{T("Needs follow-up", "Nachfassen nötig", "À relancer")}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {peek.followUp.reasons.map((reason) => (
                      <span key={reason} className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)" }}>
                        {reason === "blocked" ? T("Blocked", "Blockiert", "Bloqué")
                          : reason === "overdue" ? T("Overdue step", "Überfälliger Schritt", "Étape en retard")
                          : T("Rejected document", "Abgelehntes Dokument", "Document rejeté")}
                      </span>
                    ))}
                  </div>
                  <button onClick={() => sendNudge(peek.userId)} disabled={nudging || nudged === peek.userId}
                    className="bv-press inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-3.5 py-2 rounded-lg disabled:opacity-70"
                    style={nudged === peek.userId
                      ? { background: "var(--success-bg)", color: "var(--success)", border: "1px solid var(--success-border)" }
                      : { background: "#f59e0b", color: "#131312" }}>
                    {nudged === peek.userId
                      ? <><CheckCircle2 size={14} strokeWidth={2.2} /> {T("Reminder sent", "Erinnerung gesendet", "Rappel envoyé")}</>
                      : <><Bell size={14} strokeWidth={2.2} /> {nudging ? T("Sending…", "Senden…", "Envoi…") : T("Send reminder", "Erinnerung senden", "Envoyer un rappel")}</>}
                  </button>
                </div>
              )}

              {/* Candidate updates — what they self-reported (passed B2, interview…) */}
              {peek.reports && peek.reports.length > 0 && (
                <div style={card}>
                  <div style={cap}>🗣️ {T("Candidate updates", "Kandidaten-Updates", "Mises à jour du candidat")}</div>
                  <div className="flex flex-col gap-2">
                    {peek.reports.map((rep, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 text-[12.5px]" style={{ color: "var(--w2)" }}>
                        <span className="truncate">{reportLabel(rep)}</span>
                        <span className="flex-shrink-0" style={{ color: "var(--w3)", fontSize: 11 }}>{relativeTimeShort(rep.created_at, lang)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Status — B2 / Anerkennung / Impfung at a glance (one card). */}
              <div style={card}>
                <div style={cap}>{T("Status", "Status", "Statut")}</div>
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center gap-2 text-[12.5px]">
                    <span style={{ width: 9, height: 9, borderRadius: 999, background: b2StageColor(b2s), flexShrink: 0 }} />
                    <span style={{ color: "var(--w3)", fontWeight: 600, width: 64, flexShrink: 0 }}>📜 {T("B2", "B2", "B2")}</span>
                    <select value={b2s} onChange={(e) => void setPeekStage("b2", peek.userId, e.target.value)} className="bv-input" style={{ fontSize: 12.5, fontWeight: 600, padding: "4px 8px", height: "auto", flex: 1, minWidth: 0 }}>
                      {B2_STAGES.map((s) => <option key={s.key} value={s.key}>{b2StageLabel(s.key, lang)}</option>)}
                    </select>
                    {peek.b2Failed && <span style={{ color: B2_FAILED_COLOR, fontWeight: 700, flexShrink: 0 }} title={T("Failed once", "Einmal nicht bestanden", "Échoué une fois")}>↺</span>}
                  </div>
                  <div className="flex items-center gap-2 text-[12.5px]">
                    <span style={{ width: 9, height: 9, borderRadius: 999, background: anerkennungStageColor(anerk), flexShrink: 0 }} />
                    <span style={{ color: "var(--w3)", fontWeight: 600, width: 64, flexShrink: 0 }}>🏅 {T("Anerk.", "Anerk.", "Reconn.")}</span>
                    <select value={anerk} onChange={(e) => void setPeekStage("anerk", peek.userId, e.target.value)} className="bv-input" style={{ fontSize: 12.5, fontWeight: 600, padding: "4px 8px", height: "auto", flex: 1, minWidth: 0 }}>
                      {ANERKENNUNG_STAGES.map((s) => <option key={s.key} value={s.key}>{anerkennungStageLabel(s.key, lang)}</option>)}
                    </select>
                  </div>
                  <div className="flex items-center gap-2 text-[12.5px]">
                    <span style={{ width: 9, height: 9, borderRadius: 999, background: imp === "not_required" || imp === "not_started" ? "var(--w3)" : (impDef?.color ?? "var(--w3)"), flexShrink: 0 }} />
                    <span style={{ color: "var(--w3)", fontWeight: 600, width: 64, flexShrink: 0 }}>💉 {T("Impf.", "Impf.", "Vacc.")}</span>
                    <span className="truncate" style={{ color: "var(--w)", fontWeight: 600 }}>
                      {imp === "not_required" ? T("Not required", "Nicht erforderlich", "Non requis")
                        : imp === "not_started" ? T("Required — not started", "Erforderlich — offen", "Requis — à faire")
                        : impfungStageLabel(imp, lang)}
                      {imp !== "not_required" && peek.impfungDoses && peek.impfungDoses.need > 0 ? ` · ${peek.impfungDoses.got}/${peek.impfungDoses.need}` : ""}
                    </span>
                  </div>
                </div>
              </div>

              {/* Documents — review ANY of her papers (passport, diplomas, …)
                  right here; each opens the same approve/reject/download popup as
                  the CV step. The review modal handles passports safely (LAW #39). */}
              {peekDocs && peekDocs.length > 0 && (
                <div style={card}>
                  <div style={cap}>📄 {T("Documents", "Dokumente", "Documents")}</div>
                  {docList(peekDocs)}
                </div>
              )}

              {/* Passport data — extracted fields + human confirm + approve/reject,
                  reviewed inline (LAW #38/#39 preserved by the review modal). */}
              {peekProfile && ((peekDocs ?? []).some((d) => /pass/i.test(d.file_type)) || !!peekProfile.passport_no || !!peekProfile.passport_status) && (() => {
                const pst = peekProfile.passport_status ?? null;
                const c = pst === "approved" ? "var(--success)" : pst === "rejected" ? "var(--danger)" : pst === "pending" ? "#f59e0b" : "var(--w3)";
                const label = pst === "approved" ? T("Approved", "Genehmigt", "Approuvé") : pst === "rejected" ? T("Rejected", "Abgelehnt", "Refusé") : pst === "pending" ? T("Pending review", "In Prüfung", "En vérification") : T("Not submitted", "Nicht eingereicht", "Non soumis");
                return (
                  <div style={card}>
                    <div style={cap}>🪪 {T("Passport data", "Reisepassdaten", "Données du passeport")}</div>
                    <button onClick={() => setPassportOpen(true)} className="bv-press w-full flex items-center gap-2 text-left px-3 py-2 rounded-lg" style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
                      <span style={{ width: 8, height: 8, borderRadius: 999, background: c, flexShrink: 0 }} />
                      <span className="flex-1 truncate text-[12.5px] font-semibold" style={{ color: "var(--w)" }}>{label}</span>
                      <span className="text-[12px] font-bold flex-shrink-0" style={{ color: "var(--gold)" }}>{T("Review", "Prüfen", "Vérifier")} →</span>
                    </button>
                  </div>
                );
              })()}

              {/* Quick note — reaches her as "Borivon" (never an individual admin). */}
              <div style={card}>
                <div style={cap}>✉️ {T("Send a quick note", "Kurze Nachricht", "Petit message")}</div>
                <textarea value={msgText} onChange={(e) => setMsgText(e.target.value)} rows={2} maxLength={2000}
                  placeholder={T("Write to her — she sees it as Borivon…", "Nachricht — sie sieht „Borivon“…", "Écrivez-lui — elle voit « Borivon »…")}
                  className="bv-input" style={{ fontSize: 12.5, resize: "none", lineHeight: 1.45 }} />
                <button onClick={() => void sendMessage()} disabled={!msgText.trim() || sendingMsg}
                  className="bv-press inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50 mt-2"
                  style={msgSent ? { background: "var(--success-bg)", color: "var(--success)", border: "1px solid var(--success-border)" } : { background: "var(--gold)", color: "#131312" }}>
                  {msgSent ? <><CheckCircle2 size={14} strokeWidth={2.2} /> {T("Sent", "Gesendet", "Envoyé")}</> : (sendingMsg ? T("Sending…", "Senden…", "Envoi…") : T("Send", "Senden", "Envoyer"))}
                </button>
              </div>

                </div>
              )}
            </div>
          );
        })()}
      </Modal>

      {/* Document review — the dashboard's preview + approve/reject/download,
          opened ON TOP of the peek so reviewing a CV never means leaving her. */}
      {docReview && accessToken && (
        <AdminDocPreviewModal
          doc={docReview}
          accessToken={accessToken}
          onClose={() => setDocReview(null)}
          onShowPassportData={peekProfile && /pass/i.test(docReview.file_type) ? () => setPassportOpen(true) : undefined}
          onUpdated={(d) => {
            // Reflect the new status locally + recompute the board/peek so an
            // approved CV instantly advances the guided step to the next question.
            setPeekDocs((ds) => (ds ? ds.map((x) => (x.id === d.id ? { ...x, status: d.status, feedback: d.feedback } : x)) : ds));
            void reload();
          }}
        />
      )}

      {/* Passport-data review — extracted fields + human confirm + approve/reject,
          on top of the peek. LAW #38 (human-only boxes) / #39 (no byte mutation)
          live inside PassportReviewModal. */}
      {passportOpen && peek && peekProfile && accessToken && (
        <PassportReviewModal
          profile={peekProfile}
          userId={peek.userId}
          accessToken={accessToken}
          onClose={() => setPassportOpen(false)}
          onProfileChange={(patch) => setPeekProfile((pp) => (pp ? { ...pp, ...patch } : pp))}
          onReviewed={(status, feedback) => {
            setPeekProfile((pp) => (pp ? { ...pp, passport_status: status, passport_feedback: feedback } : pp));
            void reload();
          }}
        />
      )}

      {/* Employer-ready profile sheet — clean, identity-safe, printable one-pager. */}
      <Modal open={sheetOpen} onClose={() => setSheetOpen(false)} size="md"
        title={T("Employer profile sheet", "Arbeitgeber-Profil", "Fiche profil employeur")}
        footer={peek ? (
          <>
            <GhostButton onClick={() => setSheetOpen(false)}>{T("Close", "Schließen", "Fermer")}</GhostButton>
            <GoldButton onClick={() => window.print()}><Printer size={14} strokeWidth={2.2} /> {T("Print / Save PDF", "Drucken / PDF", "Imprimer / PDF")}</GoldButton>
          </>
        ) : null}>
        {peek && (() => {
          const b2s = normalizeB2Stage(peek.b2Stage);
          const anerk = normalizeAnerkennungStage(peek.anerkennungStage);
          const imp = (peek.impfungStage ?? "not_required") as ImpfungStage;
          const fct = peek.facts;
          const pct = peek.docPack && peek.docPack.total ? Math.round((peek.docPack.collected / peek.docPack.total) * 100) : 0;
          const rowS: CSSProperties = { display: "flex", justifyContent: "space-between", gap: 12, padding: "9px 0", borderBottom: "1px solid var(--border)", fontSize: 13 };
          const k: CSSProperties = { color: "var(--w3)", fontWeight: 600 };
          const val: CSSProperties = { color: "var(--w)", fontWeight: 700, textAlign: "right" };
          return (
            <div data-employer-sheet style={{ padding: 24 }}>
              <style>{`@media print { body * { visibility: hidden !important; } [data-employer-sheet], [data-employer-sheet] * { visibility: visible !important; color: #111 !important; } [data-employer-sheet] { position: fixed !important; inset: 0 !important; margin: 0 !important; padding: 28px !important; background: #fff !important; } }`}</style>
              {/* Brand header — Borivon, never an individual admin (LAW). */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18, paddingBottom: 14, borderBottom: "2px solid var(--gold)" }}>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: "var(--gold)", letterSpacing: -0.5 }}>Borivon</div>
                  <div style={{ fontSize: 11, color: "var(--w3)" }}>{T("Vetted nursing candidate", "Geprüfte Pflegekraft", "Candidat infirmier vérifié")}</div>
                </div>
                {peek.sellable?.sellable && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full" style={{ background: "var(--gold)", color: "#131312" }}>
                    <BadgeCheck size={11} strokeWidth={2.5} /> {T("READY", "BEREIT", "PRÊT")}
                  </span>
                )}
              </div>
              {/* Identity */}
              <div className="flex items-center gap-3.5 mb-4">
                {peek.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={peek.photo} alt="" className="rounded-full object-cover flex-shrink-0" style={{ width: 68, height: 68, border: "2px solid var(--gold)" }} />
                ) : (
                  <span className="rounded-full flex items-center justify-center flex-shrink-0 text-[22px] font-bold" style={{ width: 68, height: 68, background: "var(--gdim)", color: "var(--gold)", border: "2px solid var(--gold)" }}>{initials(peek.name)}</span>
                )}
                <div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "var(--w)" }}>{peek.name}</div>
                  <div style={{ fontSize: 13, color: "var(--gold)", fontWeight: 600 }}>{fct?.specialty ? specialtyLabel(fct.specialty, lang) : T("Nurse", "Pflegekraft", "Infirmier")}</div>
                </div>
              </div>
              {/* Facts */}
              <div>
                <div style={rowS}><span style={k}>{T("Specialty", "Fachbereich", "Spécialité")}</span><span style={val}>{fct?.specialty ? specialtyLabel(fct.specialty, lang) : "—"}</span></div>
                <div style={rowS}><span style={k}>{T("Experience", "Erfahrung", "Expérience")}</span><span style={val}>{fct?.yearsExperience != null ? `${fct.yearsExperience} ${T("years", "Jahre", "ans")}` : "—"}</span></div>
                <div style={rowS}><span style={k}>{T("German level (B2)", "Deutsch (B2)", "Allemand (B2)")}</span><span style={val}>{b2StageLabel(b2s, lang)}</span></div>
                <div style={rowS}><span style={k}>{T("Recognition", "Anerkennung", "Reconnaissance")}</span><span style={val}>{anerkennungStageLabel(anerk, lang)}</span></div>
                <div style={rowS}><span style={k}>{T("Vaccination", "Impfung", "Vaccination")}</span><span style={val}>{imp === "not_required" ? T("Not required", "Nicht erforderlich", "Non requis") : impfungStageLabel(imp, lang)}</span></div>
                <div style={rowS}><span style={k}>{T("Documents ready", "Dokumente bereit", "Documents prêts")}</span><span style={val}>{peek.docPack ? `${peek.docPack.collected}/${peek.docPack.total} (${pct}%)` : "—"}</span></div>
                <div style={{ ...rowS, borderBottom: "none" }}><span style={k}>{T("Available from", "Verfügbar ab", "Disponible dès")}</span><span style={val}>{fct?.availableFrom || "—"}</span></div>
              </div>
              <div style={{ marginTop: 16, fontSize: 10, color: "var(--w3)", textAlign: "center" }}>
                {T("Confidential — shared by Borivon. Contact us to proceed with this candidate.",
                   "Vertraulich — von Borivon bereitgestellt. Kontaktieren Sie uns für diesen Kandidaten.",
                   "Confidentiel — partagé par Borivon. Contactez-nous pour ce candidat.")}
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Smooth, battle-tested toasts (sonner) for save / reminder / move feedback. */}
      <Toaster theme="dark" position="top-center" richColors toastOptions={{ style: { fontSize: "13px" } }} />
    </main>
  );
}
