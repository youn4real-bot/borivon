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
import { BANDS, type FormV2 } from "./form";
import { buildTimeline } from "./timeline";

const x = (de: string, en: string, fr: string): L => ({ de, en, fr });

/** One picture per level, for the staircase. */
export const LEVEL_ICON: Record<Level, IconName> = { 1: "fire", 2: "bandage", 3: "door", 4: "calendar", 5: "magnet" };

/** Before (their level today) → after (the next level). 4 rows, same picture both sides. */
export const BEFORE_AFTER: Record<Level, { ic: IconName; b: L; a: L }[]> = {
  1: [
    { ic: "bed", b: x("Stellen monatelang leer", "Posts empty for months", "Postes vides depuis des mois"), a: x("Die ersten Neuen fangen an", "The first new nurses start", "Les premières arrivent") },
    { ic: "calendar", b: x("Jeden Tag fehlt jemand", "Someone missing every day", "Il manque quelqu'un chaque jour"), a: x("Dienstplan steht", "The rota holds", "Le planning tient") },
    { ic: "team", b: x("Team am Limit", "Team at its limit", "Équipe à bout"), a: x("Team atmet auf", "Team can breathe", "L'équipe respire") },
    { ic: "door", b: x("Leute gehen, keiner weiß warum", "People leave, nobody knows why", "On part, sans savoir pourquoi"), a: x("Sie wissen, warum", "You know why", "Vous savez pourquoi") },
  ],
  2: [
    { ic: "nurse", b: x("Eine nach der anderen", "One at a time", "Une par une"), a: x("3 bis 5 auf einmal", "3 to 5 at once", "3 à 5 à la fois") },
    { ic: "team", b: x("Jede Stelle ein Kraftakt", "Every post a struggle", "Chaque poste, un effort"), a: x("Mehrere auf einmal", "Several at once", "Plusieurs à la fois") },
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
    { ic: "team", b: x("Ansprechpersonen überlastet", "Mentors overloaded", "Marraines surchargées"), a: x("Ansprechpersonen wechseln sich ab", "Mentors take turns", "Les marraines tournent") },
    { ic: "heart", b: x("Andere werben ab", "Others poach", "D'autres débauchent"), a: x("Treue wird gefeiert", "Loyalty is celebrated", "La fidélité est fêtée") },
  ],
};

/** Page words. */
export const V: Record<keyof L, {
  ladderH: string; you: string; baH: string; today: string; withPlan: string; nextOf5: string;
  bucketH: string; bucketIn: string; bucketOut: string[]; bucketLine: string; bucketFix: string;
  stepsH: string; softH: string; softHTop: string; softP: string; softBtn: string; stepsSub: string; stayH: string;
}> = {
  de: {
    ladderH: "Hier stehen Sie.", you: "SIE", baH: "Vorher. Nachher.", today: "Heute", withPlan: "Mit Plan", nextOf5: "Stufe {n}",
    bucketH: "Ein Eimer mit Loch.", bucketIn: "Neue Pflegekräfte", bucketOut: ["Kündigungen", "Warten", "Holpriger Start"],
    bucketLine: "Oben gießen Sie neue Leute rein. Unten läuft es wieder raus.",
    bucketFix: "Erst das Loch stopfen. Dann füllen.",
    softH: "Wollen Sie auf Stufe {n}?", softHTop: "Wollen Sie oben bleiben?",
    softP: "Viele Häuser bleiben genau hier stecken. Nicht, weil sie es nicht können. Sondern weil zu viel auf einmal anliegt. Wenn Sie Hilfe dabei möchten: In 15 Minuten schauen wir gemeinsam, ob wir zu Ihnen passen.",
    softBtn: "Prüfen, ob es passt",
    stepsH: "So kommen Sie auf Stufe {n}.", stepsSub: "Abhaken. Eins nach dem anderen.", stayH: "So bleiben Sie oben.",
  },
  en: {
    ladderH: "This is where you are.", you: "YOU", baH: "Before. After.", today: "Today", withPlan: "With a plan", nextOf5: "Level {n}",
    bucketH: "A bucket with a hole.", bucketIn: "New nurses", bucketOut: ["Resignations", "Waiting", "Bumpy start"],
    bucketLine: "You pour new people in at the top. They run out at the bottom.",
    bucketFix: "Fix the hole first. Then fill.",
    softH: "Want to reach level {n}?", softHTop: "Want to stay on top?",
    softP: "Many facilities get stuck right here. Not because they can't do it, but because too much lands at once. If you'd like help with it: in 15 minutes we look together at whether we're a fit.",
    softBtn: "See if it fits",
    stepsH: "How you reach level {n}.", stepsSub: "Tick them off. One by one.", stayH: "How you stay on top.",
  },
  fr: {
    ladderH: "Vous êtes ici.", you: "VOUS", baH: "Avant. Après.", today: "Aujourd'hui", withPlan: "Avec un plan", nextOf5: "Niveau {n}",
    bucketH: "Un seau percé.", bucketIn: "Nouvelles infirmières", bucketOut: ["Départs", "Attente", "Départ chaotique"],
    bucketLine: "Vous versez des gens par le haut. Ils repartent par le bas.",
    bucketFix: "D'abord boucher le trou. Puis remplir.",
    softH: "Passer au niveau {n} ?", softHTop: "Rester au sommet ?",
    softP: "Beaucoup d'établissements restent bloqués ici. Pas parce qu'ils n'y arrivent pas, mais parce que tout arrive en même temps. Si vous voulez de l'aide : en 15 minutes, nous voyons ensemble si nous vous correspondons.",
    softBtn: "Voir si ça correspond",
    stepsH: "Comment passer au niveau {n}.", stepsSub: "Cochez. Une chose après l'autre.", stayH: "Comment rester au sommet.",
  },
};

