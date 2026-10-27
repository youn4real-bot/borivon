/**
 * Everything that differs between the three kinds of Einrichtung the Fahrplan
 * is for (founder, 2026-10-27: only Krankenhaus/Klinik, Altenheim, ambulanter
 * Pflegedienst): the name, the money model in words (with where the numbers
 * come from), and five tips that only fit that kind of place.
 *
 * Numbers: lib/roadmap/score.ts COST_MODEL. Sources, as of October 2026:
 *  - Bundesbasisfallwert 2026: 4.570,64 € (GKV-Spitzenverband, § 10 Abs. 9 KHEntgG)
 *  - Pflegeheim own share Ø 3.364 € / month, first year (vdek, 01.07.2026);
 *    Pflegekasse at Pflegegrad 3: 1.319 € / month (BMG, Leistungsbeträge 2026)
 *  - ambulant revenue ≈ 1.200–1.400 € per patient / month (sector guides)
 * Words: 5th-grade German (founder rule). The word for all three is
 * "Einrichtung" (Pflegeeinrichtung / Gesundheitseinrichtung).
 */
import type { FacilityType } from "./score";
import type { L } from "./content";
import type { IconName } from "./icons";

type Tip = { t: L; d: L };

export const FACILITY: Record<FacilityType, {
  name: L;
  icon: IconName;
  /** "Speziell für …" headline of the PDF page */
  forTitle: L;
  /** how one open post is counted, one line each */
  openModel: L;
  /** where the numbers come from */
  source: L;
  tips: Tip[];
  /** one sentence for the follow-up mail about the first week */
  firstWeek: L;
}> = {
  hospital: {
    name: { de: "Krankenhaus / Klinik", en: "Hospital / clinic", fr: "Hôpital / clinique" },
    icon: "hospital",
    forTitle: { de: "Speziell für Krankenhäuser", en: "Just for hospitals", fr: "Spécial hôpitaux" },
    openModel: {
      de: "1 offene Stelle = 80 Leihstunden à 55 € (4.400 €) + 1 gesperrtes Bett (15.600 €) = 20.000 € im Monat.",
      en: "1 open post = 80 agency hours at €55 (€4,400) + 1 closed bed (€15,600) = €20,000 a month.",
      fr: "1 poste vide = 80 heures d'intérim à 55 € (4 400 €) + 1 lit fermé (15 600 €) = 20 000 € par mois.",
    },
    source: {
      de: "Ein Bett bringt rund 650 € am Tag: Bundesbasisfallwert 2026 (4.570,64 €) geteilt durch rund 7 Tage Liegezeit. Bei 80 % Belegung sind das 15.600 € im Monat.",
      en: "A bed earns about €650 a day: the 2026 federal base rate (€4,570.64) divided by about 7 days' stay. At 80% occupancy that is €15,600 a month.",
      fr: "Un lit rapporte environ 650 € par jour : tarif de base fédéral 2026 (4 570,64 €) divisé par environ 7 jours de séjour. À 80 % d'occupation, cela fait 15 600 € par mois.",
    },
    tips: [
      { t: { de: "Erst eine feste Station", en: "One ward first", fr: "D'abord un service fixe" }, d: { de: "Neue starten auf einer Station mit festen Abläufen. Nicht im Springer-Pool.", en: "New nurses start on one ward with fixed routines. Not in the float pool.", fr: "Les nouvelles commencent dans un service avec des routines fixes. Pas dans le pool de remplacement." } },
      { t: { de: "Anerkennung mit Datum", en: "Recognition with a date", fr: "Reconnaissance avec une date" }, d: { de: "Bis zur Anerkennung arbeitet sie als Pflegehilfskraft. Planen Sie Prüfung oder Anpassungslehrgang mit Datum.", en: "Until recognition she works as a nursing assistant. Plan the exam or adaptation course with a date.", fr: "Jusqu'à la reconnaissance, elle travaille comme aide-soignante. Planifiez l'examen ou le stage d'adaptation avec une date." } },
      { t: { de: "Deutsch für die Station", en: "German for the ward", fr: "L'allemand du service" }, d: { de: "Übergabe, Visite, Doku: Üben Sie diese Sätze im Dienst. Nicht nur im Kurs.", en: "Handover, ward rounds, notes: practise these phrases at work. Not only in class.", fr: "Transmissions, visite, dossier : entraînez ces phrases au travail. Pas seulement en cours." } },
      { t: { de: "Faire Dienste", en: "Fair shifts", fr: "Des gardes justes" }, d: { de: "Nicht nur Nächte und Wochenenden für die Neuen. Das merkt jede.", en: "Not only nights and weekends for new nurses. Everyone notices.", fr: "Pas seulement les nuits et les week-ends pour les nouvelles. Tout le monde le remarque." } },
      { t: { de: "Einen Weg zeigen", en: "Show a path", fr: "Montrer un chemin" }, d: { de: "Intensiv, OP, Praxisanleitung: Zeigen Sie früh, wohin sie wachsen kann.", en: "Intensive care, OR, mentoring students: show early where she can grow.", fr: "Réanimation, bloc, tutorat : montrez tôt où elle peut évoluer." } },
    ],
    firstWeek: { de: "Im Krankenhaus heißt das: die ersten Dienste auf einer festen Station, mit derselben Patin.", en: "In a hospital that means: the first shifts on one fixed ward, with the same mentor.", fr: "À l'hôpital, cela veut dire : les premières gardes dans un service fixe, avec la même marraine." },
  },
  care_home: {
    name: { de: "Altenheim / Pflegeheim", en: "Care home", fr: "Maison de retraite" },
    icon: "house",
    forTitle: { de: "Speziell für Altenheime", en: "Just for care homes", fr: "Spécial maisons de retraite" },
    openModel: {
      de: "1 offene Stelle = 80 Leihstunden à 55 € (4.400 €) + 2 leere Plätze à 4.600 € (9.200 €) = 13.600 € im Monat.",
      en: "1 open post = 80 agency hours at €55 (€4,400) + 2 empty places at €4,600 (€9,200) = €13,600 a month.",
      fr: "1 poste vide = 80 heures d'intérim à 55 € (4 400 €) + 2 places vides à 4 600 € (9 200 €) = 13 600 € par mois.",
    },
    source: {
      de: "Ein Heimplatz bringt rund 4.600 € im Monat: Eigenanteil im Schnitt 3.364 € (vdek, Juli 2026) plus Pflegekasse bei Pflegegrad 3 (1.319 €).",
      en: "A place earns about €4,600 a month: average own share €3,364 (vdek, July 2026) plus the care insurance at care level 3 (€1,319).",
      fr: "Une place rapporte environ 4 600 € par mois : reste à charge moyen 3 364 € (vdek, juillet 2026) plus l'assurance dépendance au degré 3 (1 319 €).",
    },
    tips: [
      { t: { de: "Personalvorgaben im Blick", en: "Mind the staffing rules", fr: "Les règles de personnel" }, d: { de: "Erst nach der Anerkennung zählt sie als Fachkraft. Planen Sie das Datum ein.", en: "Only after recognition does she count as a qualified nurse. Plan for that date.", fr: "Elle ne compte comme infirmière qu'après la reconnaissance. Prévoyez cette date." } },
      { t: { de: "Ein fester Wohnbereich", en: "One fixed unit", fr: "Une unité fixe" }, d: { de: "Neue arbeiten zuerst in einem Wohnbereich, mit denselben Bewohnern.", en: "New nurses first work in one unit, with the same residents.", fr: "Les nouvelles travaillent d'abord dans une unité, avec les mêmes résidents." } },
      { t: { de: "Bewohner vorbereiten", en: "Prepare the residents", fr: "Préparer les résidents" }, d: { de: "Stellen Sie die Neue Bewohnern und Angehörigen vor. Das schafft Vertrauen.", en: "Introduce the new nurse to residents and families. It builds trust.", fr: "Présentez la nouvelle aux résidents et aux familles. Cela crée la confiance." } },
      { t: { de: "Doku mit Beispielen", en: "Notes with examples", fr: "Le dossier avec des exemples" }, d: { de: "Zeigen Sie die Pflegedoku an echten Beispielen. Das spart Wochen.", en: "Show the care notes with real examples. It saves weeks.", fr: "Montrez le dossier de soins avec de vrais exemples. Cela fait gagner des semaines." } },
      { t: { de: "Wohnung und Weg", en: "Flat and commute", fr: "Logement et trajet" }, d: { de: "Viele Heime liegen am Rand. Klären Sie Wohnung und Weg zur Arbeit vorher.", en: "Many homes are on the edge of town. Sort out the flat and the way to work first.", fr: "Beaucoup de maisons sont en périphérie. Réglez le logement et le trajet avant." } },
    ],
    firstWeek: { de: "Im Altenheim heißt das: ein fester Wohnbereich, dieselben Bewohner, dieselbe Patin.", en: "In a care home that means: one fixed unit, the same residents, the same mentor.", fr: "En maison de retraite, cela veut dire : une unité fixe, les mêmes résidents, la même marraine." },
  },
  home_care: {
    name: { de: "Ambulanter Pflegedienst", en: "Home care service", fr: "Soins à domicile" },
    icon: "car",
    forTitle: { de: "Speziell für Pflegedienste", en: "Just for home care", fr: "Spécial soins à domicile" },
    openModel: {
      de: "1 offene Stelle = 80 Leihstunden à 55 € (4.400 €) + 4 abgelehnte Patienten à 1.300 € (5.200 €) = 9.600 € im Monat.",
      en: "1 open post = 80 agency hours at €55 (€4,400) + 4 refused patients at €1,300 (€5,200) = €9,600 a month.",
      fr: "1 poste vide = 80 heures d'intérim à 55 € (4 400 €) + 4 patients refusés à 1 300 € (5 200 €) = 9 600 € par mois.",
    },
    source: {
      de: "Ein Patient bringt einem Pflegedienst im Schnitt rund 1.200 bis 1.400 € im Monat. Wir rechnen mit 1.300 €.",
      en: "A patient brings a home care service about €1,200 to €1,400 a month on average. We use €1,300.",
      fr: "Un patient rapporte en moyenne environ 1 200 à 1 400 € par mois. Nous comptons 1 300 €.",
    },
    tips: [
      { t: { de: "Führerschein früh klären", en: "Sort the licence early", fr: "Le permis, tôt" }, d: { de: "Ohne Führerschein keine Tour. Klären Sie früh, ob er umgeschrieben werden muss.", en: "No licence, no round. Check early whether it must be converted.", fr: "Sans permis, pas de tournée. Vérifiez tôt s'il doit être échangé." } },
      { t: { de: "Erst mitfahren", en: "Ride along first", fr: "D'abord accompagner" }, d: { de: "Die ersten Touren nur zusammen mit einer erfahrenen Kollegin.", en: "The first rounds only together with an experienced colleague.", fr: "Les premières tournées seulement avec une collègue expérimentée." } },
      { t: { de: "Kleine, feste Touren", en: "Small, fixed rounds", fr: "Petites tournées fixes" }, d: { de: "Zuerst wenige Patienten, immer dieselben, im selben Gebiet.", en: "At first few patients, always the same ones, in the same area.", fr: "D'abord peu de patients, toujours les mêmes, dans le même secteur." } },
      { t: { de: "Nie allein mit Fragen", en: "Never alone with questions", fr: "Jamais seule avec ses questions" }, d: { de: "Ein Diensthandy und eine feste Person, die unterwegs immer erreichbar ist.", en: "A work phone and one fixed person who can always be reached on the road.", fr: "Un téléphone de service et une personne fixe, toujours joignable sur la route." } },
      { t: { de: "Anerkennung mit Datum", en: "Recognition with a date", fr: "Reconnaissance avec une date" }, d: { de: "Bis zur Anerkennung arbeitet sie als Pflegehilfskraft. Planen Sie die Touren danach.", en: "Until recognition she works as a nursing assistant. Plan her rounds around it.", fr: "Jusqu'à la reconnaissance, elle travaille comme aide-soignante. Organisez ses tournées en conséquence." } },
    ],
    firstWeek: { de: "Im Pflegedienst heißt das: die ersten Touren nur mitfahren, mit derselben Kollegin.", en: "In home care that means: ride along on the first rounds, with the same colleague.", fr: "En soins à domicile, cela veut dire : accompagner les premières tournées, avec la même collègue." },
  },
};

/** Leaving, per type (one line), built from the same numbers. */
export function leaveModel(t: FacilityType, lang: "de" | "en" | "fr", eur: (n: number) => string, perPost: number, perDeparture: number): string {
  if (lang === "en") return `1 nurse leaves = her post stays open for about 3 months (3 × ${eur(perPost)}) + lost onboarding (${eur(5400)}) + a new search (${eur(8000)}) = ${eur(perDeparture)}.`;
  if (lang === "fr") return `1 départ = le poste reste vide environ 3 mois (3 × ${eur(perPost)}) + intégration perdue (${eur(5400)}) + nouvelle recherche (${eur(8000)}) = ${eur(perDeparture)}.`;
  return `1 Pflegekraft geht = ihre Stelle ist etwa 3 Monate leer (3 × ${eur(perPost)}) + Einarbeitung weg (${eur(5400)}) + neue Suche (${eur(8000)}) = ${eur(perDeparture)}.`;
}
