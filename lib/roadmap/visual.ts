/**
 * The visual Fahrplan (founder 2026-11-08: "people want transformation, not
 * information"). Every page = one picture + a few words:
 *   5-level staircase · before → after · the leaky bucket · lose vs win ·
 *   the deadline · checklists to the next level · 90 days. Nothing is sold in the PDF.
 * Lines stay under ~6 words. Pictures are our own two-tone icons (icons.ts),
 * never generic emoji. No legal or technical words.
 */
import type { L } from "./content";
import type { Level } from "./score";
import type { IconName } from "./icons";

const x = (de: string, en: string, fr: string): L => ({ de, en, fr });

/** One picture per level, for the staircase. */
export const LEVEL_ICON: Record<Level, IconName> = { 1: "fire", 2: "bandage", 3: "door", 4: "calendar", 5: "magnet" };

/** Before (their level today) → after (the next level). 4 rows, same picture both sides. */
export const BEFORE_AFTER: Record<Level, { ic: IconName; b: L; a: L }[]> = {
  1: [
    { ic: "bed", b: x("Stellen monatelang leer", "Posts empty for months", "Postes vides depuis des mois"), a: x("Die ersten Neuen fangen an", "The first new nurses start", "Les premières arrivent") },
    { ic: "calendar", b: x("Überstunden jeden Tag", "Overtime every day", "Heures sup tous les jours"), a: x("Überstunden sinken", "Overtime goes down", "Les heures sup baissent") },
    { ic: "team", b: x("Team am Limit", "Team at its limit", "Équipe à bout"), a: x("Team atmet auf", "Team can breathe", "L'équipe respire") },
    { ic: "door", b: x("Leute gehen, keiner weiß warum", "People leave, nobody knows why", "On part, sans savoir pourquoi"), a: x("Sie wissen, warum", "You know why", "Vous savez pourquoi") },
  ],
  2: [
    { ic: "nurse", b: x("Eine nach der anderen", "One at a time", "Une par une"), a: x("3 bis 5 auf einmal", "3 to 5 at once", "3 à 5 à la fois") },
    { ic: "team", b: x("Überstunden stopfen Löcher", "Overtime plugs holes", "Les heures sup bouchent les trous"), a: x("Feste Leute statt Überstunden", "Your own people, not overtime", "Des équipes fixes, pas d'heures sup") },
    { ic: "calendar", b: x("Jeder Start ist anders", "Every start is different", "Chaque arrivée est différente"), a: x("Jeder Start ist gleich gut", "Every start is equally good", "Chaque arrivée est bien faite") },
    { ic: "heart", b: x("Manche bleiben, manche nicht", "Some stay, some don't", "Certaines restent, d'autres non"), a: x("Gruppen bleiben zusammen", "Groups stay together", "Les groupes restent") },
  ],
  3: [
    { ic: "bed", b: x("Neue erst, wenn es brennt", "New nurses only once it's on fire", "Les nouvelles, quand ça brûle"), a: x("Stellen vorher besetzt", "Posts filled in advance", "Postes pourvus d'avance") },
    { ic: "door", b: x("Jede Kündigung tut weh", "Every resignation hurts", "Chaque départ fait mal"), a: x("Ersatz steht schon bereit", "Cover is already lined up", "Le remplacement est déjà prêt") },
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

/** Page words. */
export const V: Record<keyof L, {
  ladderH: string; you: string; baH: string; today: string; withPlan: string; nextOf5: string;
  bucketH: string; bucketIn: string; bucketOut: string[]; bucketLine: string; bucketFix: string;
  stepsH: string; stepsSub: string; stayH: string;
}> = {
  de: {
    ladderH: "Hier stehen Sie.", you: "SIE", baH: "Vorher. Nachher.", today: "Heute", withPlan: "Mit Plan", nextOf5: "Stufe {n}",
    bucketH: "Ein Eimer mit Loch.", bucketIn: "Neue Pflegekräfte", bucketOut: ["Kündigungen", "Überstunden", "Warten"],
    bucketLine: "Oben gießen Sie neue Leute rein. Unten läuft es wieder raus.",
    bucketFix: "Erst das Loch stopfen. Dann füllen.",
    stepsH: "So kommen Sie auf Stufe {n}.", stepsSub: "Abhaken. Eins nach dem anderen.", stayH: "So bleiben Sie oben.",
  },
  en: {
    ladderH: "This is where you are.", you: "YOU", baH: "Before. After.", today: "Today", withPlan: "With a plan", nextOf5: "Level {n}",
    bucketH: "A bucket with a hole.", bucketIn: "New nurses", bucketOut: ["Resignations", "Overtime", "Waiting"],
    bucketLine: "You pour new people in at the top. They run out at the bottom.",
    bucketFix: "Fix the hole first. Then fill.",
    stepsH: "How you reach level {n}.", stepsSub: "Tick them off. One by one.", stayH: "How you stay on top.",
  },
  fr: {
    ladderH: "Vous êtes ici.", you: "VOUS", baH: "Avant. Après.", today: "Aujourd'hui", withPlan: "Avec un plan", nextOf5: "Niveau {n}",
    bucketH: "Un seau percé.", bucketIn: "Nouvelles infirmières", bucketOut: ["Départs", "Heures sup", "Attente"],
    bucketLine: "Vous versez des gens par le haut. Ils repartent par le bas.",
    bucketFix: "D'abord boucher le trou. Puis remplir.",
    stepsH: "Comment passer au niveau {n}.", stepsSub: "Cochez. Une chose après l'autre.", stayH: "Comment rester au sommet.",
  },
};
