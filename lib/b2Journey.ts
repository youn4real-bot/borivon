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
  | "studying"      // still studying
  | "planning"      // planning a date to sit the exam
  | "booked"        // confirmed date — booked & paid
  | "passed"        // B2 passed ✓ (main path end)
  | "retaking";     // failed / partial — a NEW exam date is booked to try again

export type B2StageDef = {
  key: B2Stage;
  position: number;
  /** Hex colour for the dot badge + mini-rail node. */
  color: string;
  label: { en: string; fr: string; de: string };
};

// Main path (studying → planning → booked → passed). `retaking` is the SEPARATE
// failure branch (shown on its own, only when used).
export const B2_STAGES: B2StageDef[] = [
  { key: "not_started", position: 0, color: "#6b7280", label: { en: "Not started",                fr: "Pas commencé",              de: "Nicht begonnen" } },
  { key: "studying",    position: 1, color: "#3b82f6", label: { en: "Still studying",             fr: "En cours d'étude",          de: "Lernt noch" } },
  { key: "planning",    position: 2, color: "#8b5cf6", label: { en: "Planning passing date",      fr: "Planification de la date",  de: "Termin wird geplant" } },
  { key: "booked",      position: 3, color: "#f59e0b", label: { en: "Confirmed date (booked & paid)", fr: "Date confirmée (réservé & payé)", de: "Termin bestätigt (gebucht & bezahlt)" } },
  { key: "passed",      position: 4, color: "#16a34a", label: { en: "B2 passed",                  fr: "B2 réussi",                 de: "B2 bestanden" } },
  // Failure branch — own column, only shown when someone is in it.
  { key: "retaking",    position: 5, color: "#f97316", label: { en: "Retaking — new date booked", fr: "Repasse — nouvelle date",   de: "Wiederholung — neuer Termin" } },
];

// The four MAIN-path stages (the left rail). `retaking` is the right-side branch.
export const B2_MAIN_STAGES = B2_STAGES.filter((s) => s.key !== "not_started" && s.key !== "retaking");

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
 * A candidate moves on the B2 track by actually having the certificate, not by
 * someone manually setting a dropdown:
 *   • an APPROVED B2 cert → "passed"
 *   • a pending (uploaded, not-yet-approved) B2 cert → "booked" (confirmed date;
 *     they've clearly sat/are sitting the exam) — unless the stored stage is the
 *     'retaking' failure branch, which an admin set deliberately and we keep.
 *   • otherwise → the stored stage (admin's manual call: studying / planning /
 *     booked / retaking).
 */
export function effectiveB2Stage(
  stored: B2Stage,
  docs: { file_type: string | null; status: string | null }[],
): B2Stage {
  const hasApprovedCert = docs.some((d) => d.status === "approved" && isB2CertDoc(d.file_type));
  if (hasApprovedCert) return "passed";
  if (stored === "retaking") return "retaking"; // admin-set failure branch wins
  const hasAnyCert = docs.some((d) => isB2CertDoc(d.file_type));
  if (hasAnyCert) {
    // Uploaded but unapproved cert → at least "confirmed date", unless already
    // further along.
    const bookedPos = B2_STAGE_BY_KEY["booked"].position;
    const storedPos = B2_STAGE_BY_KEY[stored]?.position ?? 0;
    return storedPos >= bookedPos ? stored : "booked";
  }
  return stored;
}
