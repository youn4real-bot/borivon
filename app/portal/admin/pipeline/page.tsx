"use client";

/**
 * Anerkennung / Visa Autopilot — admin Pipeline board ("who's stuck where").
 *
 * Every candidate the admin can see, ordered most-urgent-first and color-coded by
 * health (blocked → overdue → due soon → on track → done). The one design (founder
 * 2026-11-13): a board of four phase columns (Auswahl · Papiere · Ankunft · Im Dienst)
 * or the five B2 stages, paper + tinted cards in the kit palette, columns page and
 * flip instead of scrolling. Click a card → the peek (guided step + status + papers).
 * The old station rail (components/JourneyMap) is kept, hidden (SHOW_RAIL).
 */

import { Wordmark } from "@/components/Wordmark";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import { PageLoader } from "@/components/ui/states";
import { JOURNEY_PRESETS, SEQUENTIAL_PRESETS, JOURNEY_PHASES, resolvePreset, type JourneyPhase } from "@/lib/candidateJourney";
import { JourneyMap } from "@/components/JourneyMap";
import { Modal } from "@/components/ui/Modal";
import { normalizeB2Stage, b2StageLabel, B2_STAGES } from "@/lib/b2Journey";
import { normalizeAnerkennungStage, anerkennungStageLabel, ANERKENNUNG_STAGES } from "@/lib/anerkennungJourney";
import { impfungStageLabel, type ImpfungStage } from "@/lib/impfungJourney";
import { NURSE_SPECIALTIES, specialtyLabel } from "@/lib/nurseSpecialties";
import { translateDocLabel } from "@/lib/fileKeys";
import type { PassportProfile } from "@/lib/passportReview";
import { relativeTimeShort } from "@/lib/relativeTime";
import { Toaster, toast } from "sonner";
import { Search, ArrowRight, Bell, FileText, Printer, Pencil, ChevronLeft, ChevronRight, ChevronDown, Check, Link2, Calendar } from "lucide-react";
import { DndContext, DragOverlay, useDraggable, useDroppable, PointerSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { PageHead, BackLink, KitStyle, Btn, Card, Seg, Dot, Empty, Pager, usePaged, STATUS_DOT, STATUS_TINT, type Status as KitStatus } from "@/components/fx/kit";

// the old 23-station rail (components/JourneyMap) — hidden, not deleted (founder rule); the board below replaces it
const SHOW_RAIL = false as boolean;

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
  /** In Germany (arrived or later) — separate from health "done" = through probation. */
  arrived?: boolean;
  /** Stations counted done; autoKeys = done without a tick (evidence / implied), so no Undo. */
  doneKeys?: string[]; autoKeys?: string[];
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
  interview1Held: boolean; interview2Held: boolean;
  interview1DateConfirmed: boolean; interview2DateConfirmed: boolean;
  interview1ResultDate: string | null; interview2ResultDate: string | null;
  interview1ResultDateConfirmed: boolean; interview2ResultDateConfirmed: boolean;
  interviewLink: string | null; interviewLinkClicks: number; interviewLinkLastClickedAt: string | null;
  visaApptDate: string | null; visaApptDateConfirmed: boolean;
  flightDate: string | null; flightDateConfirmed: boolean; flightInfo: string | null;
  housingDone: boolean; visaGranted: boolean;
  contractDone: boolean; recognitionDone: boolean; vorabDone: boolean; docsReady: boolean; arrivedDone: boolean;
};
type Row = { userId: string; name: string; photo: string | null; status: Status; sellable: Sellable; b2Stage?: string; b2Failed?: boolean; b2ExamDate?: string | null; anerkennungStage?: string; impfungStage?: string; impfungDoses?: { got: number; need: number }; followUp?: FollowUp; openTasks?: OpenTask[]; facts?: Facts; docPack?: DocPack; reports?: SelfReport[]; pipeline?: PipelineFacts; needsUpdate?: boolean; lastActivityAt?: string | null };

const HEALTH_STYLE: Record<Health, { dot: string; label: { en: string; de: string; fr: string } }> = {
  blocked:  { dot: "#ef4444", label: { en: "Blocked",   de: "Blockiert",   fr: "Bloqué" } },
  overdue:  { dot: "#f97316", label: { en: "Overdue",   de: "Überfällig",  fr: "En retard" } },
  due_soon: { dot: "#f59e0b", label: { en: "Due soon",  de: "Bald fällig", fr: "Bientôt dû" } },
  on_track: { dot: "#16a34a", label: { en: "On track",  de: "Im Plan",     fr: "Sur la bonne voie" } },
  done:     { dot: "#6b7280", label: { en: "Complete",  de: "Fertig",      fr: "Terminé" } },
};

// The one status palette (components/fx/kit, LAW #4): red = blocked / overdue, orange = due soon / waiting,
// green = on track / done / passed, grey = not started.
const HEALTH_KIT: Record<Health, KitStatus> = { blocked: "rejected", overdue: "rejected", due_soon: "pending", on_track: "approved", done: "approved" };
const b2Kit = (s: string): KitStatus => (s === "passed" ? "approved" : s === "studying" ? "missing" : "pending");
const anerkKit = (s: string): KitStatus => (s === "recognized" ? "approved" : s === "not_started" ? "missing" : "pending");
const docKit = (s: string | null | undefined): KitStatus => (s === "approved" ? "approved" : s === "rejected" ? "rejected" : s === "pending" ? "pending" : "missing");
type Tr = (en: string, de: string, fr: string) => string;

function presetLabel(key: string | undefined, lang: string): string {
  if (!key) return "—";
  const p = JOURNEY_PRESETS.find((x) => x.key === key);
  if (!p) return key;
  return p.label[(lang as "en" | "fr" | "de")] ?? p.label.en;
}

