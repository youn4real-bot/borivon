/**
 * The first six months (founder 2026-11-10, journey stage 7: "what should be done in the first day, week,
 * month, quarter, literally everything until the 6 months"). Follows the Fahrplan's 90-day plan
 * (lib/roadmap/content.ts PLAN_90) so the PDF and the portal say the same; what the arrival plan or
 * Wohnung + Anreise already cover (pick-up, bank, Amt, Krankenkasse) is not repeated. Months 4 to 6 carry
 * her to the end of the probation period. Two voices: the facility ("sie") and the nurse ("du").
 */
import type { Lang } from "./steps";

type L = Record<Lang, string>;
export type SettleItem = { id: string; fac: L; nurse: L };
/** at = days after the first working day when the phase starts (for the date shown next to it) */
export type SettleBlock = { id: string; at: number; when: L; items: SettleItem[] };

export const SETTLE: SettleBlock[] = [
  { id: "d1", at: 0, when: { de: "Tag 1", en: "Day 1", fr: "Jour 1" }, items: [
    { id: "d1a", fac: { de: "Rundgang, Spind, Kleidung.", en: "Tour, locker, uniform.", fr: "Visite, casier, tenue." },
      nurse: { de: "Rundgang, Spind, Kleidung.", en: "Tour, locker, uniform.", fr: "Visite, casier, tenue." } },
    { id: "d1b", fac: { de: "Die Ansprechperson stellt sich vor.", en: "The mentor introduces themselves.", fr: "La personne référente se présente." },
      nurse: { de: "Deine Ansprechperson stellt sich vor.", en: "Your mentor introduces themselves.", fr: "Ta personne référente se présente." } },
    { id: "d1c", fac: { de: "Mittagessen mit dem Team.", en: "Lunch with the team.", fr: "Déjeuner avec l’équipe." },
      nurse: { de: "Mittagessen mit dem Team.", en: "Lunch with the team.", fr: "Déjeuner avec l’équipe." } },
  ] },
  { id: "w1", at: 1, when: { de: "Woche 1", en: "Week 1", fr: "Semaine 1" }, items: [
    { id: "w1a", fac: { de: "Sie läuft mit, an der Seite der Ansprechperson.", en: "She shadows, next to the mentor.", fr: "Elle suit, aux côtés de la personne référente." },
      nurse: { de: "Du läufst mit, an der Seite deiner Ansprechperson.", en: "You shadow, next to your mentor.", fr: "Tu suis, aux côtés de ta personne référente." } },
    { id: "w1b", fac: { de: "Jeden Tag 10 Minuten: Wie war es?", en: "10 minutes a day: how was it?", fr: "10 minutes par jour : comment ça s’est passé ?" },
      nurse: { de: "Jeden Tag 10 Minuten: Wie war es?", en: "10 minutes a day: how was it?", fr: "10 minutes par jour : comment ça s’est passé ?" } },
  ] },
  { id: "m1", at: 7, when: { de: "Monat 1", en: "Month 1", fr: "Mois 1" }, items: [
    { id: "m1a", fac: { de: "Deutsch für die Arbeit üben: Übergabe, Telefon.", en: "Practise German for work: handover, phone.", fr: "Pratiquer l’allemand du travail : transmissions, téléphone." },
      nurse: { de: "Deutsch für die Arbeit üben: Übergabe, Telefon.", en: "Practise German for work: handover, phone.", fr: "Pratiquer l’allemand du travail : transmissions, téléphone." } },
    { id: "m1b", fac: { de: "Erstes Gespräch, in Ruhe.", en: "First talk, without rush.", fr: "Premier entretien, au calme." },
      nurse: { de: "Erstes Gespräch, in Ruhe.", en: "First talk, without rush.", fr: "Premier entretien, au calme." } },
  ] },
  { id: "m2", at: 30, when: { de: "Monat 2", en: "Month 2", fr: "Mois 2" }, items: [
    { id: "m2a", fac: { de: "Eigene Patienten, mit Hilfe.", en: "Her own patients, with help.", fr: "Ses propres patients, avec aide." },
      nurse: { de: "Eigene Patienten, mit Hilfe.", en: "Your own patients, with help.", fr: "Tes propres patients, avec aide." } },
    { id: "m2b", fac: { de: "Nächste Papiere, mit Datum.", en: "Next papers, with dates.", fr: "Prochains papiers, avec dates." },
      nurse: { de: "Nächste Papiere, mit Datum.", en: "Next papers, with dates.", fr: "Prochains papiers, avec dates." } },
    { id: "m2c", fac: { de: "Leben neben der Arbeit: Sport, Freunde.", en: "Life outside work: sport, friends.", fr: "La vie hors travail : sport, amis." },
      nurse: { de: "Leben neben der Arbeit: Sport, Freunde.", en: "Life outside work: sport, friends.", fr: "La vie hors travail : sport, amis." } },
  ] },
  { id: "m3", at: 60, when: { de: "Monat 3", en: "Month 3", fr: "Mois 3" }, items: [
    { id: "m3a", fac: { de: "Fragen: Wie geht es dir wirklich?", en: "Ask: how are you really?", fr: "Demander : comment vas-tu vraiment ?" },
      nurse: { de: "Sagen, wie es dir wirklich geht.", en: "Say how you really are.", fr: "Dire comment tu vas vraiment." } },
    { id: "m3b", fac: { de: "Plan für Familie und Zukunft.", en: "Plan for family and future.", fr: "Plan pour la famille et l’avenir." },
      nurse: { de: "Plan für Familie und Zukunft.", en: "Plan for family and future.", fr: "Plan pour la famille et l’avenir." } },
  ] },
  { id: "m6", at: 90, when: { de: "Monat 4 bis 6", en: "Months 4 to 6", fr: "Mois 4 à 6" }, items: [
    { id: "m6a", fac: { de: "Gespräch vor dem Ende der Probezeit.", en: "A talk before the probation ends.", fr: "Un entretien avant la fin de la période d’essai." },
      nurse: { de: "Gespräch vor dem Ende der Probezeit.", en: "A talk before the probation ends.", fr: "Un entretien avant la fin de la période d’essai." } },
    { id: "m6b", fac: { de: "Der nächste Schritt: Weiterbildung, Aufgaben.", en: "The next step: training, tasks.", fr: "L’étape suivante : formation, missions." },
      nurse: { de: "Dein nächster Schritt: Weiterbildung, Aufgaben.", en: "Your next step: training, tasks.", fr: "Ta prochaine étape : formation, missions." } },
    { id: "m6c", fac: { de: "Probezeit geschafft. Danke sagen, und feiern.", en: "Probation done. Say thank you, and celebrate.", fr: "Période d’essai réussie. Dire merci, et fêter ça." },
      nurse: { de: "Probezeit geschafft. Feiern.", en: "Probation done. Celebrate.", fr: "Période d’essai réussie. Fêter ça." } },
  ] },
];
export const SETTLE_IDS = new Set(SETTLE.flatMap((b) => b.items.map((i) => i.id)));

