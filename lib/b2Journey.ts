/**
 * B2 German — the sub-journey ("journey inside the journey").
 *
 * B2 isn't pass/fail; it's its own mini-roadmap WITH A LOOP: a candidate can sit
 * a partial pass and re-book the remaining modules (partial → booked again). It
 * runs in PARALLEL to the main Morocco→Germany rail (flexible timing), so it
 * gets its own mini-rail + a colour-coded badge per candidate.
 *
 * Stored as a single `b2_stage` string on candidate_profiles (one value moves
 * through the stages + can loop back), not as separate journey rows — cleaner
 * data and the loop models naturally.
 *
 * Pure / server-safe.
 */

export type B2Stage =
  | "not_started"
  | "searching"     // looking for a language center
  | "studying"      // enrolled / in class
  | "registered"    // registered at a center
  | "booked"        // exam date booked + PAID
  | "awaiting"      // sat the exam, waiting on results
  | "partial"       // passed some modules — must re-book the rest (loops to booked)
  | "passed";       // fully passed ✓

export type B2StageDef = {
  key: B2Stage;
  position: number;
  /** Hex colour for the dot badge + mini-rail node. */
  color: string;
  label: { en: string; fr: string; de: string };
};

// Ordered roadmap. `partial` sits AFTER awaiting and visibly loops back to booked.
export const B2_STAGES: B2StageDef[] = [
  { key: "not_started", position: 0, color: "#6b7280", label: { en: "Not started",            fr: "Pas commencé",            de: "Nicht begonnen" } },
  { key: "searching",   position: 1, color: "#8b5cf6", label: { en: "Searching center",       fr: "Recherche centre",        de: "Zentrum suchen" } },
  { key: "studying",    position: 2, color: "#3b82f6", label: { en: "Studying",               fr: "En cours d'étude",        de: "Lernphase" } },
  { key: "registered",  position: 3, color: "#06b6d4", label: { en: "Registered at center",   fr: "Inscrit au centre",       de: "Im Zentrum angemeldet" } },
  { key: "booked",      position: 4, color: "#f59e0b", label: { en: "Exam booked & paid",     fr: "Examen réservé & payé",   de: "Prüfung gebucht & bezahlt" } },
  { key: "awaiting",    position: 5, color: "#eab308", label: { en: "Awaiting result",        fr: "Résultat en attente",     de: "Ergebnis ausstehend" } },
  { key: "partial",     position: 6, color: "#f97316", label: { en: "Partial — re-book rest", fr: "Partiel — repasser",      de: "Teilweise — Rest buchen" } },
  { key: "passed",      position: 7, color: "#16a34a", label: { en: "B2 passed",              fr: "B2 réussi",               de: "B2 bestanden" } },
];

export const B2_STAGE_BY_KEY: Record<string, B2StageDef> =
  Object.fromEntries(B2_STAGES.map((s) => [s.key, s]));

export function isB2Stage(v: unknown): v is B2Stage {
  return typeof v === "string" && v in B2_STAGE_BY_KEY;
}

/** Normalize any stored value → a valid stage (defaults to not_started). */
export function normalizeB2Stage(v: unknown): B2Stage {
  return isB2Stage(v) ? v : "not_started";
}

export function b2StageLabel(stage: B2Stage, lang: string): string {
  const d = B2_STAGE_BY_KEY[stage];
  const l = d.label;
  return l[(lang as "en" | "fr" | "de")] ?? l.en;
}

export function b2StageColor(stage: B2Stage): string {
  return B2_STAGE_BY_KEY[stage]?.color ?? "#6b7280";
}

/** B2 is "done" only at the passed stage. */
export function isB2Passed(stage: B2Stage): boolean {
  return stage === "passed";
}

// Document file_type labels that ARE a B2 language certificate (FR/EN/DE).
const B2_CERT_RE = /b2\s*(sprachzert|language cert|.*zertifikat)|certificat de langue b2|b2[\s_-]*zertifikat/i;
export function isB2CertDoc(fileType: string | null | undefined): boolean {
  return !!fileType && B2_CERT_RE.test(fileType);
}

/**
 * Resolve the B2 stage to DISPLAY, honoring real evidence over the stored field.
 * Like the CV fix: a candidate moves on the B2 track by actually having the
 * certificate, not by someone manually setting a dropdown.
 *   • an APPROVED B2 cert  → "passed"
 *   • a pending B2 cert    → at least "awaiting result" (don't downgrade if the
 *                            stored stage is already further along the path)
 *   • otherwise            → the stored stage
 * The stored field still WINS when it represents a stage the docs can't prove
 * (searching / studying / registered / booked / partial), so admins keep full
 * manual control of the early + failure stages.
 */
export function effectiveB2Stage(
  stored: B2Stage,
  docs: { file_type: string | null; status: string | null }[],
): B2Stage {
  const hasApprovedCert = docs.some((d) => d.status === "approved" && isB2CertDoc(d.file_type));
  if (hasApprovedCert) return "passed";
  const hasAnyCert = docs.some((d) => isB2CertDoc(d.file_type));
  if (hasAnyCert) {
    // A cert is uploaded but not yet approved → they at least sat the exam.
    // Keep a more-advanced stored stage (e.g. partial) if set.
    const awaitingPos = B2_STAGE_BY_KEY["awaiting"].position;
    const storedPos = B2_STAGE_BY_KEY[stored]?.position ?? 0;
    return storedPos >= awaitingPos ? stored : "awaiting";
  }
  return stored;
}