// ── German dates (TT.MM.JJJJ) ───────────────────────────────────────────────
// All wizard dates display + are typed in German format, never US mm/dd/yyyy.
// Storage stays ISO (yyyy-mm-dd); these convert at the edge.
function isoToDe(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}.${m[2]}.${m[1]}` : "";
}
function deToIso(de: string): string {
  const m = /^\s*(\d{1,2})\.(\d{1,2})\.(\d{4})\s*$/.exec(de ?? "");
  if (!m) return "";
  const d = +m[1], mo = +m[2], y = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return "";
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// A German-format date input with an optional Confirmed/Expected pill. The text
// box reads/writes TT.MM.JJJJ; the calendar button opens the native picker for
// convenience. `confirmed` is the LAW #4-style status (green = real/confirmed,
// orange = still only expected — the default for dates that aren't locked yet).
function GermanDateField({ valueIso, onChangeIso, confirmed, onToggleConfirmed, lang, placeholder }: {
  valueIso: string;
  onChangeIso: (iso: string) => void;
  confirmed?: boolean;
  onToggleConfirmed?: (next: boolean) => void;
  lang: "en" | "fr" | "de";
  placeholder?: string;
}) {
  const tr = (en: string, de: string, fr: string) => (lang === "de" ? de : lang === "fr" ? fr : en);
  const [text, setText] = useState(isoToDe(valueIso));
  useEffect(() => { setText(isoToDe(valueIso)); }, [valueIso]);
  const nativeRef = useRef<HTMLInputElement>(null);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <div style={{ position: "relative", width: 150 }}>
        <input className="bvk-input" inputMode="numeric" placeholder={placeholder ?? "TT.MM.JJJJ"}
          value={text}
          onChange={(e) => { setText(e.target.value); onChangeIso(deToIso(e.target.value)); }}
          style={{ paddingRight: 34, fontVariantNumeric: "tabular-nums" }} />
        <button type="button" aria-label={tr("Pick date", "Datum wählen", "Choisir la date")}
          onClick={() => { const el = nativeRef.current; if (el?.showPicker) el.showPicker(); else el?.focus(); }}
          style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", color: "var(--w3)", padding: 4, lineHeight: 0, background: "none", border: 0, cursor: "pointer" }}>
          <Calendar size={14} strokeWidth={1.9} />
        </button>
        <input ref={nativeRef} type="date" value={valueIso || ""} tabIndex={-1} aria-hidden
          onChange={(e) => { onChangeIso(e.target.value); setText(isoToDe(e.target.value)); }}
          style={{ position: "absolute", right: 4, top: 0, width: 1, height: 1, opacity: 0, pointerEvents: "none" }} />
      </div>
      {/* confirmed = green, still only expected = orange (the kit palette) */}
      {typeof confirmed === "boolean" && onToggleConfirmed && (
        <button type="button" onClick={() => onToggleConfirmed(!confirmed)} aria-pressed={confirmed}
          style={{ ...PILL, background: STATUS_TINT[confirmed ? "approved" : "pending"], border: "1px solid transparent" }}>
          <Dot st={confirmed ? "approved" : "pending"} size={7} />
          {confirmed ? tr("Confirmed", "Bestätigt", "Confirmé") : tr("Expected", "Erwartet", "Prévu")}
        </button>
      )}
    </div>
  );
}

// ── the one design: small shared looks for the board + the peek ───────────────────
/** a quiet pill toggle (Bestätigt / Bestanden …): tinted by its status when on, hairline when off */
const PILL: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 7, height: 34, padding: "0 13px", borderRadius: 999, border: "1px solid var(--border)", background: "var(--card)", color: "var(--w)", fontSize: 13, fontWeight: 500, fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap" };
const pill = (st: KitStatus | null): CSSProperties => (st ? { ...PILL, background: STATUS_TINT[st], border: "1px solid transparent" } : PILL);
/** form-field label (uppercase 11px, the kit's Field look) */
const LBL: CSSProperties = { display: "flex", alignItems: "center", gap: 6, fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--w3)", marginBottom: 5 };
/** one quiet line of help text */
const HINT: CSSProperties = { fontSize: 12.5, lineHeight: 1.45, color: "var(--w3)", margin: 0 };
/** a section title inside the peek (serif) */
const SEC: CSSProperties = { fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 18, lineHeight: 1.2, color: "var(--w)", margin: "0 0 10px" };
/** a tinted row (status = whole row colour, like the papers list) */
const tintRow = (st: KitStatus): CSSProperties => ({ display: "flex", alignItems: "center", gap: 10, width: "100%", minWidth: 0, textAlign: "left", padding: "10px 12px", borderRadius: 12, background: st === "missing" ? "var(--card)" : STATUS_TINT[st], border: st === "missing" ? "1px solid var(--border)" : "1px solid transparent", color: "var(--w)", fontSize: 13.5, fontFamily: "inherit", cursor: "pointer" });
const ROUND = (dis: boolean): CSSProperties => ({ width: 32, height: 32, flex: "none", borderRadius: "50%", border: "1px solid var(--border)", background: "var(--card)", color: dis ? "var(--border)" : "var(--w2)", cursor: dis ? "default" : "pointer", display: "grid", placeItems: "center", padding: 0 });

function initialsOf(n: string): string {
  return n.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "?";
}

/** her face: the photo, or her initials in serif on paper */
function Face({ name, photo, size = 30 }: { name: string; photo: string | null; size?: number }) {
  return photo
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={photo} alt="" className="bvp-face" style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flex: "none" }} />
    : <span aria-hidden="true" className="bvp-face" style={{ width: size, height: size, borderRadius: "50%", flex: "none", display: "grid", placeItems: "center", background: "var(--card)", border: "1px solid var(--border)", fontFamily: "var(--font-serif)", fontSize: Math.round(size * 0.42), color: "var(--w2)", lineHeight: 1 }}>{initialsOf(name)}</span>;
}

function useNarrow() {
  const [n, setN] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(max-width:640px)");
    const f = () => setN(m.matches);
    f(); m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return n;
}

// Board: per column, cards per page (laptop / phone) — nobody scrolls, columns flip.
const PER_LAPTOP = 6, PER_PHONE = 5;

/** which journey column she sits in = the phase of her current (first open) step; all done = Im Dienst */
function phaseOf(r: Row): JourneyPhase {
  const k = r.status.current?.key;
  if (!k) return "work";
  return resolvePreset(k)?.phase ?? "selection";
}

/** what a card says: its status colour, one bold word (only when something is wrong / due), and the step */
function cardLook(r: Row, track: "journey" | "b2", lang: string, T: Tr): { st: KitStatus; word: string; sub: string } {
  if (track === "b2") {
    const s = normalizeB2Stage(r.b2Stage);
    const sub = r.b2ExamDate ? `${T("Exam", "Prüfung", "Examen")} ${isoToDe(r.b2ExamDate)}` : (r.facts?.specialty ? specialtyLabel(r.facts.specialty, lang) : "");
    return { st: b2Kit(s), word: "", sub };
  }
  const h = r.status.health;
  const d = r.status.current?.daysToDue ?? null;
  const word = h === "blocked" ? T("Blocked", "Blockiert", "Bloqué")
    : h === "overdue" ? (d != null && d < 0 ? T(`${-d}d overdue`, `${-d} T. überfällig`, `${-d} j de retard`) : T("Overdue", "Überfällig", "En retard"))
    : h === "due_soon" ? (d != null && d >= 0 ? (d === 0 ? T("due today", "heute fällig", "dû aujourd’hui") : T(`due in ${d}d`, `in ${d} T. fällig`, `dans ${d} j`)) : T("Due soon", "Bald fällig", "Bientôt"))
    : "";
  const sub = h === "done" ? T("Part of the team", "Fest im Team", "Dans l'équipe") : presetLabel(r.status.current?.key, lang);
  return { st: HEALTH_KIT[h], word, sub };
}

function CardBody({ r, track, lang, T }: { r: Row; track: "journey" | "b2"; lang: string; T: Tr }) {
  const { word, sub } = cardLook(r, track, lang, T);
  return (
    <>
      <Face name={r.name} photo={r.photo} />
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 500, color: "var(--w)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</span>
          {/* weekly check-in due (no update in a week): one tiny gold bell */}
          {r.needsUpdate && <Bell size={12} strokeWidth={2.2} aria-label={T("Check in this week", "Diese Woche nachfragen", "À relancer cette semaine")} style={{ color: "var(--gold)", flex: "none" }} />}
          {/* failed B2 once (retaking): a small red dot */}
          {track === "b2" && r.b2Failed && <span title={T("failed before (retaking)", "vorher nicht bestanden", "échoué avant")} style={{ display: "inline-flex", flex: "none" }}><Dot st="rejected" size={7} /></span>}
        </span>
        {(word || sub) && (
          <span style={{ display: "block", fontSize: 12.5, color: "var(--w3)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {word && <b style={{ fontWeight: 600, color: "var(--w)" }}>{word}</b>}{word && sub ? " · " : ""}{sub}
          </span>
        )}
      </span>
    </>
  );
}

const cardStyle = (st: KitStatus): CSSProperties => ({ display: "flex", alignItems: "center", gap: 10, width: "100%", minWidth: 0, minHeight: 56, textAlign: "left", padding: "9px 12px 9px 10px", borderRadius: 12, background: st === "missing" ? "var(--card)" : STATUS_TINT[st], border: st === "missing" ? "1px solid var(--border)" : "1px solid transparent", fontFamily: "inherit", color: "var(--w)", cursor: "pointer" });

/** one candidate card — tap = the peek; on the B2 board (laptop) it can be dragged to another stage */
function BoardCard({ r, track, lang, T, onPick, canDrag }: { r: Row; track: "journey" | "b2"; lang: string; T: Tr; onPick: (uid: string) => void; canDrag: boolean }) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: r.userId, disabled: !canDrag });
  const { st } = cardLook(r, track, lang, T);
  return (
    <button ref={setNodeRef} type="button" className="bvp-card" {...(canDrag ? { ...listeners, ...attributes } : {})} onClick={() => onPick(r.userId)} title={r.name}
      style={{ ...cardStyle(st), opacity: isDragging ? 0.35 : 1, cursor: canDrag ? (isDragging ? "grabbing" : "grab") : "pointer", touchAction: canDrag ? "none" : undefined }}>
      <CardBody r={r} track={track} lang={lang} T={T} />
    </button>
  );
}

type BoardCol = { key: string; title: string; dot?: KitStatus; items: Row[] };

/** one column: serif title + count over a hairline, the cards, ‹ 1 / 2 › when it is long. Phone: ‹ title › flips columns. */
function BoardColumn({ col, track, lang, T, onPick, canDrag, flip }: {
  col: BoardCol; track: "journey" | "b2"; lang: string; T: Tr; onPick: (uid: string) => void; canDrag: boolean;
  flip?: { prev: () => void; next: () => void; first: boolean; last: boolean };
}) {
  const { slice, page, pages, setPage } = usePaged(col.items, PER_LAPTOP, PER_PHONE);
  const { setNodeRef, isOver } = useDroppable({ id: col.key, disabled: !canDrag });
  const b2 = track === "b2";
  return (
    <section ref={setNodeRef} style={{ minWidth: 0, borderRadius: 14, outline: `1.5px dashed ${isOver ? "var(--w3)" : "transparent"}`, outlineOffset: 5, transition: "outline-color .15s" }}>
      <header style={{ display: "flex", alignItems: flip ? "center" : "flex-start", gap: 8, paddingBottom: 10, marginBottom: 10, borderBottom: "1px solid var(--border)", minHeight: b2 && !flip ? 54 : undefined }}>
        {flip && <button type="button" aria-label="‹" disabled={flip.first} onClick={flip.prev} style={ROUND(flip.first)}><ChevronLeft size={16} /></button>}
        <span title={col.title} style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "baseline", justifyContent: flip ? "center" : "flex-start", gap: 8 }}>
          {col.dot && <span style={{ display: "inline-flex", alignSelf: "center", flex: "none" }}><Dot st={col.dot} size={8} /></span>}
          <span style={{ fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: b2 ? 17 : 20, lineHeight: 1.2, color: "var(--w)", minWidth: 0, ...(flip ? { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } : {}) }}>{col.title}</span>
          <span style={{ fontSize: 12.5, color: "var(--w3)", fontVariantNumeric: "tabular-nums", flex: "none", marginLeft: flip ? 0 : "auto" }}>{col.items.length}</span>
        </span>
        {flip && <button type="button" aria-label="›" disabled={flip.last} onClick={flip.next} style={ROUND(flip.last)}><ChevronRight size={16} /></button>}
      </header>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, minHeight: canDrag ? 120 : undefined }}>
        {slice.map((r) => <BoardCard key={r.userId} r={r} track={track} lang={lang} T={T} onPick={onPick} canDrag={canDrag} />)}
        {col.items.length === 0 && <span style={{ fontSize: 13, color: "var(--w3)", padding: "6px 4px" }}>—</span>}
      </div>
      <Pager page={page} pages={pages} onPage={setPage} />
    </section>
  );
}

/** the board — Reise: four phase columns; B2: the five stages (drag a card to another stage on a laptop) */
function PipelineBoard({ rows, track, lang, T, onPick, onMoveStage }: { rows: Row[]; track: "journey" | "b2"; lang: string; T: Tr; onPick: (uid: string) => void; onMoveStage: (uid: string, stage: string) => void }) {
  const narrow = useNarrow();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [dragId, setDragId] = useState<string | null>(null);
  const L = lang as "en" | "fr" | "de";
  const cols: BoardCol[] = useMemo(() => (track === "b2"
    ? B2_STAGES.map((s) => ({ key: s.key, title: b2StageLabel(s.key, lang), dot: b2Kit(s.key), items: rows.filter((r) => normalizeB2Stage(r.b2Stage) === s.key) }))
    : JOURNEY_PHASES.map((p) => ({ key: p.key, title: p.label[L] ?? p.label.en, items: rows.filter((r) => phaseOf(r) === p.key) }))), [rows, track, lang, L]);
  const [col, setCol] = useState<number | null>(null);
  const firstFull = Math.max(0, cols.findIndex((c) => c.items.length > 0));
  const ci = Math.min(col ?? firstFull, cols.length - 1);
  const canDrag = track === "b2" && !narrow;
  // Drop a card on another B2 stage → move her there (no-op on the same stage).
  const onDragEnd = (e: DragEndEvent) => {
    setDragId(null);
    const overId = e.over?.id;
    if (!overId) return;
    const uid = String(e.active.id);
    const row = rows.find((x) => x.userId === uid);
    if (!row) return;
    if (normalizeB2Stage(row.b2Stage) === String(overId)) return;
    onMoveStage(uid, String(overId));
  };
  const dragRow = dragId ? rows.find((x) => x.userId === dragId) : undefined;
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter}
      onDragStart={(e) => setDragId(String(e.active.id))} onDragEnd={onDragEnd} onDragCancel={() => setDragId(null)}>
      {narrow ? (
        <BoardColumn key={cols[ci].key} col={cols[ci]} track={track} lang={lang} T={T} onPick={onPick} canDrag={false}
          flip={{ prev: () => setCol(Math.max(0, ci - 1)), next: () => setCol(Math.min(cols.length - 1, ci + 1)), first: ci === 0, last: ci === cols.length - 1 }} />
      ) : (
        <div className="bvp-board" style={{ display: "grid", gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))`, gap: track === "b2" ? 14 : 20, alignItems: "start" }}>
          {cols.map((c) => <BoardColumn key={c.key} col={c} track={track} lang={lang} T={T} onPick={onPick} canDrag={canDrag} />)}
        </div>
      )}
      <DragOverlay dropAnimation={null}>
        {dragRow ? (
          <div style={{ ...cardStyle(cardLook(dragRow, track, lang, T).st), boxShadow: "0 18px 40px -18px rgba(21,19,15,.35)", transform: "rotate(-2deg)", cursor: "grabbing", background: "var(--card)" }}>
            <CardBody r={dragRow} track={track} lang={lang} T={T} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/** "Mehr" in the peek = the second face: one section at a time (Status · Papiere · Profil · Nachricht), so the popup never scrolls */
function PeekMore({ T, onBack, tabs }: { T: Tr; onBack: () => void; tabs: [string, string, ReactNode][] }) {
  const [tab, setTab] = useState(tabs[0][0]);
  const cur = tabs.find(([k]) => k === tab) ?? tabs[0];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px 14px", flexWrap: "wrap" }}>
        <BackLink label={T("Back to the step", "Zurück zum Schritt", "Retour à l’étape")} onClick={onBack} />
        <Seg<string> value={cur[0]} onChange={setTab} options={tabs.map(([k, l]) => [k, l] as [string, ReactNode])} />
      </div>
      {cur[2]}
    </div>
  );
}

/** her papers in the peek — tinted rows (green done · orange waiting · red redo), ‹ › when long; tap = review */
function PeekDocList({ docs, lang, onOpen }: { docs: PeekDoc[]; lang: string; onOpen: (d: PeekDoc) => void }) {
  const { slice, page, pages, setPage } = usePaged(docs, 6, 5);
  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {slice.map((d) => (
          <button key={d.id} type="button" onClick={() => onOpen(d)} style={tintRow(docKit(d.status))}>
            <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{translateDocLabel(d.file_type, lang as "en" | "fr" | "de")}</span>
            <FileText size={13} style={{ color: "var(--w3)", flex: "none" }} />
          </button>
        ))}
      </div>
      <Pager page={page} pages={pages} onPage={setPage} />
    </div>
  );
}

