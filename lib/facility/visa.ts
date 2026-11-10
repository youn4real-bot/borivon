/**
 * The visa guide (founder 2026-11-10, journey stage 4: "show the nurse and the employer how to apply on
 * the TLS website, what to put in, and the response time"). Facts from the German Embassy Rabat's page
 * "Visum für Fachkräfte mit Berufsausbildung" (rabat.diplo.de, 2026): booking in the Auslandsportal,
 * personal submission at TLScontact Rabat, 75 € visa fee (paid in dirham) + the TLScontact service fee,
 * originals + one simple copy each, translations for documents not in German/English/French; with the
 * employer's pre-approval usually about 3 weeks after submission, otherwise about 3 months; no status
 * enquiries in that time. Plain words for clients (no § numbers).
 */
import type { Lang } from "./steps";

type L = Record<Lang, string>;
export type VisaStep = { id: string; who: "facility" | "nurse" | "both"; title: L; what: L; link?: { href: string; label: L } };

export const VISA_STEPS: VisaStep[] = [
  {
    id: "vorab", who: "facility",
    title: { de: "Vorabzustimmung einholen", en: "Get the pre-approval", fr: "Obtenir l’accord préalable" },
    what: {
      de: "Das macht die Einrichtung: Sie beantragt die Vorabzustimmung bei ihrer Ausländerbehörde. Damit dauert das Visum meist Wochen statt Monate.",
      en: "This is the facility's part: it applies for the pre-approval at its immigration office. With it, the visa usually takes weeks instead of months.",
      fr: "C’est le rôle de l’établissement : il demande l’accord préalable auprès de son service des étrangers. Avec lui, le visa prend en général des semaines au lieu de mois.",
    },
  },
  {
    id: "docs", who: "both",
    title: { de: "Unterlagen vorbereiten", en: "Prepare the documents", fr: "Préparer les documents" },
    what: {
      de: "Jede Unterlage im Original und mit einer einfachen Kopie, in der Reihenfolge der Checkliste. Was nicht auf Deutsch, Englisch oder Französisch ist, mit Übersetzung. Die Visa-Mappe legt alles in die richtige Reihenfolge.",
      en: "Every document as an original plus one simple copy, in checklist order. Anything not in German, English or French with a translation. The visa folder puts everything in the right order.",
      fr: "Chaque document en original et avec une copie simple, dans l’ordre de la liste. Ce qui n’est pas en allemand, anglais ou français, avec une traduction. Le dossier visa met tout dans le bon ordre.",
    },
  },
  {
    id: "book", who: "nurse",
    title: { de: "Termin buchen", en: "Book the appointment", fr: "Réserver le rendez-vous" },
    what: {
      de: "Im Auslandsportal des Auswärtigen Amts. Dort wird auch der Antrag vorbereitet.",
      en: "In the Federal Foreign Office's Auslandsportal. The application is prepared there too.",
      fr: "Sur l’Auslandsportal du ministère allemand des Affaires étrangères. La demande y est aussi préparée.",
    },
    link: { href: "https://digital.diplo.de/visa", label: { de: "Zum Auslandsportal", en: "Open the Auslandsportal", fr: "Ouvrir l’Auslandsportal" } },
  },
  {
    id: "submit", who: "nurse",
    title: { de: "Persönlich abgeben bei TLScontact in Rabat", en: "Hand in at TLScontact in Rabat, in person", fr: "Déposer en personne chez TLScontact à Rabat" },
    what: {
      de: "Visumgebühr 75 €, in Dirham bezahlt, dazu die Servicegebühr von TLScontact. Die Originale kommen nach der Bearbeitung zurück.",
      en: "Visa fee €75, paid in dirham, plus TLScontact's service fee. The originals come back after processing.",
      fr: "Frais de visa 75 €, payés en dirhams, plus les frais de service de TLScontact. Les originaux sont rendus après le traitement.",
    },
  },
  {
    id: "wait", who: "both",
    title: { de: "Warten", en: "Wait", fr: "Attendre" },
    what: {
      de: "Mit Vorabzustimmung meist ca. 3 Wochen nach der Abgabe, sonst ca. 3 Monate. In dieser Zeit nicht nachfragen.",
      en: "With the pre-approval usually about 3 weeks after handing in, otherwise about 3 months. Don't send enquiries in that time.",
      fr: "Avec l’accord préalable, en général environ 3 semaines après le dépôt, sinon environ 3 mois. Ne pas relancer pendant ce temps.",
    },
  },
  {
    id: "got", who: "both",
    title: { de: "Visum da", en: "Visa granted", fr: "Visa obtenu" },
    what: {
      de: "Jetzt den Flug festmachen. Die Wohnung sollte schon stehen. Nach der Ankunft geht es im Ankunftsplan weiter.",
      en: "Now fix the flight. The flat should already be arranged. After arrival, the arrival plan takes over.",
      fr: "Réserver maintenant le vol. Le logement devrait déjà être prêt. Après l’arrivée, le plan d’arrivée prend le relais.",
    },
  },
];
export const VISA_STEP_IDS = new Set(VISA_STEPS.map((s) => s.id));

export const VISA_T: Record<Lang, Record<string, string>> = {
  de: {
    h: "Das Visum", p: "Schritt für Schritt, so wie die Deutsche Botschaft in Rabat es verlangt.", facility: "Einrichtung", nurse: "Pflegekraft", both: "Beide",
    submitted: "Abgegeben am", setDate: "Datum eintragen", day: "Tag {n} seit der Abgabe", expect: "Mit Vorabzustimmung meist um den {d}.", exp: "Unsere Erfahrung zuletzt: meist 10 bis 20 Tage.",
    src: "Quelle: Deutsche Botschaft Rabat, „Visum für Fachkräfte“ (2026). Bitte vor dem Termin auf rabat.diplo.de prüfen; Gebühren und Abläufe können sich ändern.",
  },
  en: {
    h: "The visa", p: "Step by step, the way the German Embassy in Rabat asks for it.", facility: "Facility", nurse: "Nurse", both: "Both",
    submitted: "Handed in on", setDate: "Enter the date", day: "Day {n} since handing in", expect: "With the pre-approval, usually around {d}.", exp: "Our recent experience: mostly 10 to 20 days.",
    src: "Source: German Embassy Rabat, \"Visa for skilled workers\" (2026). Please check rabat.diplo.de before the appointment; fees and steps can change.",
  },
  fr: {
    h: "Le visa", p: "Étape par étape, comme l’ambassade d’Allemagne à Rabat le demande.", facility: "Établissement", nurse: "Infirmière", both: "Les deux",
    submitted: "Déposé le", setDate: "Saisir la date", day: "Jour {n} depuis le dépôt", expect: "Avec l’accord préalable, en général vers le {d}.", exp: "Notre expérience récente : le plus souvent 10 à 20 jours.",
    src: "Source : ambassade d’Allemagne à Rabat, « Visa pour travailleurs qualifiés » (2026). Vérifiez sur rabat.diplo.de avant le rendez-vous ; frais et étapes peuvent changer.",
  },
};
