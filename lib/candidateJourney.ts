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
 * The 23 presets below are seeded onto EVERY candidate. Tweak freely — the
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
  /**
   * Parallel milestones happen on their OWN clock, not in rail order — e.g. B2
   * German can be passed anytime from before the CV right up to the Recognition
   * phase. They are EXCLUDED from "current step" / station computation (so a
   * candidate isn't falsely shown as "stuck at B2" while they advance elsewhere)
   * and surfaced as a side badge instead.
   */
  parallel?: boolean;
  /** Which of the four phases the station belongs to (selection → work). */
  phase: JourneyPhase;
  /**
   * Implied by later progress: counts as done once ANY later station is done,
   * even without its own tick. For stations added after candidates were already
   * far along, so their history doesn't read as "never happened".
   */
  implied?: boolean;
};

export type JourneyPhase = "selection" | "paperwork" | "arrival" | "work";

export const JOURNEY_PRESETS: JourneyPreset[] = [
  // ── Selection ───────────────────────────────────────────────────────────────
  // The first three are IMPLIED: a candidate who has reached any later station
  // has necessarily been through them, so they count as done without a tick
  // (otherwise every existing candidate would show as "stuck" at step 1).
  { key: "application_received",  owner: "borivon",      position: 0,  phase: "selection", implied: true, label: { en: "Application received",           fr: "Candidature reçue",                   de: "Bewerbung eingegangen" } },
  { key: "german_assessed",       owner: "borivon",      position: 1,  phase: "selection", implied: true, label: { en: "German checked",                 fr: "Allemand vérifié",                    de: "Deutsch geprüft" } },
  { key: "documents_verified",    owner: "borivon",      position: 2,  phase: "selection", implied: true, label: { en: "Documents collected",            fr: "Documents réunis",                    de: "Unterlagen gesammelt" } },
  { key: "cv_finalized",          owner: "borivon",      position: 3,  phase: "selection", label: { en: "German CV finalized",                 fr: "CV allemand finalisé",                de: "Deutscher Lebenslauf fertig" } },
  { key: "interview_first",       owner: "organization", position: 4,  phase: "selection", label: { en: "First interview",                     fr: "Premier entretien",                   de: "Erstes Interview" } },
  { key: "interview_second",      owner: "organization", position: 5,  phase: "selection", label: { en: "Second interview (final decision)",   fr: "Deuxième entretien (décision finale)", de: "Zweites Interview (Endentscheidung)" } },
  // Renamed from "Employment contract signed" → professional "Contract sealed".
  { key: "contract_signed",       owner: "organization", position: 6,  phase: "selection", label: { en: "Contract sealed",                     fr: "Contrat conclu",                      de: "Vertrag abgeschlossen" } },
  // ── Paperwork ───────────────────────────────────────────────────────────────
  { key: "recognition_filed",     owner: "organization", position: 7,  phase: "paperwork", implied: true, label: { en: "Recognition applied for",        fr: "Reconnaissance demandée",             de: "Anerkennung beantragt" } },
  // Candidate moves here once the recognition is APPROVED by the authority.
  { key: "recognition_submitted", owner: "organization", position: 8,  phase: "paperwork", label: { en: "Recognition approved",                fr: "Reconnaissance approuvée",            de: "Anerkennung genehmigt" } },
  // Vorabzustimmung — pre-approval from the Bundesagentur für Arbeit (BFV path),
  // issued after recognition and before the embassy/visa steps.
  { key: "vorabzustimmung",       owner: "organization", position: 9,  phase: "paperwork", label: { en: "Vorabzustimmung issued",              fr: "Vorabzustimmung délivrée",            de: "Vorabzustimmung erteilt" } },
  // "Documents collected" = the VISA-READINESS gate: every paper gathered, ready
  // to deposit at the embassy. It sits right before the visa appointment, NOT at
  // the start of the journey.
  { key: "docs_collected",        owner: "candidate",    position: 10, phase: "paperwork", label: { en: "Documents ready for embassy",         fr: "Documents prêts pour l'ambassade",    de: "Unterlagen für Botschaft bereit" } },
  { key: "visa_appointment",      owner: "candidate",    position: 11, phase: "paperwork", label: { en: "Visa appointment booked",             fr: "Rendez-vous visa pris",               de: "Visumtermin gebucht" } },
  { key: "visa_approved",         owner: "candidate",    position: 12, phase: "paperwork", label: { en: "Visa approved",                       fr: "Visa approuvé",                       de: "Visum genehmigt" } },
  // ── Arrival ─────────────────────────────────────────────────────────────────
  { key: "flight_booked",         owner: "borivon",      position: 13, phase: "arrival",   label: { en: "Flight booked",                       fr: "Vol réservé",                         de: "Flug gebucht" } },
  { key: "housing_arranged",      owner: "organization", position: 14, phase: "arrival",   label: { en: "Housing arranged",                    fr: "Logement organisé",                   de: "Unterkunft organisiert" } },
  { key: "arrived",               owner: "candidate",    position: 15, phase: "arrival",   label: { en: "Arrived in Germany",                  fr: "Arrivée en Allemagne",                de: "In Deutschland angekommen" } },
  // After landing: the remote integration Borivon walks her through, in her
  // mother tongue. These are what the employer reads in the weekly report.
  { key: "address_registered",    owner: "candidate",    position: 16, phase: "arrival",   label: { en: "Address registered",                  fr: "Domicile déclaré",                    de: "Wohnsitz angemeldet" } },
  { key: "bank_account",          owner: "candidate",    position: 17, phase: "arrival",   label: { en: "Bank account opened",                 fr: "Compte bancaire ouvert",              de: "Bankkonto eröffnet" } },
  { key: "tax_id",                owner: "candidate",    position: 18, phase: "arrival",   label: { en: "Tax ID received",                     fr: "Numéro fiscal reçu",                  de: "Steuer-ID erhalten" } },
  { key: "health_insurance",      owner: "candidate",    position: 19, phase: "arrival",   label: { en: "Health insurance set up",             fr: "Assurance maladie en place",          de: "Krankenkasse angemeldet" } },
  // ── On the job ──────────────────────────────────────────────────────────────
  { key: "first_shift",           owner: "organization", position: 20, phase: "work",      label: { en: "First shift on the ward",             fr: "Prise de poste",                      de: "Erster Dienst auf Station" } },
  { key: "coaching_started",      owner: "borivon",      position: 21, phase: "work",      label: { en: "Nursing language coaching started",   fr: "Coaching linguistique démarré",        de: "Fachsprach-Coaching gestartet" } },
  { key: "probation_passed",      owner: "organization", position: 22, phase: "work",      label: { en: "Probation passed",                    fr: "Période d'essai réussie",             de: "Probezeit bestanden" } },
  // NOTE: B2 is NOT a journey preset anymore — it's its own sub-journey tracked
  // on candidate_profiles.b2_stage (see lib/b2Journey.ts). It runs in parallel
  // to this rail with its own mini-roadmap + per-candidate badge.
];