// ── personal: only the pains they told us about (founder 2026-11-08: "always relevant to them") ──

const LEASING_L: Record<FormV2["leasing"], L> = {
  "0": x("Keine", "No", "Aucun"), "1-2": x("1 bis 2", "1 to 2", "1 à 2"), "3-5": x("3 bis 5", "3 to 5", "3 à 5"), "6+": x("6 oder mehr", "6 or more", "6 ou plus"),
};
type Pain = { ic: IconName; b: L; a: L; leak: L };
const P = (ic: IconName, b: L, a: L, leak: L): Pain => ({ ic, b, a, leak });

/**
 * Their pains, most important first, each from an answer they gave:
 * the need (always) · what went wrong last time · Leasing (only if they have it) ·
 * a start date that is too soon · what is not prepared yet · never hired abroad.
 */
export function painsFor(f: FormV2, today: Date): Pain[] {
  const out: Pain[] = [];
  const need = BANDS[f.bedarf];
  out.push(P("bed", x(`${need.de} Fachkräfte fehlen`, `${need.en} nurses missing`, `${need.fr} infirmières manquent`),
    x("Die Neuen fangen an", "The new nurses start", "Les nouvelles commencent"), x("Leere Stellen", "Empty posts", "Postes vides")));
  const g = f.grund;
  if (g.includes("left")) out.push(P("door", x("Neue gingen wieder", "New nurses left again", "Les nouvelles sont reparties"), x("Neue bleiben", "New nurses stay", "Les nouvelles restent"), x("Sie gehen wieder", "They leave again", "Elles repartent")));
  if (g.includes("papers")) out.push(P("papers", x("Papiere dauerten ewig", "Papers took forever", "Les papiers ont traîné"), x("Papiere nach Zeitplan", "Papers on schedule", "Papiers dans les temps"), x("Papiere", "Papers", "Papiers")));
  if (g.includes("german")) out.push(P("speech", x("Deutsch reichte nicht", "German wasn't enough", "L'allemand ne suffisait pas"), x("Deutsch passt zum Start", "German fits the start", "L'allemand suffit au départ"), x("Deutsch", "German", "Allemand")));
  if (g.includes("never_came")) out.push(P("warning", x("Sie kam nie an", "She never arrived", "Elle n'est jamais arrivée"), x("Ankunft fest geplant", "Arrival planned for sure", "Arrivée bien prévue"), x("Absprung", "Drop-out", "Désistement")));
  if (g.includes("skills")) out.push(P("star", x("Passte fachlich nicht", "Skills didn't fit", "Ne convenait pas"), x("Passt fachlich", "Skills fit", "Les compétences conviennent"), x("Falsche Wahl", "Wrong pick", "Mauvais choix")));
  if (g.includes("agency")) out.push(P("chat", x("Vermittler passte nicht", "Agency wasn't right", "L'agence ne convenait pas"), x("Ein Partner, der passt", "A partner who fits", "Un partenaire qui convient"), x("Falscher Partner", "Wrong partner", "Mauvais partenaire")));
  if (f.leasing !== "0") out.push(P("money", x(`${LEASING_L[f.leasing].de} Leasingkräfte im Haus`, `${LEASING_L[f.leasing].en} agency nurses in-house`, `${LEASING_L[f.leasing].fr} intérimaires chez vous`), x("Eigene Leute statt Leasing", "Your own people, not agency", "Vos équipes au lieu de l'intérim"), x("Leasing", "Agency", "Intérim")));
  const tl = buildTimeline(f, today);
  if (tl.status === "late" || tl.status === "tight") out.push(P("calendar", x("Ihr Termin ist knapp", "Your date is tight", "Votre date est serrée"), x("Ein Termin, der hält", "A date that holds", "Une date qui tient"), x("Zeitdruck", "Time pressure", "Urgence")));
  if (!f.haben.includes("flat")) out.push(P("house", x("Noch keine Wohnung", "No flat yet", "Pas encore de logement"), x("Wohnung steht bereit", "The flat is ready", "Le logement est prêt"), x("Keine Wohnung", "No flat", "Pas de logement")));
  if (!f.haben.includes("mentor")) out.push(P("team", x("Niemand fest zuständig", "Nobody in charge of her", "Personne de référence"), x("Eine feste Ansprechperson", "One fixed contact", "Une personne de référence"), x("Allein gelassen", "Left alone", "Laissée seule")));
  if (!f.haben.includes("plan")) out.push(P("calendar", x("Kein Einarbeitungsplan", "No onboarding plan", "Pas de plan d'intégration"), x("90-Tage-Plan für jede", "A 90-day plan for each", "Un plan de 90 jours pour chacune"), x("Holpriger Start", "Bumpy start", "Départ chaotique")));
  if (f.erfahrung === "never") out.push(P("stairs", x("Noch nie aus dem Ausland", "Never hired from abroad", "Jamais recruté à l'étranger"), x("Die erste Gruppe läuft", "The first group is running", "Le premier groupe est lancé"), x("Neuland", "Uncharted", "Inconnu")));
  return out;
}

/** The before → after rows: their 4 biggest pains. */
export function beforeAfterFor(f: FormV2, today: Date): { ic: IconName; b: L; a: L }[] {
  return painsFor(f, today).slice(0, 4);
}

/** The bucket's leaks: up to 3 of their pains that make people (or time) run out. */
export function leaksFor(f: FormV2, today: Date): L[] {
  return painsFor(f, today).slice(1, 4).map((p) => p.leak);
}
