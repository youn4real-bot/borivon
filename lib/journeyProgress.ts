/**
 * lib/journeyProgress.ts — the WHOLE-JOURNEY completion % for one candidate.
 *
 * Pure + server-safe. Where lib/candidateChecklist.ts measures only the PAPERS
 * (Essentials + Qualifications), this spans the entire journey so the number
 * keeps climbing from signup all the way to arrival — the at-a-glance "is this
 * person moving?" signal for whoever shepherds the pipeline.
 *
 * It is DOC-DRIVEN (auto-moves on real approvals, no manual checkbox upkeep):
 *   papers        — required Essentials + Qualifications approved (org-tailored)
 *   Bearbeitung   — the candidate's applicable required recognition doc slots
 *   Visum         — the permanent embassy boxes + applicable required Visum slots
 *   arrived       — candidate_pipeline.arrived_done (the one team-set milestone)
 *
 * Each phase is weighted; a phase with no defined work drops out and the rest
 * renormalise, so an agency that hasn't set up (say) Bearbeitung slots yet still
 * gets an honest % — and it recalibrates the moment those docs are defined.
 * `arrived` always counts, so nobody reads 100% until they've actually landed.
 */
import { computeChecklist, type DocLike } from "./candidateChecklist";
import { FILE_KEY_ALL_LABELS } from "./fileKeys";

/** A phase_slot as far as journey-completeness cares. */
export type JourneySlot = { id: string; type?: string | null; is_required?: boolean | null };

export type JourneyInputs = {
  /** The candidate's documents (file_type + status). */
  docs: DocLike[];
  /** Org override of which papers count (see candidateChecklist); null = default. */
  requiredKeys?: readonly string[] | null;
  /** Bearbeitung slots that apply to this candidate (batch + site, else global). */
  bearbeitungSlots: JourneySlot[];
  /** Visum slots that apply to this candidate. */
  visumSlots: JourneySlot[];
  /** candidate_pipeline.arrived_done. */
  arrived: boolean;
};

export type JourneySegment = { key: string; weight: number; done: number; total: number };
export type JourneyProgress = { pct: number; segments: JourneySegment[]; arrived: boolean };

/**
 * Permanent embassy (Visum) boxes that count toward completion. Deliberately
 * EXCLUDES:
 *   langcert           — the B2 cert, already counted in the papers phase (would double-count)
 *   cv_visa/letter_visa — builder twins that mirror the Essentials CV/letter
 *   berufserfahrung_visum — optional
 * Matched by fileKey→label (FILE_KEY_ALL_LABELS), same as papers.
 */
export const VISUM_PERMANENT_REQUIRED = [
  "ezb", "zusatzblatt_a", "defizitbescheid", "videx", "bildungsplan",
  "vorabzustimmung", "arbeitsvertrag", "mawista", "versicherung",
  "tls_rechnung", "tls_bestaetigungstermin",
] as const;

const WEIGHTS = { papers: 35, bearbeitung: 20, visum: 25, arrived: 20 };

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

export function computeJourneyProgress(inp: JourneyInputs): JourneyProgress {
  const chk = computeChecklist(inp.docs, { requiredKeys: inp.requiredKeys ?? null });
  const bearb = slotCounts(inp.docs, inp.bearbeitungSlots);
  const permDone = VISUM_PERMANENT_REQUIRED.filter(k => approvedByKey(inp.docs, k)).length;
  const vSlots = slotCounts(inp.docs, inp.visumSlots);
  const visum = { done: permDone + vSlots.done, total: VISUM_PERMANENT_REQUIRED.length + vSlots.total };

  const segments: JourneySegment[] = [
    { key: "papers",      weight: WEIGHTS.papers,      done: chk.requiredComplete, total: chk.requiredTotal },
    { key: "bearbeitung", weight: WEIGHTS.bearbeitung, done: bearb.done,           total: bearb.total },
    { key: "visum",       weight: WEIGHTS.visum,       done: visum.done,           total: visum.total },
    { key: "arrived",     weight: WEIGHTS.arrived,     done: inp.arrived ? 1 : 0,  total: 1 },
  ];

  // Only phases with defined work count; their weights renormalise. `arrived`
  // always has total 1, so a not-yet-arrived candidate can never read 100%.
  const active = segments.filter(s => s.total > 0);
  const sumWeight = active.reduce((a, s) => a + s.weight, 0) || 1;
  const pct = Math.round(
    (active.reduce((a, s) => a + s.weight * (s.done / s.total), 0) / sumWeight) * 100,
  );
  return { pct, segments, arrived: inp.arrived };
}