/** The four phases the employer-facing pages group the stations into. */
export const JOURNEY_PHASES: { key: JourneyPhase; label: { en: string; fr: string; de: string } }[] = [
  { key: "selection", label: { en: "Selection",  fr: "Sélection",  de: "Auswahl" } },
  { key: "paperwork", label: { en: "Paperwork",  fr: "Papiers",    de: "Papiere" } },
  { key: "arrival",   label: { en: "Arrival",    fr: "Arrivée",    de: "Ankunft" } },
  { key: "work",      label: { en: "On the job", fr: "En service", de: "Im Dienst" } },
];

/** Sequential (rail-order) milestones only — excludes any parallel ones. */
export const SEQUENTIAL_PRESETS: JourneyPreset[] = JOURNEY_PRESETS.filter((p) => !p.parallel);

export const PRESET_BY_KEY: Record<string, JourneyPreset> =
  Object.fromEntries(JOURNEY_PRESETS.map((p) => [p.key, p]));

// Legacy key aliases — old rows keep resolving after a preset rename/split, so a
// not-yet-migrated DB row never shows a raw key. interview_done → first interview.
const LEGACY_PRESET_ALIAS: Record<string, string> = {
  interview_done: "interview_first",
};
export function resolvePreset(key: string | null): JourneyPreset | undefined {
  if (!key) return undefined;
  return PRESET_BY_KEY[key] ?? PRESET_BY_KEY[LEGACY_PRESET_ALIAS[key] ?? ""];
}

/** Localized label for a row: preset rows re-label by key; custom rows use stored text. */
export function journeyItemLabel(
  row: { preset_key: string | null; text: string },
  lang: string,
): string {
  const preset = resolvePreset(row.preset_key);
  if (preset) {
    const l = preset.label;
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
