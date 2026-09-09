/**
 * lib/journeyProgress.ts — the candidate's CURRENT phase and how far through it.
 *
 * Pure + server-safe. The journey runs in three sequential document phases:
 *
 *   1. papers       — Unterlagen: Essentials + Qualifications, as ONE phase
 *   2. bearbeitung  — the recognition doc set (applicable phase_slots)
 *   3. visum        — embassy docs: permanent boxes + applicable phase_slots
 *
 * The UI shows ONE percentage at a time — the phase they're currently in. When
 * that phase hits 100% it drops away and the next phase's percentage takes over,
 * so the number is always "how far through the thing they're actually doing now"
 * rather than a blended score that hides which step they're stuck on.
 *
 * Doc-driven: a phase advances when documents are APPROVED, so the bar moves on
 * real work with no manual checkbox upkeep. A phase with no defined work is
 * skipped entirely (0-of-0 is meaningless), and it reappears the moment those
 * docs are defined.
 */
import { computeChecklist, type DocLike } from "./candidateChecklist";
import { FILE_KEY_ALL_LABELS } from "./fileKeys";

/** A phase_slot as far as journey-completeness cares. */
export type JourneySlot = { id: string; type?: string | null; is_required?: boolean | null };

export type JourneyPhaseKey = "papers" | "bearbeitung" | "visum";

export const JOURNEY_PHASE_ORDER: JourneyPhaseKey[] = ["papers", "bearbeitung", "visum"];

export type JourneyPhase = { key: JourneyPhaseKey; done: number; total: number; pct: number };

export type JourneyInputs = {
  /** The candidate's documents (file_type + status). */
  docs: DocLike[];
  /** Org override of which papers count (see candidateChecklist); null = default. */
  requiredKeys?: readonly string[] | null;
  /** Bearbeitung slots that apply to this candidate (batch + site, else global). */
  bearbeitungSlots: JourneySlot[];
  /** Visum slots that apply to this candidate. */
  visumSlots: JourneySlot[];
  /** candidate_pipeline.arrived_done — surfaced, but never part of a phase %. */
  arrived?: boolean;
};

export type JourneyProgress = {
  phases: JourneyPhase[];
  /**
   * The phase to DISPLAY: the first one with outstanding work. If every phase
   * that has work is complete, this is the last such phase at 100%. null only
   * when no phase has any work defined at all.
   */
  current: JourneyPhase | null;
  /** Position of `current` in JOURNEY_PHASE_ORDER (-1 when none) — drives sorting. */
  currentIndex: number;
  allDone: boolean;
  arrived: boolean;
};

/**
 * Permanent embassy (Visum) boxes that count toward completion. Deliberately
 * EXCLUDES:
 *   langcert              — the B2 cert, already counted in papers (double-count)
 *   cv_visa/letter_visa   — builder twins mirroring the Essentials CV/letter
 *   berufserfahrung_visum — optional (standing rule: Berufserfahrung never counts)
 * Matched by fileKey→label (FILE_KEY_ALL_LABELS), same as papers.
 */
export const VISUM_PERMANENT_REQUIRED = [
  "ezb", "zusatzblatt_a", "defizitbescheid", "videx", "bildungsplan",
  "vorabzustimmung", "arbeitsvertrag", "mawista", "versicherung",
  "tls_rechnung", "tls_bestaetigungstermin",
  // Impfnachweis is a PERMANENT Visum box for EVERY candidate.
  "impfung",
] as const;

/**
 * Catalog papers that have MOVED to a later phase. They stay visible in their
 * original section but count only where they now live, so a single document is
 * never counted twice across the journey.
 */
export const COUNTED_IN_VISUM = ["impfung"] as const;

/** A permanent box / paper is done when a doc matching its fileKey is approved. */
function approvedByKey(docs: DocLike[], key: string): boolean {
  const labels = FILE_KEY_ALL_LABELS[key];
  const match = labels
    ? docs.filter(d => d.file_type != null && labels.has(d.file_type))
    : docs.filter(d => d.file_type === key);
  return match.some(d => d.status === "approved");
}

/** A slot's doc lives at file_type === slot.id (+ "_de" for a dual's translation). */
function approvedExact(docs: DocLike[], fileType: string): boolean {
  return docs.some(d => d.file_type === fileType && d.status === "approved");
}

function slotDone(docs: DocLike[], s: JourneySlot): boolean {
  const orig = approvedExact(docs, s.id);
  if (s.type === "dual") return orig && approvedExact(docs, `${s.id}_de`);
  return orig;
}

/** done / total over the REQUIRED slots (is_required !== false). */
function slotCounts(docs: DocLike[], slots: JourneySlot[]): { done: number; total: number } {
  const required = slots.filter(s => s.is_required !== false);
  return { total: required.length, done: required.filter(s => slotDone(docs, s)).length };
}

const asPhase = (key: JourneyPhaseKey, done: number, total: number): JourneyPhase => ({
  key, done, total, pct: total > 0 ? Math.round((done / total) * 100) : 0,
});

export function computeJourneyProgress(inp: JourneyInputs): JourneyProgress {
  const chk = computeChecklist(inp.docs, {
    requiredKeys: inp.requiredKeys ?? null,
    excludeKeys: COUNTED_IN_VISUM, // Impfung is scored in the Visum phase now
  });
  const bearb = slotCounts(inp.docs, inp.bearbeitungSlots);
  const permDone = VISUM_PERMANENT_REQUIRED.filter(k => approvedByKey(inp.docs, k)).length;
  const vSlots = slotCounts(inp.docs, inp.visumSlots);

  const phases: JourneyPhase[] = [
    asPhase("papers", chk.requiredComplete, chk.requiredTotal),
    asPhase("bearbeitung", bearb.done, bearb.total),
    asPhase("visum", permDone + vSlots.done, VISUM_PERMANENT_REQUIRED.length + vSlots.total),
  ];

  // Only phases that actually have work are shown; a 0-of-0 phase is skipped.
  const withWork = phases.filter(p => p.total > 0);
  const outstanding = withWork.find(p => p.done < p.total) ?? null;
  const current = outstanding ?? (withWork.length ? withWork[withWork.length - 1] : null);

  return {
    phases,
    current,
    currentIndex: current ? JOURNEY_PHASE_ORDER.indexOf(current.key) : -1,
    allDone: withWork.length > 0 && outstanding === null,
    arrived: inp.arrived === true,
  };
}