/** the day the probation period ends: six months after the first working day (YYYY-MM-DD), or "" */
export function probationEnd(start: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return "";
  const d = new Date(start + "T12:00:00Z");
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 6);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}
export function phaseDate(start: string, at: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return "";
  return new Date(Date.parse(start + "T12:00:00Z") + at * 86400e3).toISOString().slice(0, 10);
}

export const SETTLE_T: Record<Lang, { h: string; pFac: string; pNurse: string; of: string; from: string; end: string }> = {
  de: { h: "Die ersten sechs Monate", pFac: "Damit sie bleibt. Vom ersten Tag bis zum Ende der Probezeit, derselbe Plan wie im Fahrplan.", pNurse: "Vom ersten Tag bis zum Ende der Probezeit. Damit du gut ankommst.", of: "{a} von {b}", from: "ab {d}", end: "Probezeit bis {d}" },
  en: { h: "The first six months", pFac: "So she stays. From the first day to the end of probation, the same plan as in the roadmap.", pNurse: "From the first day to the end of probation. So you settle in well.", of: "{a} of {b}", from: "from {d}", end: "Probation until {d}" },
  fr: { h: "Les six premiers mois", pFac: "Pour qu’elle reste. Du premier jour à la fin de la période d’essai, le même plan que dans la feuille de route.", pNurse: "Du premier jour à la fin de la période d’essai. Pour que tu arrives bien.", of: "{a} sur {b}", from: "dès le {d}", end: "Période d’essai jusqu’au {d}" },
};
