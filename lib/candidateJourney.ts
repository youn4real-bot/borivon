/**
 * Per-candidate JOURNEY checklist — preset milestone catalog + types.
 *
 * Pure / server-safe (no imports). Shared by the API route (seeding +
 * validation) and the UI (re-labelling preset rows in the active language).
 *
 * Three parties own items (see supabase/candidate_journey_items.sql):
 *   borivon       — the supreme org (you + sub-admins / global staff)
 *   organization  — partner org linked to the candidate (agency/employer/school)
 *   candidate     — the nurse
 *
 * The 11 presets below are seeded onto EVERY candidate. Tweak freely — the
 * `key` is the stable identity (used for idempotent seeding + UI re-labelling),
 * so renaming a label is safe but renaming a `key` orphans existing rows.
 */

export type JourneyOwner = "borivon" | "organization" | "candidate";

export const JOURNEY_OWNERS: JourneyOwner[] = ["borivon", "organization", "candidate"];

export function isJourneyOwner(v: unknown): v is JourneyOwner {
  return v === "borivon" || v === "organization" || v === "candidate";
}

export type JourneyPreset = {
  key: string;
  owner: JourneyOwner;
  position: number;
  label: { en: string; fr: string; de: string };
};

export const JOURNEY_PRESETS: JourneyPreset[] = [
  { key: "docs_collected",        owner: "candidate",    position: 0,  label: { en: "Documents collected",                 fr: "Documents rassemblés",                de: "Dokumente gesammelt" } },
  { key: "cv_finalized",          owner: "borivon",      position: 1,  label: { en: "German CV finalized",                 fr: "CV allemand finalisé",                de: "Deutscher Lebenslauf fertig" } },
  { key: "b2_passed",             owner: "candidate",    position: 2,  label: { en: "B2 German passed",                    fr: "Allemand B2 réussi",                  de: "B2 Deutsch bestanden" } },
  { key: "interview_done",        owner: "organization", position: 3,  label: { en: "Employer interview done",             fr: "Entretien employeur effectué",        de: "Arbeitgeber-Interview erledigt" } },
  { key: "contract_signed",       owner: "organization", position: 4,  label: { en: "Employment contract signed",          fr: "Contrat de travail signé",            de: "Arbeitsvertrag unterschrieben" } },
  { key: "recognition_submitted", owner: "organization", position: 5,  label: { en: "Recognition (Anerkennung) submitted", fr: "Reconnaissance (Anerkennung) déposée", de: "Anerkennung eingereicht" } },
  { key: "visa_appointment",      owner: "candidate",    position: 6,  label: { en: "Visa appointment booked",             fr: "Rendez-vous visa pris",               de: "Visumtermin gebucht" } },
  { key: "visa_approved",         owner: "candidate",    position: 7,  label: { en: "Visa approved",                       fr: "Visa approuvé",                       de: "Visum genehmigt" } },
  { key: "flight_booked",         owner: "borivon",      position: 8,  label: { en: "Flight booked",                       fr: "Vol réservé",                         de: "Flug gebucht" } },
  { key: "housing_arranged",      owner: "organization", position: 9,  label: { en: "Housing arranged",                    fr: "Logement organisé",                   de: "Unterkunft organisiert" } },
  { key: "arrived",               owner: "candidate",    position: 10, label: { en: "Arrived in Germany",                  fr: "Arrivé en Allemagne",                 de: "In Deutschland angekommen" } },
];

export const PRESET_BY_KEY: Record<string, JourneyPreset> =
  Object.fromEntries(JOURNEY_PRESETS.map((p) => [p.key, p]));

/** Localized label for a row: preset rows re-label by key; custom rows use stored text. */
export function journeyItemLabel(
  row: { preset_key: string | null; text: string },
  lang: string,
): string {
  if (row.preset_key && PRESET_BY_KEY[row.preset_key]) {
    const l = PRESET_BY_KEY[row.preset_key].label;
    return l[(lang as "en" | "fr" | "de")] ?? l.en;
  }
  return row.text;
}

/** Which owners a given party may assign a NEW custom item to. */
export function allowedOwnersFor(party: JourneyOwner): JourneyOwner[] {
  if (party === "borivon") return ["borivon", "organization", "candidate"];
  if (party === "organization") return ["organization", "candidate"];
  return []; // candidate cannot add
}

/** Can `party` tick/untick an item owned by `owner`? */
export function canToggle(party: JourneyOwner, owner: JourneyOwner): boolean {
  if (party === "borivon") return true;             // supreme — ticks anything
  return party === owner;                            // org/candidate tick their own tag
}
