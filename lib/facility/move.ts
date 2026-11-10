/**
 * Wohnung + Anreise (founder 2026-11-10, journey stages 5 + 6): "before the visa arrives the housing
 * should have been arranged … the flight declared long before, from where to where, then who meets her
 * at the airport". Practical, no jargon; a checklist they come back to.
 */
import type { Lang } from "./steps";

type L = Record<Lang, string>;
export type MoveStep = { id: string; group: "home" | "trip"; title: L; what: L };

export const MOVE_STEPS: MoveStep[] = [
  { id: "find", group: "home",
    title: { de: "Wohnung finden", en: "Find a flat", fr: "Trouver un logement" },
    what: { de: "Möbliert ist für den Anfang am einfachsten. Nah an der Arbeit oder gut mit Bus und Bahn erreichbar.", en: "Furnished is easiest to start with. Close to work or well connected by bus and train.", fr: "Meublé, c’est le plus simple pour commencer. Près du travail ou bien desservi en bus et en train." } },
  { id: "lease", group: "home",
    title: { de: "Mietvertrag unterschreiben", en: "Sign the lease", fr: "Signer le bail" },
    what: { de: "Am besten, bevor das Visum kommt. Nicht erst danach.", en: "Best before the visa arrives. Not after.", fr: "De préférence avant l’arrivée du visa. Pas après." } },
  { id: "wgb", group: "home",
    title: { de: "Wohnungsgeberbestätigung vorbereiten", en: "Get the landlord's confirmation ready", fr: "Préparer l’attestation du logeur" },
    what: { de: "Der Vermieter füllt sie aus. Ohne sie gibt es keine Anmeldung.", en: "The landlord fills it in. Without it there is no registration.", fr: "Le propriétaire la remplit. Sans elle, pas d’inscription à la mairie." } },
  { id: "keys", group: "home",
    title: { de: "Schlüsselübergabe planen", en: "Plan the key handover", fr: "Prévoir la remise des clés" },
    what: { de: "Wer übergibt den Schlüssel, und wann? Am besten am Ankunftstag.", en: "Who hands over the keys, and when? Best on the day she arrives.", fr: "Qui remet les clés, et quand ? Idéalement le jour de l’arrivée." } },
  { id: "flight", group: "trip",
    title: { de: "Flug buchen", en: "Book the flight", fr: "Réserver le vol" },
    what: { de: "Sobald das Visum da ist. Von wo nach wo, und wann: unten eintragen, dann sehen es alle.", en: "As soon as the visa is there. From where to where, and when: enter it below so everyone sees it.", fr: "Dès que le visa est là. D’où vers où, et quand : à saisir ci-dessous pour que tout le monde le voie." } },
  { id: "pickup", group: "trip",
    title: { de: "Abholung am Flughafen", en: "Airport pick-up", fr: "Accueil à l’aéroport" },
    what: { de: "Jemand holt sie ab und bringt sie zur Wohnung. Niemand sollte allein ankommen.", en: "Someone meets her and takes her to the flat. Nobody should arrive alone.", fr: "Quelqu’un l’accueille et l’emmène au logement. Personne ne devrait arriver seul." } },
  { id: "day1", group: "trip",
    title: { de: "Den ersten Arbeitstag vorbereiten", en: "Prepare the first working day", fr: "Préparer le premier jour de travail" },
    what: { de: "Wer empfängt sie? Arbeitskleidung, Schlüssel, Spind, Ansprechperson für die ersten 90 Tage.", en: "Who welcomes her? Work clothes, keys, locker, a contact person for the first 90 days.", fr: "Qui l’accueille ? Tenue, clés, casier, une personne de référence pour les 90 premiers jours." } },
];
export const MOVE_STEP_IDS = new Set(MOVE_STEPS.map((s) => s.id));

export const MOVE_T: Record<Lang, Record<string, string>> = {
  de: { h: "Wohnung und Anreise", p: "Steht, bevor das Visum kommt. So kommt sie an und weiß, wohin.", home: "Die Wohnung", trip: "Die Anreise", from: "Abflug (Stadt oder Flughafen)", to: "Ankunft (Flughafen in Deutschland)", date: "Flugdatum", by: "Wer holt sie ab?", save: "Speichern", saved: "Gespeichert." },
  en: { h: "Flat and journey", p: "Arranged before the visa arrives. So she lands and knows where to go.", home: "The flat", trip: "The journey", from: "Departure (city or airport)", to: "Arrival (airport in Germany)", date: "Flight date", by: "Who picks her up?", save: "Save", saved: "Saved." },
  fr: { h: "Logement et voyage", p: "Prêt avant l’arrivée du visa. Ainsi elle atterrit et sait où aller.", home: "Le logement", trip: "Le voyage", from: "Départ (ville ou aéroport)", to: "Arrivée (aéroport en Allemagne)", date: "Date du vol", by: "Qui vient la chercher ?", save: "Enregistrer", saved: "Enregistré." },
};