export default function AdminPipelinePage() {
  const router = useRouter();
  const { lang } = useLang();
  const T = (en: string, de: string, fr: string) => (lang === "de" ? de : lang === "fr" ? fr : en);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [today, setToday] = useState("");
  const [q, setQ] = useState("");
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
  const [pipeDraft, setPipeDraft] = useState({
    interview1: "", interview2: "", interview1Date: "", interview2Date: "",
    interview1Held: false, interview2Held: false,
    interview1DateConfirmed: false, interview2DateConfirmed: false,
    interview1ResultDate: "", interview2ResultDate: "",
    interview1ResultDateConfirmed: false, interview2ResultDateConfirmed: false,
    interviewLink: "",
    visaApptDate: "", visaApptDateConfirmed: false,
    flightDate: "", flightDateConfirmed: false, flightInfo: "", housingDone: false,
  });

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
      interview1Held: peek.pipeline?.interview1Held ?? false,
      interview2Held: peek.pipeline?.interview2Held ?? false,
      interview1DateConfirmed: peek.pipeline?.interview1DateConfirmed ?? false,
      interview2DateConfirmed: peek.pipeline?.interview2DateConfirmed ?? false,
      interview1ResultDate: peek.pipeline?.interview1ResultDate ?? "",
      interview2ResultDate: peek.pipeline?.interview2ResultDate ?? "",
      interview1ResultDateConfirmed: peek.pipeline?.interview1ResultDateConfirmed ?? false,
      interview2ResultDateConfirmed: peek.pipeline?.interview2ResultDateConfirmed ?? false,
      interviewLink: peek.pipeline?.interviewLink ?? "",
      visaApptDate: peek.pipeline?.visaApptDate ?? "",
      visaApptDateConfirmed: peek.pipeline?.visaApptDateConfirmed ?? false,
      flightDate: peek.pipeline?.flightDate ?? "",
      flightDateConfirmed: peek.pipeline?.flightDateConfirmed ?? false,
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

  // B2 exam date — "when". Empty iso clears it. Saved straight to candidate_profiles.
  const setB2ExamDate = async (userId: string, iso: string) => {
    setRows((rs) => rs.map((r) => (r.userId === userId ? { ...r, b2ExamDate: iso || null } : r)));
    setPeek((p) => (p && p.userId === userId ? { ...p, b2ExamDate: iso || null } : p));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? accessToken;
      const res = await fetch("/api/portal/journey/b2", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ candidateId: userId, examDate: iso }) });
      if (res.ok) toast.success(T("Saved ✓", "Gespeichert ✓", "Enregistré ✓"));
      else { toast.error(T("Couldn't save", "Speichern fehlgeschlagen", "Échec")); void reload(); }
    } catch { toast.error(T("Couldn't save", "Speichern fehlgeschlagen", "Échec")); void reload(); }
  };
  // B2 "failed once" flag (red halo) — toggled by the admin.
  const setB2Failed = async (userId: string, failed: boolean) => {
    setRows((rs) => rs.map((r) => (r.userId === userId ? { ...r, b2Failed: failed } : r)));
    setPeek((p) => (p && p.userId === userId ? { ...p, b2Failed: failed } : p));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? accessToken;
      const res = await fetch("/api/portal/journey/b2", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ candidateId: userId, failed }) });
      if (res.ok) toast.success(T("Updated ✓", "Aktualisiert ✓", "Mis à jour ✓"));
      else { toast.error(T("Couldn't update", "Update fehlgeschlagen", "Échec")); void reload(); }
    } catch { toast.error(T("Couldn't update", "Update fehlgeschlagen", "Échec")); void reload(); }
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

  // Tick/untick a journey STATION that has no candidate_pipeline field (the
  // full-journey stations). Goes through the journey API, which seeds any
  // missing preset row and enforces who may tick what, then reloads the board
  // so the open peek advances exactly like saveStep does.
  const saveJourneyStep = async (key: string, done: boolean) => {
    if (!peek) return;
    const id = peek.userId;
    setSavingStep(true);
    const fail = () => toast.error(T("Couldn't save", "Speichern fehlgeschlagen", "Échec de l'enregistrement"));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const h = { Authorization: `Bearer ${session?.access_token ?? ""}` };
      const list = await fetch(`/api/portal/journey?candidateId=${encodeURIComponent(id)}`, { headers: h });
      const j = list.ok ? await list.json() : null;
      const row = ((j?.items ?? []) as { id: string; preset_key: string | null }[]).find((it) => it.preset_key === key);
      if (!row) { fail(); setSavingStep(false); return; }
      const res = await fetch("/api/portal/journey", { method: "PATCH", headers: { ...h, "Content-Type": "application/json" }, body: JSON.stringify({ candidateId: id, id: row.id, done }) });
      if (res.ok) { toast.success(T("Saved ✓", "Gespeichert ✓", "Enregistré ✓")); await reload(); }
      else fail();
    } catch { fail(); }
    setSavingStep(false);
  };

  if (loading) return <PageLoader />;

  const boardRows = track !== "journey" ? searchOnlyRows : shown;
  const L3 = lang as "en" | "fr" | "de";
  const healthCount = (h: Health) => rows.filter((r) => r.status.health === h).length;
  const failedCount = rows.filter((r) => r.b2Failed).length;
  const count =(st: KitStatus, n: number, label: string, cls?: string) => (
    <span key={label} className={cls} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, color: "var(--w3)", whiteSpace: "nowrap" }}>
      <Dot st={st} /><b style={{ fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 21, lineHeight: 1, color: "var(--w)" }}>{n}</b>{label}
    </span>
  );

  return (
    <main id="bv-main" className="mx-auto px-4 sm:px-5 bv-page-bottom" style={{ maxWidth: 1180, paddingTop: 72, paddingBottom: 28 }}>
      <KitStyle />
      {/* page-only looks: the controls row stacks on a phone, faces leave narrow board columns */}
      <style>{".bvp-ctl{display:flex;align-items:center;gap:12px 20px;flex-wrap:wrap;margin-bottom:18px}.bvp-search{position:relative;flex:0 1 300px;min-width:220px;margin-left:auto}"
        + "@media (max-width:640px){.bvp-search{order:-1;flex:1 1 100%;margin-left:0}.bvp-ctl{gap:10px 14px;margin-bottom:14px}.bvp-lbl{display:none!important}.bvp-card{padding-top:7px!important;padding-bottom:7px!important}}"
        + "@media (min-width:641px) and (max-width:1023px){.bvp-board .bvp-face{display:none!important}}"}</style>
      <PageHead back={{ label: T("Back", "Zurück", "Retour"), onClick: () => router.push("/portal/admin") }}
        title={T("Pipeline", "Pipeline", "Pipeline")}
        sub={T(`${rows.length} candidates — tap one to open`, `${rows.length} Pflegekräfte — antippen zum Öffnen`, `${rows.length} candidats — touchez pour ouvrir`)}
        actions={<Seg<"journey" | "b2"> value={track} onChange={setTrack} options={[["journey", T("Journey", "Reise", "Parcours")], ["b2", T("B2 German", "B2 Deutsch", "B2 allemand")]]} />} />

      {/* where everyone stands (quiet coloured numbers) + search */}
      <div className="bvp-ctl">
        {track === "journey" ? (
          <>
            {count("rejected", healthCount("blocked"), HEALTH_STYLE.blocked.label[L3])}
            {count("rejected", healthCount("overdue"), HEALTH_STYLE.overdue.label[L3])}
            {count("pending", healthCount("due_soon"), HEALTH_STYLE.due_soon.label[L3])}
            {/* "on track" is the calm default — on a phone the three that need you are enough (one line) */}
            {count("approved", healthCount("on_track"), HEALTH_STYLE.on_track.label[L3], "bvp-lbl")}
          </>
        ) : (
          <>
            {count("rejected", failedCount, T("failed before (retaking)", "vorher nicht bestanden", "échoué avant"))}
            <span className="bvp-lbl" style={{ fontSize: 12.5, color: "var(--w3)" }}>{T("Drag a card to change the stage.", "Karte ziehen = Stufe ändern.", "Glissez une carte pour changer d’étape.")}</span>
          </>
        )}
        <div className="bvp-search">
          <Search size={14} style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: "var(--w3)", pointerEvents: "none" }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} className="bvk-input" style={{ paddingLeft: 36 }}
            placeholder={T("Search candidate…", "Kandidat suchen…", "Rechercher…")} />
        </div>
      </div>

      {/* The board is the single view — new features live on it (user directive). */}
      {boardRows.length === 0 ? (
        <Card><Empty>{q.trim() ? T("No match.", "Kein Treffer.", "Aucun résultat.") : T("No candidates yet.", "Noch keine Kandidaten.", "Aucun candidat.")}</Empty></Card>
      ) : (
        <PipelineBoard key={track} rows={boardRows} track={track} lang={lang} T={T}
          onPick={(uid) => setPeek(rows.find((r) => r.userId === uid) ?? null)}
          onMoveStage={moveStage} />
      )}
      {SHOW_RAIL && (
        <JourneyMap rows={track !== "journey" ? searchOnlyRows : shown} lang={lang} track={track}
          onPick={(uid) => setPeek(rows.find((r) => r.userId === uid) ?? null)}
          onMoveStage={moveStage} />
      )}
      {/* Candidate peek — quick cross-track summary; the dossier is one click away. */}
      <Modal
        open={!!peek}
        onClose={() => setPeek(null)}
        size="md"
        title={peek ? (
          // her face + name (the popup's own serif title), and where she stands in quiet words (status = the kit dot) —
          // in the head, so the body never scrolls
          <span style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <Face name={peek.name} photo={peek.photo} size={40} />
            <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{peek.name}</span>
              <span style={{ display: "flex", flexWrap: "wrap", gap: "2px 14px", marginTop: 3, fontFamily: "var(--font-sans)", fontSize: 12.5, fontWeight: 400, lineHeight: 1.4, letterSpacing: 0, color: "var(--w2)" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                  <Dot st={HEALTH_KIT[peek.status.health]} size={8} />{HEALTH_STYLE[peek.status.health].label[L3]}<span style={{ color: "var(--w3)" }}>· {Math.round(peek.status.progress * 100)}%</span>
                </span>
                {peek.sellable?.sellable && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 600, color: "var(--w)" }}><Dot st="approved" size={7} />{T("Ready to sell", "Verkaufsbereit", "Prêt à vendre")}</span>
                )}
                {(peek.pipeline?.interview1 === "failed" || peek.pipeline?.interview2 === "failed") && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 600, color: "var(--w)" }}><Dot st="rejected" size={7} />{T("Interview not passed", "Interview nicht bestanden", "Entretien non réussi")}</span>
                )}
              </span>
            </span>
          </span>
        ) : ""}
        footer={peek ? (
          <>
            <Btn kind="quiet" size="sm" onClick={() => setPeek(null)}>{T("Close", "Schließen", "Fermer")}</Btn>
            <Btn kind="ghost" size="sm" onClick={() => setSheetOpen(true)} aria-label={T("Employer sheet", "Arbeitgeber-Blatt", "Fiche employeur")}>
              <FileText size={14} /> <span className="bvp-lbl">{T("Employer sheet", "Arbeitgeber-Blatt", "Fiche employeur")}</span>
            </Btn>
            <Btn kind="ghost" size="sm" onClick={() => { const id = peek.userId; setPeek(null); router.push(`/portal/admin?nav_user_id=${encodeURIComponent(id)}`); }}>
              {T("Open full profile", "Profil öffnen", "Profil complet")} <ArrowRight size={14} strokeWidth={2.2} />
            </Btn>
          </>
        ) : null}>
        {peek && (() => {
          const b2s = normalizeB2Stage(peek.b2Stage);
          const anerk = normalizeAnerkennungStage(peek.anerkennungStage);
          const imp = (peek.impfungStage ?? "not_required") as ImpfungStage;
          const impKit: KitStatus = imp === "not_required" || imp === "not_started" ? "missing" : imp === "accepted" ? "approved" : "pending";
          const pct = Math.round(peek.status.progress * 100);
          const hk = HEALTH_KIT[peek.status.health];
          // a hairline box on the paper popup (no fills, no shadows)
          const card: CSSProperties = { borderRadius: 16, border: "1px solid var(--border)", padding: 16 };
          const lbl: CSSProperties = LBL;
          const reportLabel = (rep: SelfReport) => {
            if (rep.kind === "b2") return rep.outcome === "passed" ? T("Passed B2", "B2 bestanden", "B2 réussi") : T("Didn't pass B2 — retaking", "B2 nicht bestanden", "B2 non réussi");
            if (rep.kind === "interview") return rep.outcome === "passed" ? T("Passed an interview", "Gespräch bestanden", "Entretien réussi")
              : rep.outcome === "scheduled" ? T("Interview scheduled", "Gespräch geplant", "Entretien planifié")
              : T("Interview didn't pass", "Gespräch nicht bestanden", "Entretien non réussi");
            return rep.note || T("Update", "Update", "Mise à jour");
          };
          const reportKit = (rep: SelfReport): KitStatus => (rep.outcome === "passed" ? "approved" : rep.outcome === "scheduled" ? "pending" : rep.kind === "b2" || rep.kind === "interview" ? "rejected" : "missing");
          const passFail = (value: string, onChange: (v: string) => void) => (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {([["passed", T("Passed", "Bestanden", "Réussi"), "approved"], ["failed", T("Didn't pass", "Nicht bestanden", "Échoué"), "rejected"]] as const).map(([v, label, kst]) => {
                const active = value === v;
                return <button key={v} type="button" aria-pressed={active} onClick={() => onChange(active ? "pending" : v)} style={pill(active ? kst : null)}>{active && <Dot st={kst} size={7} />}{label}</button>;
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
              case "interview_first": return T("First interview", "Erstes Interview", "Premier entretien");
              case "interview_second": return T("Second interview", "Zweites Interview", "Deuxième entretien");
              case "contract_signed": return T("Contract sealed?", "Vertrag abgeschlossen?", "Contrat conclu ?");
              case "recognition_submitted": return T("Recognition approved?", "Anerkennung genehmigt?", "Reconnaissance approuvée ?");
              case "vorabzustimmung": return T("Vorabzustimmung issued?", "Vorabzustimmung erteilt?", "Vorabzustimmung délivrée ?");
              case "docs_collected": return T("All documents ready for the embassy?", "Alle Unterlagen für die Botschaft bereit?", "Tous les documents prêts pour l'ambassade ?");
              case "visa_appointment": return T("When is the visa appointment?", "Wann ist der Visumtermin?", "Quand est le rendez-vous visa ?");
              case "visa_approved": return T("Visa approved?", "Visum genehmigt?", "Visa approuvé ?");
              case "flight_booked": return T("When is the flight?", "Wann ist der Flug?", "Quand est le vol ?");
              case "housing_arranged": return T("Housing arranged?", "Unterkunft organisiert?", "Logement organisé ?");
              case "arrived": return T(`Has ${firstName} arrived in Germany?`, `Ist ${firstName} in Deutschland angekommen?`, `${firstName} est arrivé en Allemagne ?`);
              default: return `${presetLabel(k, lang)}?`;
            }
          };
          // Save the WHOLE interview lifecycle for round n: Termin (+confirmed),
          // whether it was held, and — only once held — the result (+ result date,
          // +confirmed). Result stays "pending" until she's actually done it, so
          // "passed/failed" can never be logged before the interview happened.
          const saveInterviewFull = (n: 1 | 2) => {
            const d = pipeDraft;
            if (n === 1) {
              const held = d.interview1Held;
              const result = held && (d.interview1 === "passed" || d.interview1 === "failed") ? d.interview1 : "pending";
              void saveStep(
                { interview1_held: held, interview1_date: d.interview1Date || "", interview1_date_confirmed: d.interview1DateConfirmed, interview1_status: result, interview1_result_date: held ? (d.interview1ResultDate || "") : "", interview1_result_date_confirmed: d.interview1ResultDateConfirmed },
                { interview1Held: held, interview1Date: d.interview1Date || null, interview1DateConfirmed: d.interview1DateConfirmed, interview1: result, interview1ResultDate: held ? (d.interview1ResultDate || null) : null, interview1ResultDateConfirmed: d.interview1ResultDateConfirmed },
              );
            } else {
              const held = d.interview2Held;
              const result = held && (d.interview2 === "passed" || d.interview2 === "failed") ? d.interview2 : "pending";
              void saveStep(
                { interview2_held: held, interview2_date: d.interview2Date || "", interview2_date_confirmed: d.interview2DateConfirmed, interview2_status: result, interview2_result_date: held ? (d.interview2ResultDate || "") : "", interview2_result_date_confirmed: d.interview2ResultDateConfirmed },
                { interview2Held: held, interview2Date: d.interview2Date || null, interview2DateConfirmed: d.interview2DateConfirmed, interview2: result, interview2ResultDate: held ? (d.interview2ResultDate || null) : null, interview2ResultDateConfirmed: d.interview2ResultDateConfirmed },
              );
            }
          };
          // "Erledigt" = a green tinted word; the answer itself = the one black pill of the popup
          const doneMark = (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 40, padding: "0 16px", borderRadius: 999, background: STATUS_TINT.approved, fontSize: 14, fontWeight: 600, color: "var(--w)" }}>
              <Dot st="approved" /> {T("Done", "Erledigt", "Fait")}
            </span>
          );
          const confirmControls = (done: boolean, on: Record<string, unknown>, onOpt: Partial<PipelineFacts>, off: Record<string, unknown>, offOpt: Partial<PipelineFacts>, yes?: string) => (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {!done ? (
                <Btn kind="primary" onClick={() => void saveStep(on, onOpt)} disabled={savingStep}>
                  <Check size={15} strokeWidth={2.4} /> {yes ?? T("Yes, done", "Ja, erledigt", "Oui, fait")}
                </Btn>
              ) : (
                <>
                  {doneMark}
                  <Btn kind="quiet" size="sm" onClick={() => void saveStep(off, offOpt)} disabled={savingStep}>{T("Undo", "Rückgängig", "Annuler")}</Btn>
                </>
              )}
            </div>
          );
          // Same look as confirmControls, but for stations stored on the journey row.
          // Done-without-a-tick (evidence / implied by later progress) has no Undo:
          // there is nothing ticked to take back.
          const journeyControls = (k: string) => {
            const done = !!peek.status.doneKeys?.includes(k);
            const auto = !!peek.status.autoKeys?.includes(k);
            return (
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {!done ? (
                  <Btn kind="primary" onClick={() => void saveJourneyStep(k, true)} disabled={savingStep}>
                    <Check size={15} strokeWidth={2.4} /> {T("Yes, done", "Ja, erledigt", "Oui, fait")}
                  </Btn>
                ) : (
                  <>
                    {doneMark}
                    {!auto && <Btn kind="quiet" size="sm" onClick={() => void saveJourneyStep(k, false)} disabled={savingStep}>{T("Undo", "Rückgängig", "Annuler")}</Btn>}
                  </>
                )}
              </div>
            );
          };
          const saveAndNext = (onSave: () => void, disabled: boolean) => (
            <Btn kind="primary" onClick={onSave} disabled={savingStep || disabled} style={{ alignSelf: "flex-start", marginTop: 4 }}>
              {savingStep ? T("Saving…", "Speichern…", "Enregistrement…") : <>{T("Save & next", "Speichern & weiter", "Enregistrer & suivant")} <ArrowRight size={14} strokeWidth={2.2} /></>}
            </Btn>
          );
          // Compact, tappable list of the candidate's documents — each opens the
          // review popup (approve / reject / download). Used on the docs step AND
          // in "More" so any paper (passport included) is reviewable without
          // leaving her. The review modal handles passports safely (LAW #39).
          // Tinted rows (green done · orange waiting · red redo), ‹ › instead of scrolling.
          const docList = (docs: PeekDoc[]) => <PeekDocList docs={docs} lang={lang} onOpen={(d) => setDocReview(d)} />;
          return (
            <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Two faces, nothing scrolls: the guided step (default) — or "Mehr", one section at a time. */}
              {!moreOpen ? (<>
              {/* Identity (face · status · Verkaufsbereit · Interview nicht bestanden) sits in the popup head above. */}

              {/* THE one thing — a single guided question for exactly where they are. */}
              {showDone ? (
                <div style={{ textAlign: "center", padding: "20px 16px", borderRadius: 16, background: STATUS_TINT.approved }}>
                  <div style={{ fontFamily: "var(--font-serif)", fontSize: 22, lineHeight: 1.2, color: "var(--w)" }}>{T("Probation passed, part of the team", "Probezeit bestanden, fest im Team", "Période d'essai réussie, dans l'équipe")}</div>
                  <div style={{ fontSize: 12.5, marginTop: 4, color: "var(--w3)" }}>{T("Every milestone complete.", "Alle Etappen abgeschlossen.", "Toutes les étapes terminées.")}</div>
                </div>
              ) : (
                <div style={{ ...card, padding: "14px 16px 16px" }}>
                  <div style={{ fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 22, lineHeight: 1.2, letterSpacing: "-.01em", color: "var(--w)", marginBottom: 10 }}>{stepQuestion(stepKey)}</div>
                  {(() => {
                    switch (stepKey) {
                      case "cv_finalized":
                        return (
                          <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
                            {peekDocs === null ? (
                              <p style={HINT}>{T("Loading their documents…", "Dokumente werden geladen…", "Chargement des documents…")}</p>
                            ) : cvDoc ? (
                              <>
                                <p style={{ ...HINT, color: "var(--w2)" }}>
                                  {cvDoc.status === "rejected"
                                    ? T("Their German CV was rejected — open it to review again.", "Lebenslauf wurde abgelehnt — erneut prüfen.", "Leur CV a été refusé — rouvrez-le pour revoir.")
                                    : T("Their German CV is in — review it and approve or reject, right here.", "Lebenslauf liegt vor — hier prüfen und genehmigen oder ablehnen.", "Leur CV est là — vérifiez et approuvez ou refusez, ici même.")}
                                </p>
                                <Btn kind="primary" onClick={() => setDocReview(cvDoc)}>
                                  <FileText size={14} /> {T("Review CV — approve / reject", "Lebenslauf prüfen", "Vérifier le CV")}
                                </Btn>
                              </>
                            ) : (
                              <>
                                <p style={{ ...HINT, color: "var(--w2)" }}>{T("No German CV uploaded yet — build or upload one in their profile.", "Noch kein Lebenslauf — im Profil erstellen oder hochladen.", "Aucun CV allemand encore — créez-en un dans leur profil.")}</p>
                                <Btn kind="ghost" size="sm" onClick={() => { const id = peek.userId; setPeek(null); router.push(`/portal/admin?nav_user_id=${encodeURIComponent(id)}`); }}>
                                  {T("Open full profile", "Profil öffnen", "Profil complet")} <ArrowRight size={14} strokeWidth={2.2} />
                                </Btn>
                              </>
                            )}
                          </div>
                        );
                      case "interview_first":
                      case "interview_second": {
                        const n: 1 | 2 = stepKey === "interview_first" ? 1 : 2;
                        const held      = n === 1 ? pipeDraft.interview1Held : pipeDraft.interview2Held;
                        const statusVal = n === 1 ? pipeDraft.interview1 : pipeDraft.interview2;
                        const apptIso   = n === 1 ? pipeDraft.interview1Date : pipeDraft.interview2Date;
                        const apptConf  = n === 1 ? pipeDraft.interview1DateConfirmed : pipeDraft.interview2DateConfirmed;
                        const resIso    = n === 1 ? pipeDraft.interview1ResultDate : pipeDraft.interview2ResultDate;
                        const resConf   = n === 1 ? pipeDraft.interview1ResultDateConfirmed : pipeDraft.interview2ResultDateConfirmed;
                        const linkChanged = pipeDraft.interviewLink.trim() !== (pf?.interviewLink ?? "");
                        const clicks = pf?.interviewLinkClicks ?? 0;
                        const setHeld     = (v: boolean) => setPipeDraft((d) => (n === 1 ? { ...d, interview1Held: v } : { ...d, interview2Held: v }));
                        const setStatus   = (v: string)  => setPipeDraft((d) => (n === 1 ? { ...d, interview1: v } : { ...d, interview2: v }));
                        const setApptIso  = (iso: string)=> setPipeDraft((d) => (n === 1 ? { ...d, interview1Date: iso } : { ...d, interview2Date: iso }));
                        const setApptConf = (c: boolean) => setPipeDraft((d) => (n === 1 ? { ...d, interview1DateConfirmed: c } : { ...d, interview2DateConfirmed: c }));
                        const setResIso   = (iso: string)=> setPipeDraft((d) => (n === 1 ? { ...d, interview1ResultDate: iso } : { ...d, interview2ResultDate: iso }));
                        const setResConf  = (c: boolean) => setPipeDraft((d) => (n === 1 ? { ...d, interview1ResultDateConfirmed: c } : { ...d, interview2ResultDateConfirmed: c }));
                        const stageLbl: CSSProperties = LBL;
                        return (
                          <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                            {/* Portal-gated interview link — the candidate can ONLY reach the
                                Teams/Zoom room through their own dashboard, so an "open" here is
                                the closest honest "they showed up" signal we can capture. */}
                            <div>
                              {/* one line: the link (its name sits in the field), whether she opened it, save when changed */}
                              <div style={{ display: "flex", alignItems: "center", gap: "6px 10px", flexWrap: "wrap" }}>
                                <span style={{ position: "relative", flex: "1 1 220px", minWidth: 0 }}>
                                  <Link2 size={14} strokeWidth={2} aria-hidden="true" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--w3)", pointerEvents: "none" }} />
                                  <input className="bvk-input" type="url" inputMode="url" value={pipeDraft.interviewLink}
                                    onChange={(e) => setPipeDraft((d) => ({ ...d, interviewLink: e.target.value }))}
                                    aria-label={T("Interview link (Teams / Zoom)", "Interview-Link (Teams / Zoom)", "Lien de l'entretien (Teams / Zoom)")}
                                    placeholder={T("Interview link (Teams / Zoom) — https://…", "Interview-Link (Teams / Zoom) — https://…", "Lien de l'entretien (Teams / Zoom) — https://…")} style={{ paddingLeft: 34 }} />
                                </span>
                                {pf?.interviewLink ? (
                                  clicks > 0 ? (
                                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--w)", whiteSpace: "nowrap" }}>
                                      <Dot st="approved" size={7} />
                                      {T(`Opened ${clicks}×`, `${clicks}× geöffnet`, `Ouvert ${clicks}×`)}
                                      {pf.interviewLinkLastClickedAt ? <span style={{ color: "var(--w3)" }}>{` · ${T("last", "zuletzt", "dernier")} ${relativeTimeShort(pf.interviewLinkLastClickedAt, lang)}`}</span> : null}
                                    </span>
                                  ) : (
                                    <span title={T("Not opened yet — they reach it only from their dashboard.", "Noch nicht geöffnet — erreichbar nur über ihr Dashboard.", "Pas encore ouvert — accessible uniquement depuis leur tableau de bord.")}
                                      style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--w3)", whiteSpace: "nowrap" }}>
                                      <Dot st="missing" size={7} />{T("Not opened yet", "Noch nicht geöffnet", "Pas encore ouvert")}
                                    </span>
                                  )
                                ) : null}
                                {linkChanged && (
                                  <Btn kind="ghost" onClick={() => void saveStep({ interview_link: pipeDraft.interviewLink.trim() }, { interviewLink: pipeDraft.interviewLink.trim() || null })}>
                                    {T("Save link", "Speichern", "Enregistrer")}
                                  </Btn>
                                )}
                              </div>
                              {!pf?.interviewLink && (
                                <p style={{ ...HINT, marginTop: 6 }}>{T("Add the link so they join through the portal — then you'll see when they open it.", "Link hinzufügen, damit sie über das Portal beitreten — dann sehen Sie, wann sie ihn öffnen.", "Ajoutez le lien pour qu'ils rejoignent via le portail — vous verrez quand ils l'ouvrent.")}</p>
                              )}
                            </div>

                            {/* STAGE 1 — Termin (the appointment), confirmed vs expected. */}
                            <div>
                              <label style={stageLbl}>{T("1 · Interview date", "1 · Termin", "1 · Date de l'entretien")}</label>
                              <GermanDateField valueIso={apptIso} onChangeIso={setApptIso} confirmed={apptConf} onToggleConfirmed={setApptConf} lang={lang} />
                            </div>

                            {/* STAGE 2 — did she actually show up + do it (separate from passing). */}
                            <div>
                              <label style={stageLbl}>{T("2 · Did the interview take place?", "2 · Interview durchgeführt?", "2 · L'entretien a-t-il eu lieu ?")}</label>
                              <Seg<"no" | "yes"> value={held ? "yes" : "no"}
                                onChange={(k) => { const v = k === "yes"; setHeld(v); if (!v) setStatus("pending"); }}
                                options={[["no", T("Not yet", "Noch nicht", "Pas encore")], ["yes", T("Yes, took place", "Ja, durchgeführt", "Oui, effectué")]]} />
                            </div>

                            {/* STAGE 3 — the result + when it came (only once it's been held). */}
                            {held ? (
                              <div>
                                <label style={stageLbl}>{T("3 · Result", "3 · Ergebnis", "3 · Résultat")}</label>
                                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                  {/* the pills, and — once "not passed" — what that means, on the same line */}
                                  <div style={{ display: "flex", alignItems: "center", gap: "8px 12px", flexWrap: "wrap" }}>
                                    {passFail(statusVal, setStatus)}
                                    {statusVal === "failed" && (
                                      <span title={T("Logged as not passed — they'll re-sit before moving on.", "Als nicht bestanden erfasst — Wiederholung nötig.", "Enregistré comme non réussi — à repasser.")}
                                        style={{ ...HINT, color: "var(--w2)" }}>{T("they'll re-sit", "Wiederholung nötig", "à repasser")}</span>
                                    )}
                                  </div>
                                  {(statusVal === "passed" || statusVal === "failed") && (
                                    <div style={{ display: "flex", alignItems: "center", gap: "6px 12px", flexWrap: "wrap" }}>
                                      <label style={{ ...lbl, marginBottom: 0 }}>{T("Result date", "Ergebnis am", "Date du résultat")}</label>
                                      <GermanDateField valueIso={resIso} onChangeIso={setResIso} confirmed={resConf} onToggleConfirmed={setResConf} lang={lang} />
                                    </div>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <p className="bvp-lbl" style={HINT}>{T("Log the result later — once she's done the interview and heard back.", "Ergebnis später erfassen — nach dem Interview und der Antwort.", "Enregistrez le résultat plus tard — une fois l'entretien passé et la réponse reçue.")}</p>
                            )}

                            {saveAndNext(() => saveInterviewFull(n), false)}
                          </div>
                        );
                      }
                      case "contract_signed": return confirmControls(!!pf?.contractDone, { contract_done: true }, { contractDone: true }, { contract_done: false }, { contractDone: false });
                      case "recognition_submitted": return confirmControls(!!pf?.recognitionDone, { recognition_done: true }, { recognitionDone: true }, { recognition_done: false }, { recognitionDone: false });
                      case "vorabzustimmung": return confirmControls(!!pf?.vorabDone, { vorab_done: true }, { vorabDone: true }, { vorab_done: false }, { vorabDone: false });
                      case "docs_collected":
                        return (
                          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                            {peekDocs === null ? (
                              <p style={HINT}>{T("Loading documents…", "Dokumente laden…", "Chargement…")}</p>
                            ) : peekDocs.length > 0 ? (
                              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                <span style={HINT}>{T("Tap any to review · approve · reject", "Zum Prüfen tippen", "Touchez pour vérifier")}</span>
                                {docList(peekDocs)}
                              </div>
                            ) : (
                              <p style={HINT}>{T("No documents uploaded yet.", "Noch keine Dokumente.", "Aucun document encore.")}</p>
                            )}
                            {confirmControls(!!pf?.docsReady, { docs_ready: true }, { docsReady: true }, { docs_ready: false }, { docsReady: false }, T("All ready for embassy", "Alle bereit", "Tout est prêt"))}
                          </div>
                        );
                      case "visa_appointment":
                        return (
                          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                            <GermanDateField valueIso={pipeDraft.visaApptDate} onChangeIso={(iso) => setPipeDraft((d) => ({ ...d, visaApptDate: iso }))} confirmed={pipeDraft.visaApptDateConfirmed} onToggleConfirmed={(c) => setPipeDraft((d) => ({ ...d, visaApptDateConfirmed: c }))} lang={lang} />
                            {saveAndNext(() => void saveStep({ visa_appt_date: pipeDraft.visaApptDate || "", visa_appt_date_confirmed: pipeDraft.visaApptDateConfirmed }, { visaApptDate: pipeDraft.visaApptDate || null, visaApptDateConfirmed: pipeDraft.visaApptDateConfirmed }), !pipeDraft.visaApptDate)}
                          </div>
                        );
                      case "visa_approved": return confirmControls(!!pf?.visaGranted, { visa_granted: true }, { visaGranted: true }, { visa_granted: false, visa_date: "" }, { visaGranted: false });
                      case "flight_booked":
                        return (
                          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                            <div>
                              <label style={lbl}>{T("Flight date", "Flugdatum", "Date de vol")}</label>
                              <GermanDateField valueIso={pipeDraft.flightDate} onChangeIso={(iso) => setPipeDraft((d) => ({ ...d, flightDate: iso }))} confirmed={pipeDraft.flightDateConfirmed} onToggleConfirmed={(c) => setPipeDraft((d) => ({ ...d, flightDateConfirmed: c }))} lang={lang} />
                            </div>
                            <div>
                              <label style={lbl}>{T("Flight info (optional)", "Fluginfo (optional)", "Infos vol (option.)")}</label>
                              <input className="bvk-input" type="text" maxLength={200} value={pipeDraft.flightInfo} onChange={(e) => setPipeDraft((d) => ({ ...d, flightInfo: e.target.value }))} placeholder={T("e.g. CMN → FRA, 14:30", "z. B. CMN → FRA, 14:30", "ex. CMN → FRA, 14:30")} />
                            </div>
                            {saveAndNext(() => void saveStep({ flight_date: pipeDraft.flightDate || "", flight_date_confirmed: pipeDraft.flightDateConfirmed, flight_info: pipeDraft.flightInfo }, { flightDate: pipeDraft.flightDate || null, flightDateConfirmed: pipeDraft.flightDateConfirmed, flightInfo: pipeDraft.flightInfo || null }), !pipeDraft.flightDate)}
                          </div>
                        );
                      case "housing_arranged": return confirmControls(!!pf?.housingDone, { housing_done: true }, { housingDone: true }, { housing_done: false }, { housingDone: false });
                      case "arrived": return confirmControls(!!pf?.arrivedDone, { arrived_done: true }, { arrivedDone: true }, { arrived_done: false }, { arrivedDone: false }, T("Yes, arrived", "Ja, angekommen", "Oui, arrivé"));
                      // Stations with no candidate_pipeline field (the ones added for the
                      // full journey: application, German check, Bürgeramt, bank, tax ID,
                      // insurance, first shift, coaching, probation) tick their journey row.
                      default: return journeyControls(stepKey);
                    }
                  })()}
                </div>
              )}

              {/* Move through steps — thin progress, ‹ › to log any other step. */}
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button type="button" onClick={() => setStepIndex(Math.max(0, viewPos - 1))} disabled={viewPos <= 0}
                  style={ROUND(viewPos <= 0)} aria-label={T("Previous step", "Vorheriger Schritt", "Étape précédente")}>
                  <ChevronLeft size={16} />
                </button>
                <div style={{ flex: 1, height: 4, borderRadius: 999, background: "var(--border)", overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: STATUS_DOT[hk], transition: "width .3s ease" }} />
                </div>
                {stepIndex !== null && (
                  <Btn kind="quiet" size="sm" onClick={() => setStepIndex(null)} style={{ fontSize: 12.5, color: "var(--w)" }}>{T("now", "jetzt", "actuel")} →</Btn>
                )}
                <button type="button" onClick={() => setStepIndex(Math.min(total - 1, viewPos + 1))} disabled={viewPos >= total - 1}
                  style={ROUND(viewPos >= total - 1)} aria-label={T("Next step", "Nächster Schritt", "Étape suivante")}>
                  <ChevronRight size={16} />
                </button>
              </div>

              {/* MORE — everything secondary, one tap away so the question stays the star. */}
              <button type="button" onClick={() => setMoreOpen((o) => !o)} aria-expanded={moreOpen}
                style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", background: "none", border: 0, padding: 0, fontSize: 13, color: "var(--w3)", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
                <ChevronDown size={14} style={{ transform: "rotate(-90deg)" }} />
                {T("More — status · papers · profile · note", "Mehr — Status · Papiere · Profil · Nachricht", "Plus — statut · papiers · profil · message")}
              </button>
              </>) : (
              <PeekMore T={T} onBack={() => setMoreOpen((o) => !o)} tabs={[
                ["status", T("Status", "Status", "Statut"), (
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Needs-follow-up banner + one-click reminder (orange = waiting on us) */}
              {peek.followUp?.needed && (
                <div style={{ borderRadius: 14, background: STATUS_TINT.pending, padding: 14, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 600, color: "var(--w)" }}>
                      <Dot st="pending" />{T("Needs follow-up", "Nachfassen nötig", "À relancer")}
                    </div>
                    <div style={{ fontSize: 12.5, color: "var(--w2)", marginTop: 3 }}>
                      {peek.followUp.reasons.map((reason) => (
                        reason === "blocked" ? T("Blocked", "Blockiert", "Bloqué")
                          : reason === "overdue" ? T("Overdue step", "Überfälliger Schritt", "Étape en retard")
                          : T("Rejected document", "Abgelehntes Dokument", "Document rejeté")
                      )).join(" · ")}
                    </div>
                  </div>
                  <Btn kind="ghost" size="sm" onClick={() => sendNudge(peek.userId)} disabled={nudging || nudged === peek.userId}
                    style={nudged === peek.userId ? { opacity: 1 } : undefined}>
                    {nudged === peek.userId
                      ? <><Dot st="approved" size={7} /> {T("Reminder sent", "Erinnerung gesendet", "Rappel envoyé")}</>
                      : <><Bell size={14} strokeWidth={2.2} /> {nudging ? T("Sending…", "Senden…", "Envoi…") : T("Send reminder", "Erinnerung senden", "Envoyer un rappel")}</>}
                  </Btn>
                </div>
              )}

              {/* Status — B2 / Anerkennung / Impfung at a glance (one block). */}
              <div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <Dot st={b2Kit(b2s)} />
                      <span style={{ color: "var(--w3)", fontSize: 13, width: 54, flex: "none" }}>{T("B2", "B2", "B2")}</span>
                      <select value={b2s} onChange={(e) => void setPeekStage("b2", peek.userId, e.target.value)} className="bvk-input" style={{ height: 38, flex: 1, minWidth: 0, fontSize: 13.5 }}>
                        {B2_STAGES.map((s) => <option key={s.key} value={s.key}>{b2StageLabel(s.key, lang)}</option>)}
                      </select>
                      <button type="button" onClick={() => void setB2Failed(peek.userId, !peek.b2Failed)} title={T("Mark / unmark failed once", "Als (nicht) bestanden markieren", "Marquer / annuler échoué")}
                        aria-pressed={!!peek.b2Failed} style={pill(peek.b2Failed ? "rejected" : null)}>
                        {peek.b2Failed && <Dot st="rejected" size={7} />}↺ {T("failed", "1×", "échoué")}
                      </button>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", paddingLeft: 83 }}>
                      <span style={{ color: "var(--w3)", fontSize: 12.5, flex: "none" }}>{T("Exam date", "Prüfungstermin", "Date d'examen")}</span>
                      <GermanDateField valueIso={peek.b2ExamDate ?? ""} onChangeIso={(iso) => { if (iso) void setB2ExamDate(peek.userId, iso); }} lang={lang} />
                      {peek.b2ExamDate && (
                        <Btn kind="quiet" size="sm" onClick={() => void setB2ExamDate(peek.userId, "")}>{T("clear", "löschen", "effacer")}</Btn>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Dot st={anerkKit(anerk)} />
                    <span style={{ color: "var(--w3)", fontSize: 13, width: 54, flex: "none" }}>{T("Anerk.", "Anerk.", "Reconn.")}</span>
                    <select value={anerk} onChange={(e) => void setPeekStage("anerk", peek.userId, e.target.value)} className="bvk-input" style={{ height: 38, flex: 1, minWidth: 0, fontSize: 13.5 }}>
                      {ANERKENNUNG_STAGES.map((s) => <option key={s.key} value={s.key}>{anerkennungStageLabel(s.key, lang)}</option>)}
                    </select>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 38 }}>
                    <Dot st={impKit} />
                    <span style={{ color: "var(--w3)", fontSize: 13, width: 54, flex: "none" }}>{T("Impf.", "Impf.", "Vacc.")}</span>
                    <span style={{ color: "var(--w)", fontSize: 13.5, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {imp === "not_required" ? T("Not required", "Nicht erforderlich", "Non requis")
                        : imp === "not_started" ? T("Required — not started", "Erforderlich — offen", "Requis — à faire")
                        : impfungStageLabel(imp, lang)}
                      {imp !== "not_required" && peek.impfungDoses && peek.impfungDoses.need > 0 ? ` · ${peek.impfungDoses.got}/${peek.impfungDoses.need}` : ""}
                    </span>
                  </div>
                </div>
              </div>
                  </div>
                )],
                ["papers", T("Papers", "Papiere", "Papiers"), (
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Passport data — extracted fields + human confirm + approve/reject,
                  reviewed inline (LAW #38/#39 preserved by the review modal). */}
              {peekProfile && ((peekDocs ?? []).some((d) => /pass/i.test(d.file_type)) || !!peekProfile.passport_no || !!peekProfile.passport_status) && (() => {
                const pst = peekProfile.passport_status ?? null;
                const label = pst === "approved" ? T("Approved", "Genehmigt", "Approuvé") : pst === "rejected" ? T("Rejected", "Abgelehnt", "Refusé") : pst === "pending" ? T("Pending review", "In Prüfung", "En vérification") : T("Not submitted", "Nicht eingereicht", "Non soumis");
                return (
                  <div>
                    <h3 style={SEC}>{T("Passport data", "Reisepassdaten", "Données du passeport")}</h3>
                    <button type="button" onClick={() => setPassportOpen(true)} style={tintRow(docKit(pst))}>
                      <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, flex: "none" }}>{T("Review", "Prüfen", "Vérifier")} →</span>
                    </button>
                  </div>
                );
              })()}

              {/* Documents — review ANY of her papers (passport, diplomas, …)
                  right here; each opens the same approve/reject/download popup as
                  the CV step. The review modal handles passports safely (LAW #39). */}
              {peekDocs && peekDocs.length > 0 ? (
                <div>
                  <h3 style={SEC}>{T("Documents", "Dokumente", "Documents")}</h3>
                  {docList(peekDocs)}
                </div>
              ) : (
                <p style={HINT}>{peekDocs === null ? T("Loading documents…", "Dokumente laden…", "Chargement…") : T("No documents uploaded yet.", "Noch keine Dokumente.", "Aucun document encore.")}</p>
              )}
                  </div>
                )],
                ["profile", T("Profile", "Profil", "Profil"), (
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Nurse profile — one compact line; click to edit (progressive disclosure). */}
              {!factsEdit ? (
                <button type="button" onClick={() => setFactsEdit(true)}
                  style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", padding: "11px 14px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--card)", fontSize: 13.5, color: "var(--w2)", cursor: "pointer", fontFamily: "inherit" }}>
                  <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {[
                      peek.facts?.specialty ? specialtyLabel(peek.facts.specialty, lang) : null,
                      peek.facts?.yearsExperience != null ? `${peek.facts.yearsExperience} ${T("yrs", "J.", "ans")}` : null,
                      peek.facts?.workplace || null,
                      peek.facts?.availableFrom ? `${T("from", "ab", "dès")} ${peek.facts.availableFrom}` : null,
                    ].filter(Boolean).join("  ·  ") || T("Add nurse details", "Pflegedetails hinzufügen", "Ajouter des détails")}
                  </span>
                  <Pencil size={13} style={{ color: "var(--w3)", flex: "none" }} />
                </button>
              ) : (
                <div style={card}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
                    <div style={{ gridColumn: "1 / -1" }}>
                      <label style={lbl}>{T("Specialty", "Fachbereich", "Spécialité")}</label>
                      <select className="bvk-input" value={factsDraft.specialty} onChange={(e) => updateFact({ specialty: e.target.value })}>
                        <option value="">{T("— none set —", "— keine —", "— aucune —")}</option>
                        {NURSE_SPECIALTIES.map((s) => <option key={s.key} value={s.key}>{specialtyLabel(s.key, lang)}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={lbl}>{T("Years", "Jahre", "Années")}</label>
                      <input className="bvk-input" type="number" min={0} max={60} value={factsDraft.years} onChange={(e) => updateFact({ years: e.target.value })} />
                    </div>
                    <div>
                      <label style={lbl}>{T("Available from", "Verfügbar ab", "Disponible dès")}</label>
                      <input className="bvk-input" type="date" value={factsDraft.availableFrom} onChange={(e) => updateFact({ availableFrom: e.target.value })} />
                    </div>
                    <div style={{ gridColumn: "1 / -1" }}>
                      <label style={lbl}>{T("Current workplace", "Aktueller Arbeitsplatz", "Lieu de travail actuel")}</label>
                      <input className="bvk-input" type="text" maxLength={120} value={factsDraft.workplace} onChange={(e) => updateFact({ workplace: e.target.value })}
                        placeholder={T("e.g. CHU Ibn Sina — ICU", "z. B. CHU Ibn Sina — Intensiv", "ex. CHU Ibn Sina — soins intensifs")} />
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14 }}>
                    <Btn kind="ghost" size="sm" onClick={() => void saveFacts()} disabled={factsSaving}>
                      {factsSaving ? T("Saving…", "Speichern…", "Enregistrement…") : T("Save", "Speichern", "Enregistrer")}
                    </Btn>
                    <Btn kind="quiet" size="sm" onClick={() => setFactsEdit(false)}>
                      {T("Cancel", "Abbrechen", "Annuler")}
                    </Btn>
                  </div>
                </div>
              )}

              {/* Candidate updates — what they self-reported (passed B2, interview…) */}
              {peek.reports && peek.reports.length > 0 && (
                <div>
                  <h3 style={SEC}>{T("Candidate updates", "Kandidaten-Updates", "Mises à jour du candidat")}</h3>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    {peek.reports.map((rep, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 2px", borderBottom: "1px solid var(--border)", fontSize: 13.5, color: "var(--w)" }}>
                        <Dot st={reportKit(rep)} size={7} />
                        <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{reportLabel(rep)}</span>
                        <span style={{ color: "var(--w3)", fontSize: 12, flex: "none" }}>{relativeTimeShort(rep.created_at, lang)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
                  </div>
                )],
                ["note", T("Message", "Nachricht", "Message"), (
              /* Quick note — reaches her as "Borivon" (never an individual admin). */
              <div>
                <textarea value={msgText} onChange={(e) => setMsgText(e.target.value)} rows={3} maxLength={2000}
                  placeholder={T("Write to her — she sees it as Borivon…", "Nachricht — sie sieht „Borivon“…", "Écrivez-lui — elle voit « Borivon »…")}
                  className="bvk-input" style={{ minHeight: 96, resize: "none", lineHeight: 1.45 }} />
                <Btn kind="ghost" size="sm" onClick={() => void sendMessage()} disabled={!msgText.trim() || sendingMsg} style={{ marginTop: 10, ...(msgSent ? { opacity: 1 } : {}) }}>
                  {msgSent ? <><Dot st="approved" size={7} /> {T("Sent", "Gesendet", "Envoyé")}</> : (sendingMsg ? T("Sending…", "Senden…", "Envoi…") : T("Send", "Senden", "Envoyer"))}
                </Btn>
              </div>
                )],
              ]} />
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
            <Btn kind="quiet" size="sm" onClick={() => setSheetOpen(false)}>{T("Close", "Schließen", "Fermer")}</Btn>
            <Btn kind="primary" size="sm" onClick={() => window.print()}><Printer size={14} strokeWidth={2.2} /> {T("Print / Save PDF", "Drucken / PDF", "Imprimer / PDF")}</Btn>
          </>
        ) : null}>
        {peek && (() => {
          const b2s = normalizeB2Stage(peek.b2Stage);
          const anerk = normalizeAnerkennungStage(peek.anerkennungStage);
          const imp = (peek.impfungStage ?? "not_required") as ImpfungStage;
          const fct = peek.facts;
          const pct = peek.docPack && peek.docPack.total ? Math.round((peek.docPack.collected / peek.docPack.total) * 100) : 0;
          // hairline rows: the label quiet on the left, the fact on the right
          const rowS: CSSProperties = { display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--border)", fontSize: 13.5 };
          const k: CSSProperties = { color: "var(--w3)" };
          const val: CSSProperties = { color: "var(--w)", fontWeight: 500, textAlign: "right" };
          return (
            <div data-employer-sheet style={{ padding: 24 }}>
              <style>{`@media print { body * { visibility: hidden !important; } [data-employer-sheet], [data-employer-sheet] * { visibility: visible !important; color: #111 !important; } [data-employer-sheet] { position: fixed !important; inset: 0 !important; margin: 0 !important; padding: 28px !important; background: #fff !important; } }`}</style>
              {/* Brand header — Borivon, never an individual admin (LAW). */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 20, paddingBottom: 16, borderBottom: "1px solid var(--border)" }}>
                <div>
                  <div style={{ lineHeight: 1 }}><Wordmark size={24} /></div>
                  <div style={{ fontSize: 12, color: "var(--w3)", marginTop: 6 }}>{T("Vetted nursing candidate", "Geprüfte Pflegekraft", "Candidat infirmier vérifié")}</div>
                </div>
                {peek.sellable?.sellable && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 600, color: "var(--w)" }}>
                    <Dot st="approved" size={8} /> {T("Ready", "Bereit", "Prêt")}
                  </span>
                )}
              </div>
              {/* Identity */}
              <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
                <Face name={peek.name} photo={peek.photo} size={64} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 26, lineHeight: 1.15, color: "var(--w)" }}>{peek.name}</div>
                  <div style={{ fontSize: 13.5, color: "var(--w3)", marginTop: 3 }}>{fct?.specialty ? specialtyLabel(fct.specialty, lang) : T("Nurse", "Pflegekraft", "Infirmier")}</div>
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
              <div style={{ marginTop: 18, fontSize: 11, color: "var(--w3)", textAlign: "center" }}>
                {T("Confidential — shared by Borivon. Contact us to proceed with this candidate.",
                   "Vertraulich — von Borivon bereitgestellt. Kontaktieren Sie uns für diesen Kandidaten.",
                   "Confidentiel — partagé par Borivon. Contactez-nous pour ce candidat.")}
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Smooth, battle-tested toasts (sonner) for save / reminder / move feedback — light, like the portal. */}
      <Toaster theme="light" position="top-center" richColors toastOptions={{ style: { fontSize: "13px" } }} />
    </main>
  );
}
