/**
 * The visual Fahrplan (founder 2026-11-08: "people want transformation, not
 * information"). Every page = one picture + a few words:
 *   5-level staircase · before → after · the leaky bucket · lose vs win ·
 *   the Borivon way · the deadline · checklists to the next level · 90 days · call
 * Lines stay under ~6 words. Pictures are our own two-tone icons (icons.ts),
 * never generic emoji. No legal or technical words.
 */
import type { L } from "./content";
import type { Level } from "./score";
import type { IconName } from "./icons";

const x = (de: string, en: string, fr: string): L => ({ de, en, fr });

/** One picture per level, for the staircase. */
export const LEVEL_ICON: Record<Level, IconName> = { 1: "fire", 2: "bandage", 3: "money", 4: "calendar", 5: "magnet" };

/** Before (their level today) → after (the next level). 4 rows, same picture both sides. */
export const BEFORE_AFTER: Record<Level, { ic: IconName; b: L; a: L }[]> = {
  1: [
    { ic: "bed", b: x("Stellen monatelang leer", "Posts empty for months", "Postes vides depuis des mois"), a: x("Die ersten Neuen fangen an", "The first new nurses start", "Les premières arrivent") },
    { ic: "money", b: x("Leihkräfte jeden Tag", "Agency staff every day", "Intérim tous les jours"), a: x("Leihstunden sinken", "Agency hours go down", "L'intérim baisse") },
    { ic: "team", b: x("Team am Limit", "Team at its limit", "Équipe à bout"), a: x("Team atmet auf", "Team can breathe", "L'équipe respire") },
    { ic: "door", b: x("Leute gehen, keiner weiß warum", "People leave, nobody knows why", "On part, sans savoir pourquoi"), a: x("Sie wissen, warum", "You know why", "Vous savez pourquoi") },
  ],
  2: [
    { ic: "nurse", b: x("Eine nach der anderen", "One at a time", "Une par une"), a: x("3 bis 5 auf einmal", "3 to 5 at once", "3 à 5 à la fois") },
    { ic: "money", b: x("Leihkräfte stopfen Löcher", "Agency staff plug holes", "L'intérim bouche les trous"), a: x("Leihkräfte nur im Notfall", "Agency only in emergencies", "L'intérim pour les urgences") },
    { ic: "calendar", b: x("Jeder Start ist anders", "Every start is different", "Chaque arrivée est différente"), a: x("Jeder Start ist gleich gut", "Every start is equally good", "Chaque arrivée est bien faite") },
    { ic: "heart", b: x("Manche bleiben, manche nicht", "Some stay, some don't", "Certaines restent, d'autres non"), a: x("Gruppen bleiben zusammen", "Groups stay together", "Les groupes restent") },
  ],
  3: [
    { ic: "bed", b: x("Neue erst, wenn es brennt", "New nurses only once it's on fire", "Les nouvelles, quand ça brûle"), a: x("Stellen vorher besetzt", "Posts filled in advance", "Postes pourvus d'avance") },
    { ic: "money", b: x("Leihkräfte fest eingeplant", "Agency staff built into the plan", "L'intérim prévu d'office"), a: x("Jedes Quartal weniger", "Less every quarter", "Moins chaque trimestre") },
    { ic: "papers", b: x("Alles in einem Kopf", "Everything in one head", "Tout dans une seule tête"), a: x("Ablauf auf Papier", "The process on paper", "Le processus écrit") },
    { ic: "heart", b: x("Gute gehen", "Good people leave", "Les meilleures partent"), a: x("Gute sehen ihren Weg", "Good people see their path", "Les meilleures voient leur avenir") },
  ],
  4: [
    { ic: "calendar", b: x("Plan für ein paar Monate", "A plan for a few months", "Un plan pour quelques mois"), a: x("Plan für 12 Monate", "A plan for 12 months", "Un plan sur 12 mois") },
    { ic: "money", b: x("Suche kostet Geld", "Hiring costs money", "Recruter coûte cher"), a: x("Ihre Leute holen Leute", "Your people bring people", "Vos équipes en attirent d'autres") },
    { ic: "team", b: x("Krankheitswellen treffen hart", "Sick waves hit hard", "Les vagues de maladie frappent"), a: x("Eigene Springer fangen auf", "Your own floaters cover", "Vos remplaçantes prennent le relais") },
    { ic: "star", b: x("Gute werden abgeworben", "Good people get poached", "Les meilleures sont débauchées"), a: x("Gute wollen bleiben", "Good people want to stay", "Les meilleures veulent rester") },
  ],
  5: [
    { ic: "magnet", b: x("Bewerbungen kommen", "Applications come", "Les candidatures arrivent"), a: x("Die richtigen kommen", "The right ones come", "Les bonnes arrivent") },
    { ic: "papers", b: x("Regeln ändern sich", "Rules change", "Les règles changent"), a: x("Sie wissen es früh", "You know early", "Vous le savez tôt") },
    { ic: "team", b: x("Patinnen überlastet", "Mentors overloaded", "Marraines surchargées"), a: x("Patinnen wechseln sich ab", "Mentors take turns", "Les marraines tournent") },
    { ic: "heart", b: x("Andere werben ab", "Others poach", "D'autres débauchent"), a: x("Treue wird gefeiert", "Loyalty is celebrated", "La fidélité est fêtée") },
  ],
};

