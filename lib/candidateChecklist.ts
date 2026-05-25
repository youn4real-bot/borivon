/**
 * lib/candidateChecklist.ts — single source of truth for
 * "where is this candidate with their papers?".
 *
 * Pure + server-safe (no React, no fetch). Used by all three surfaces so they
 * always agree:
 *   • candidate dashboard  → their own progress panel
 *   • admin per-candidate  → that candidate's checklist
 *   • admin overall board  → every candidate's progress, computed server-side
 *
 * Documents are matched to catalog keys with the SAME mechanism the dashboard's
 * getDoc() uses — FILE_KEY_ALL_LABELS[key].has(doc.file_type) — so a doc counts
 * here exactly when it counts there.
 *
 * Scope = the actual papers: Essentials + Qualifications (dashboard PHASES 1-2).
 * Bearbeitung/Visum are admin-defined process steps, not papers → excluded.
 */
import { FILE_KEY_ALL_LABELS } from "./fileKeys";

export type ChecklistGroup = "essentials" | "qualifications";
export type ItemStatus = "approved" | "pending" | "rejected" | "missing";
/** Single roll-up state for a checklist row (original + translation combined). */
export type ItemState = "complete" | "rejected" | "pending" | "missing";

export type ChecklistItemDef = {
  /** Canonical fileKey of the original document. */
  key: string;
  group: ChecklistGroup;
  /** Qualifications ship as an original + a German translation. */
  hasTranslation: boolean;
  /** Optional items don't count toward the completion percentage. */
  optional: boolean;
};

/**
 * Canonical document catalog — mirrors the dashboard's Essentials +
 * Qualifications boxes. "other"/Sonstiges is intentionally excluded (free-form
 * catch-all, not a required paper). Edit optionality here; it's the one place.
 */
export const CHECKLIST_ITEMS: ChecklistItemDef[] = [
  // ── Essentials ──
  { key: "id",        group: "essentials", hasTranslation: false, optional: false }, // Passport
  { key: "cv_de",     group: "essentials", hasTranslation: false, optional: false }, // CV
  { key: "letter",    group: "essentials", hasTranslation: false, optional: false }, // Cover letter
  { key: "langcert",  group: "essentials", hasTranslation: false, optional: false }, // B2 certificate
  // ── Qualifications (original + German translation) ──
  { key: "diploma",           group: "qualifications", hasTranslation: true, optional: false },
  { key: "studyprog",         group: "qualifications", hasTranslation: true, optional: false },
  { key: "transcript",        group: "qualifications", hasTranslation: true, optional: false },
  { key: "abitur",            group: "qualifications", hasTranslation: true, optional: false },
  { key: "abitur_transcript", group: "qualifications", hasTranslation: true, optional: false },
  { key: "praktikum",         group: "qualifications", hasTranslation: true, optional: false },
  { key: "workcert",          group: "qualifications", hasTranslation: true, optional: false },
  { key: "work_experience",   group: "qualifications", hasTranslation: true, optional: true },
  { key: "impfung",           group: "qualifications", hasTranslation: true, optional: false },
];

export type DocLike = { file_type: string | null; status: string | null };

export type ChecklistItem = ChecklistItemDef & {
  original: ItemStatus;
  /** null when the item has no translation. */
  translation: ItemStatus | null;
  state: ItemState;
};

export type Checklist = {
  items: ChecklistItem[];
  requiredTotal: number;
  requiredComplete: number;
  /** 0-100, share of REQUIRED items fully approved. */
  pct: number;
  /** Tallies over REQUIRED items only (each item is in exactly one bucket). */
  counts: { complete: number; pending: number; rejected: number; missing: number };
};

/** Docs whose stored file_type belongs to this fileKey (same rule as getDoc). */
function docsForKey(docs: DocLike[], key: string): DocLike[] {
  const labels = FILE_KEY_ALL_LABELS[key];
  return labels
    ? docs.filter(d => d.file_type != null && labels.has(d.file_type))
    : docs.filter(d => d.file_type === key);
}

/** approved > pending > rejected > missing (matches the dashboard's per-box color). */
function statusForKey(docs: DocLike[], key: string): ItemStatus {
  const m = docsForKey(docs, key);
  if (m.length === 0) return "missing";
  if (m.some(d => d.status === "approved")) return "approved";
  if (m.some(d => d.status == null || d.status === "pending")) return "pending";
  return "rejected";
}

function rollUp(original: ItemStatus, translation: ItemStatus | null): ItemState {
  const parts = translation === null ? [original] : [original, translation];
  if (parts.every(s => s === "approved")) return "complete";
  if (parts.some(s => s === "rejected")) return "rejected";
  if (parts.some(s => s !== "missing")) return "pending"; // something in, not all approved
  return "missing";
}

/** Compute the full checklist for one candidate from their documents rows. */
export function computeChecklist(docs: DocLike[]): Checklist {
  const items: ChecklistItem[] = CHECKLIST_ITEMS.map(def => {
    const original = statusForKey(docs, def.key);
    const translation = def.hasTranslation ? statusForKey(docs, `${def.key}_de`) : null;
    return { ...def, original, translation, state: rollUp(original, translation) };
  });

  const counts = { complete: 0, pending: 0, rejected: 0, missing: 0 };
  let requiredTotal = 0;
  for (const it of items) {
    if (it.optional) continue;
    requiredTotal++;
    counts[it.state]++;
  }
  const requiredComplete = counts.complete;
  const pct = requiredTotal === 0 ? 0 : Math.round((requiredComplete / requiredTotal) * 100);
  return { items, requiredTotal, requiredComplete, pct, counts };
}
