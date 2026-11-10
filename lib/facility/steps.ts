/**
 * The arrival plan: what a nurse from abroad does in her first weeks in Germany, in order, with the
 * nearest place for each step (lib/facility/places.ts). Plain, true, short. No legal advice.
 *
 * Facts used: registration within 2 weeks of moving in (§ 17 BMG) with the landlord's confirmation
 * (§ 19 BMG); the tax ID arrives by post after registration; a basic bank account is a right for
 * anyone living legally in the EU (§ 31 ZKG); statutory health insurance from the first working day.
 */
export type Lang = "de" | "en" | "fr";
export const FX_LANGS: Lang[] = ["de", "en", "fr"];

export type PlaceKind = "anmeldung" | "bank" | "kasse" | "finanzamt" | "auslaender" | "arzt";
export const PLACE_KINDS: PlaceKind[] = ["anmeldung", "bank", "kasse", "finanzamt", "auslaender", "arzt"];

export type StepId = "wohnung" | "anmeldung" | "konto" | "kasse" | "steuer" | "aufenthalt" | "arzt";

type L = Record<Lang, string>;
export type Step = {
  id: StepId;
  place?: PlaceKind;
  /** days after arrival this should be done by ("" = no date) */
  dueDays?: number;
  title: L;
  what: L;
  bring?: L;
};

export const STEPS: Step[] = [
  {
    id: "wohnung", dueDays: 0,
    title: { de: "Wohnung beziehen", en: "Move in", fr: "Emménager" },
    what: {
      de: "Mietvertrag unterschreiben und die Wohnungsgeberbestätigung vom Vermieter mitnehmen. Ohne sie gibt es keine Anmeldung.",
      en: "Sign the lease and get the landlord's confirmation (Wohnungsgeberbestätigung). Without it, no registration.",
      fr: "Signer le bail et demander au propriétaire l'attestation de logement (Wohnungsgeberbestätigung). Sans elle, pas d'inscription.",
    },
  },
  {
    id: "anmeldung", place: "anmeldung", dueDays: 14,
    title: { de: "Wohnsitz anmelden", en: "Register the address", fr: "Déclarer son domicile" },
    what: {
      de: "Innerhalb von 2 Wochen nach dem Einzug, im Bürgerbüro oder Rathaus. Oft mit Termin. Danach gibt es die Meldebescheinigung.",
      en: "Within 2 weeks of moving in, at the citizens' office or town hall. Often by appointment. You then get the registration certificate.",
      fr: "Dans les 2 semaines après l'emménagement, au bureau des citoyens ou à la mairie. Souvent sur rendez-vous. On reçoit ensuite le certificat d'inscription.",
    },
    bring: {
      de: "Reisepass mit Visum, Wohnungsgeberbestätigung",
      en: "Passport with visa, landlord's confirmation",
      fr: "Passeport avec visa, attestation de logement",
    },
  },
  {
    id: "konto", place: "bank", dueDays: 21,
    title: { de: "Bankkonto eröffnen", en: "Open a bank account", fr: "Ouvrir un compte bancaire" },
    what: {
      de: "Für das Gehalt. Wer in der EU wohnt, hat ein Recht auf ein Basiskonto.",
      en: "For the salary. Anyone living in the EU has a right to a basic account.",
      fr: "Pour le salaire. Toute personne résidant dans l'UE a droit à un compte de base.",
    },
    bring: {
      de: "Reisepass, Meldebescheinigung, Arbeitsvertrag",
      en: "Passport, registration certificate, work contract",
      fr: "Passeport, certificat d'inscription, contrat de travail",
    },
  },
  {
    id: "kasse", place: "kasse",
    title: { de: "Krankenkasse wählen", en: "Choose a health insurer", fr: "Choisir une caisse d'assurance maladie" },
    what: {
      de: "Pflicht ab dem ersten Arbeitstag. Die Pflegekraft wählt eine gesetzliche Krankenkasse, die Einrichtung meldet sie an. Die Sozialversicherungsnummer kommt danach per Post.",
      en: "Required from the first working day. The nurse picks a statutory insurer, the employer registers her. The social security number then arrives by post.",
      fr: "Obligatoire dès le premier jour de travail. L'infirmière choisit une caisse publique, l'employeur l'inscrit. Le numéro de sécurité sociale arrive ensuite par courrier.",
    },
    bring: {
      de: "Reisepass, Arbeitsvertrag",
      en: "Passport, work contract",
      fr: "Passeport, contrat de travail",
    },
  },
  {
    id: "steuer", place: "finanzamt", dueDays: 42,
    title: { de: "Steuer-ID an die Lohnabrechnung", en: "Tax ID to payroll", fr: "Numéro fiscal à la paie" },
    what: {
      de: "Kommt nach der Anmeldung von selbst per Post, meist innerhalb von 4 Wochen. Kommt sie nicht, hilft das Finanzamt.",
      en: "Arrives by post after registration, usually within 4 weeks. If it doesn't, the tax office helps.",
      fr: "Arrive par courrier après l'inscription, en général sous 4 semaines. Sinon, le centre des impôts aide.",
    },
  },
  {
    id: "aufenthalt", place: "auslaender",
    title: { de: "Aufenthaltstitel beantragen", en: "Apply for the residence permit", fr: "Demander le titre de séjour" },
    what: {
      de: "Das Visum gilt nur befristet. Früh einen Termin bei der Ausländerbehörde buchen, lange vor Ablauf des Visums.",
      en: "The visa is only temporary. Book an appointment at the immigration office early, well before the visa runs out.",
      fr: "Le visa est temporaire. Prendre tôt rendez-vous au service des étrangers, bien avant l'expiration du visa.",
    },
    bring: {
      de: "Reisepass, Meldebescheinigung, Arbeitsvertrag, biometrisches Foto",
      en: "Passport, registration certificate, work contract, biometric photo",
      fr: "Passeport, certificat d'inscription, contrat de travail, photo biométrique",
    },
  },
  {
    id: "arzt", place: "arzt",
    title: { de: "Hausarztpraxis finden", en: "Find a family doctor", fr: "Trouver un médecin traitant" },
    what: {
      de: "Eine Praxis in der Nähe, für Krankmeldung und Rezepte.",
      en: "A practice nearby, for sick notes and prescriptions.",
      fr: "Un cabinet proche, pour les arrêts maladie et les ordonnances.",
    },
  },
];

export const PLACE_LABEL: Record<PlaceKind, L> = {
  anmeldung: { de: "Bürgerbüro / Rathaus", en: "Citizens' office", fr: "Bureau des citoyens" },
  bank: { de: "Bank", en: "Bank", fr: "Banque" },
  kasse: { de: "Krankenkasse", en: "Health insurer", fr: "Caisse maladie" },
  finanzamt: { de: "Finanzamt", en: "Tax office", fr: "Centre des impôts" },
  auslaender: { de: "Ausländerbehörde", en: "Immigration office", fr: "Service des étrangers" },
  arzt: { de: "Hausarzt", en: "Family doctor", fr: "Médecin traitant" },
};

/** "2026-05-12" for a due step, or "" when the step has no date or there is no arrival date. */
export function dueDate(arrival: string, step: Step): string {
  if (!arrival || step.dueDays == null) return "";
  const t = Date.parse(arrival + "T12:00:00Z");
  if (!Number.isFinite(t)) return "";
  return new Date(t + step.dueDays * 86400e3).toISOString().slice(0, 10);
}

export const STEP_IDS = new Set<string>(STEPS.map((s) => s.id));