/** The Borivon way (our mechanism): 4 steps, one picture each. */
export const WAY: { ic: IconName; t: L; d: L }[] = [
  { ic: "nurse", t: x("Finden", "Find", "Trouver"), d: x("Wir finden Pflegekräfte, die zu Ihrem Haus passen.", "We find nurses who fit your house.", "Nous trouvons des infirmières qui vous correspondent.") },
  { ic: "papers", t: x("Papiere", "Papers", "Papiers"), d: x("Anerkennung und Visum übernehmen wir.", "We handle recognition and visa.", "Reconnaissance et visa : on s'en occupe.") },
  { ic: "house", t: x("Ankommen", "Arrive", "Arriver"), d: x("Wir planen mit Ihnen den ersten Tag.", "We plan the first day with you.", "Nous préparons le premier jour avec vous.") },
  { ic: "heart", t: x("Bleiben", "Stay", "Rester"), d: x("Der 90-Tage-Plan hält sie bei Ihnen.", "The 90-day plan keeps her with you.", "Le plan de 90 jours la garde chez vous.") },
];

/** Page words. */
export const V: Record<keyof L, {
  ladderH: string; you: string; baH: string; today: string; withPlan: string; nextOf5: string;
  bucketH: string; bucketIn: string; bucketOut: string[]; bucketLine: string; bucketFix: string;
  wayH: string; waySub: string; stepsH: string; stepsSub: string; stayH: string;
}> = {
  de: {
    ladderH: "Hier stehen Sie.", you: "SIE", baH: "Vorher. Nachher.", today: "Heute", withPlan: "Mit Plan", nextOf5: "Stufe {n}",
    bucketH: "Ein Eimer mit Loch.", bucketIn: "Neue Pflegekräfte", bucketOut: ["Kündigungen", "Leihkräfte", "Warten"],
    bucketLine: "Oben gießen Sie neue Leute rein. Unten läuft es wieder raus.",
    bucketFix: "Erst das Loch stopfen. Dann füllen.",
    wayH: "Der Borivon-Weg.", waySub: "Vier Schritte. Wir gehen sie mit Ihnen.",
    stepsH: "So kommen Sie auf Stufe {n}.", stepsSub: "Abhaken. Eins nach dem anderen.", stayH: "So bleiben Sie oben.",
  },
  en: {
    ladderH: "This is where you are.", you: "YOU", baH: "Before. After.", today: "Today", withPlan: "With a plan", nextOf5: "Level {n}",
    bucketH: "A bucket with a hole.", bucketIn: "New nurses", bucketOut: ["Resignations", "Agency staff", "Waiting"],
    bucketLine: "You pour new people in at the top. They run out at the bottom.",
    bucketFix: "Fix the hole first. Then fill.",
    wayH: "The Borivon way.", waySub: "Four steps. We walk them with you.",
    stepsH: "How you reach level {n}.", stepsSub: "Tick them off. One by one.", stayH: "How you stay on top.",
  },
  fr: {
    ladderH: "Vous êtes ici.", you: "VOUS", baH: "Avant. Après.", today: "Aujourd'hui", withPlan: "Avec un plan", nextOf5: "Niveau {n}",
    bucketH: "Un seau percé.", bucketIn: "Nouvelles infirmières", bucketOut: ["Départs", "Intérim", "Attente"],
    bucketLine: "Vous versez des gens par le haut. Ils repartent par le bas.",
    bucketFix: "D'abord boucher le trou. Puis remplir.",
    wayH: "La méthode Borivon.", waySub: "Quatre étapes. Nous les faisons avec vous.",
    stepsH: "Comment passer au niveau {n}.", stepsSub: "Cochez. Une chose après l'autre.", stayH: "Comment rester au sommet.",
  },
};
