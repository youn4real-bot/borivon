/**
 * CV auto-fill — the ADMIN-ONLY, minimalist "save me time" merge.
 *
 * The endpoint (app/api/portal/admin/cv-autofill) resolves what Borivon already
 * knows about a candidate + (optionally) asks Gemini Flash to draft the German
 * duty bullets, then this module MERGES those into the admin's current CV draft.
 *
 * Design rules (locked — see memory cv-autofill-admin):
 *  - EMPTY-ONLY. Never overwrite a field the admin already filled.
 *  - Never invents hard facts (employers, dates, institutions) — those must come
 *    from the candidate. It only fills the tedious German PROSE (duty bullets)
 *    and trivially-known contact facts (phone).
 *  - Deterministic where possible (nursing duties are a standard catalog), Flash
 *    only for the parts that genuinely need language generation. Pure + testable;
 *    the AI call lives in the route, this file never touches the network.
 */

/** A work entry, loosely typed — the canonical shape is CVData in the client. */
export type WorkEntryLike = {
  isGap?: boolean;
  title?: string;
  employer?: string;
  location?: string;
  departments?: string[];
  taetigkeiten?: string[];
  [k: string]: unknown;
};

export type DraftLike = {
  phone?: string;
  workEntries?: WorkEntryLike[];
  [k: string]: unknown;
};

/** Facts Borivon holds that are safe to drop into empty contact fields. */
export type KnownFacts = { phone?: string | null; specialty?: string | null };

/** Duty bullets Flash produced, keyed by workEntries index. */
export type GeneratedDuties = Record<number, string[]>;

export const MAX_DUTY_WORDS = 8;
export const MIN_BULLETS = 3;
export const MAX_BULLETS = 6;

/**
 * The universal nursing-duty fallback — the exact German strings from the CV
 * builder's NURSING_DUTIES catalog, so they render as clean "selected" chips
 * (not free-text). True for essentially every ward nurse; used when Flash is
 * unavailable or returns nothing for a nursing entry.
 */
export const NURSING_DUTY_DEFAULTS: string[] = [
  "Grundpflege der Patienten",
  "Behandlungspflege",
  "Verabreichung von Medikamenten",
  "Kontrolle der Vitalzeichen",
  "Pflegedokumentation",
  "Zusammenarbeit im interdisziplinären Team",
];

/** Count the non-empty bullets in a taetigkeiten array. */
export function filledBulletCount(t?: string[]): number {
  if (!Array.isArray(t)) return 0;
  return t.filter((b) => typeof b === "string" && b.trim().length > 0).length;
}

/** Trim a duty to MAX_DUTY_WORDS words, strip a trailing period, collapse space. */
export function clampBullet(s: string): string {
  const cleaned = String(s ?? "").replace(/\s+/g, " ").trim().replace(/[.;]+$/, "");
  return cleaned.split(" ").filter(Boolean).slice(0, MAX_DUTY_WORDS).join(" ");
}

/** De-dupe (case-insensitive) + clamp + cap a list of bullets. */
export function normalizeBullets(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const b = clampBullet(typeof item === "string" ? item : "");
    if (!b) continue;
    const key = b.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(b);
    if (out.length >= MAX_BULLETS) break;
  }
  return out;
}

/**
 * Is this entry a nursing role? Position 0 is always the (nursing) internship.
 * Otherwise sniff the title / candidate specialty for nursing keywords, so a
 * prior nursing job also gets the standard-duty fallback.
 */
export function isNursingEntry(entry: WorkEntryLike, index: number, specialty?: string | null): boolean {
  if (index === 0) return true;
  const hay = `${entry.title ?? ""} ${specialty ?? ""}`.toLowerCase();
  return /pflege|kranken|nurse|infirm|soin|gesundheit/.test(hay);
}

/**
 * Which non-gap entries still need duty bullets (0 filled), and enough context to
 * write them (a nursing role, or a typed title). Returns their indexes.
 */
export function entriesNeedingDuties(draft: DraftLike, specialty?: string | null): number[] {
  const entries = Array.isArray(draft.workEntries) ? draft.workEntries : [];
  const out: number[] = [];
  entries.forEach((e, i) => {
    if (e?.isGap) return;
    if (filledBulletCount(e?.taetigkeiten) > 0) return; // empty-only
    const nursing = isNursingEntry(e ?? {}, i, specialty);
    const hasTitle = !!(e?.title && e.title.trim());
    if (nursing || hasTitle) out.push(i);
  });
  return out;
}

/** A shallow-ish clone that only copies what we mutate (workEntries + phone). */
function cloneDraft(draft: DraftLike): DraftLike {
  return {
    ...draft,
    workEntries: (Array.isArray(draft.workEntries) ? draft.workEntries : []).map((e) => ({
      ...e,
      taetigkeiten: Array.isArray(e?.taetigkeiten) ? [...e.taetigkeiten] : [],
    })),
  };
}

export type AutofillResult = { draft: DraftLike; filled: number };

/**
 * Merge known facts + generated duties into the draft, EMPTY-ONLY.
 * `filled` counts how many fields were actually populated (for the UI toast).
 */
export function applyAutofill(
  draft: DraftLike,
  facts: KnownFacts,
  generated: GeneratedDuties,
): AutofillResult {
  const next = cloneDraft(draft);
  let filled = 0;

  // Contact — phone only (email is auth-derived; personal facts overlay from the
  // passport columns on load, so writing them here is redundant).
  if (!(next.phone && next.phone.trim()) && facts.phone && facts.phone.trim()) {
    next.phone = facts.phone.trim();
    filled++;
  }

  const entries = next.workEntries ?? [];
  entries.forEach((entry, i) => {
    if (entry?.isGap) return;
    if (filledBulletCount(entry?.taetigkeiten) > 0) return; // never touch admin's own

    let bullets = normalizeBullets(generated[i]);
    if (bullets.length < MIN_BULLETS && isNursingEntry(entry ?? {}, i, facts.specialty)) {
      // Fill the gap from the standard nursing catalog (top up, keep order, dedupe).
      const merged = [...bullets];
      const seen = new Set(merged.map((b) => b.toLowerCase()));
      for (const d of NURSING_DUTY_DEFAULTS) {
        if (merged.length >= 4) break;
        if (seen.has(d.toLowerCase())) continue;
        merged.push(d);
        seen.add(d.toLowerCase());
      }
      bullets = normalizeBullets(merged);
    }
    if (bullets.length >= MIN_BULLETS) {
      entry.taetigkeiten = bullets;
      filled++;
    }
  });

  return { draft: next, filled };
}
