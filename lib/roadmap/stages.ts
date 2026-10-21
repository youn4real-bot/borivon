/**
 * One table per Stufe, the hospital version of the "constraint → to graduate"
 * stage tables (founder's Hormozi breakdown, 2026-10-21): a short profile, then
 * six areas of nurse staffing, each with what blocks the house and how it moves
 * up, then the bottom line. 5th-grade language, no invented statistics.
 */
import type { Level } from "./score";
import type { L } from "./content";

export const AREAS: { key: string; name: L }[] = [
  { key: "fill",    name: { de: "Stellen besetzen", en: "Filling posts", fr: "Pourvoir les postes" } },
  { key: "papers",  name: { de: "Deutsch & Papiere", en: "German & paperwork", fr: "Allemand & papiers" } },
  { key: "arrive",  name: { de: "Ankommen", en: "Settling in", fr: "S'installer" } },
  { key: "onboard", name: { de: "Einarbeitung", en: "Onboarding", fr: "Intégration" } },
  { key: "agency",  name: { de: "Leihkräfte & Kosten", en: "Agency staff & costs", fr: "Intérim & coûts" } },
  { key: "keep",    name: { de: "Bleiben & Messen", en: "Staying & measuring", fr: "Rester & mesurer" } },
];

export const PROFILE_ROWS: { key: "open" | "leave" | "agency" | "role"; name: L }[] = [
  { key: "open",   name: { de: "Offene Stellen", en: "Open posts", fr: "Postes vides" } },
  { key: "leave",  name: { de: "Kündigungen pro Jahr", en: "Leaving per year", fr: "Départs par an" } },
  { key: "agency", name: { de: "Leihkräfte", en: "Agency staff", fr: "Intérim" } },
  { key: "role",   name: { de: "Ihre Rolle", en: "Your role", fr: "Votre rôle" } },
];

type Stage = {
  profile: Record<"open" | "leave" | "agency" | "role", L>;
  rows: Record<string, { c: L; g: L }>;
  bottom: L;
  gradBy: L;
  story: L;
};

export const STAGES: Record<Level, Stage> = {
  1: {
    profile: {
      open: { de: "mehr als 1 von 10", en: "more than 1 in 10", fr: "plus de 1 sur 10" },
      leave: { de: "mehr als 1 von 5", en: "more than 1 in 5", fr: "plus de 1 sur 5" },
      agency: { de: "jeden Tag", en: "every day", fr: "tous les jours" },
      role: { de: "Feuerwehr", en: "Firefighter", fr: "Pompier" },
    },
    rows: {
      fill:    { c: { de: "Viele Stellen sind seit Monaten leer.", en: "Many posts have been empty for months.", fr: "Beaucoup de postes vides depuis des mois." }, g: { de: "Eine gute Quelle wählen, nicht fünf Agenturen.", en: "Pick one good source, not five agencies.", fr: "Choisir une bonne source, pas cinq agences." } },
      papers:  { c: { de: "Niemand kümmert sich um Anerkennung und Visum.", en: "Nobody handles recognition and visa.", fr: "Personne ne gère reconnaissance et visa." }, g: { de: "Eine Person oder Partner, der die Papiere jeden Tag macht.", en: "One person or partner who does the papers every day.", fr: "Une personne ou un partenaire qui gère les papiers chaque jour." } },
      arrive:  { c: { de: "Keine Wohnung, kein Plan für den ersten Tag.", en: "No flat, no plan for day one.", fr: "Pas de logement, pas de plan pour le premier jour." }, g: { de: "Wohnung und Abholung vor der Ankunft klären.", en: "Sort out the flat and pick-up before arrival.", fr: "Régler logement et accueil avant l'arrivée." } },
      onboard: { c: { de: "Neue werden sofort voll eingeplant.", en: "New nurses are put on the full rota at once.", fr: "Les nouvelles sont planifiées à plein tout de suite." }, g: { de: "Eine feste Patin für jede Neue.", en: "A fixed mentor for every new nurse.", fr: "Une marraine fixe pour chaque nouvelle." } },
      agency:  { c: { de: "Leihkräfte Schicht für Schicht, sehr teuer.", en: "Agency staff shift by shift, very costly.", fr: "Intérim garde par garde, très cher." }, g: { de: "Leihkräfte in festen Monatsblöcken buchen.", en: "Book agency staff in fixed monthly blocks.", fr: "Réserver l'intérim par blocs mensuels." } },
      keep:    { c: { de: "Sie wissen nicht, warum Leute gehen.", en: "You don't know why people leave.", fr: "Vous ne savez pas pourquoi on part." }, g: { de: "Offene Stellen jeden Monat aufschreiben.", en: "Write down open posts every month.", fr: "Noter les postes vides chaque mois." } },
    },
    bottom: { de: "Sie verlieren Geld und Leute, jeden Monat.", en: "You lose money and people, every month.", fr: "Vous perdez de l'argent et des gens, chaque mois." },
    gradBy: { de: "Die Blutung stoppen.", en: "Stop the bleeding.", fr: "Arrêter l'hémorragie." },
    story: { de: "Auf Stufe 1 rennen Sie jeden Tag Lücken hinterher. Das Team ist müde, und Leihkräfte fressen das Geld. Die gute Nachricht: Die ersten Schritte sind einfach, und sie wirken schnell.", en: "On level 1 you chase gaps every day. The team is tired and agency staff eat the money. The good news: the first steps are simple and they work fast.", fr: "Au niveau 1, vous courez après les trous chaque jour. L'équipe est épuisée et l'intérim mange l'argent. Bonne nouvelle : les premiers pas sont simples et agissent vite." },
  },
  2: {
    profile: {
      open: { de: "etwa 1 von 10", en: "about 1 in 10", fr: "environ 1 sur 10" },
      leave: { de: "etwa 1 von 6", en: "about 1 in 6", fr: "environ 1 sur 6" },
      agency: { de: "fast jeden Tag", en: "almost every day", fr: "presque tous les jours" },
      role: { de: "Lückenstopfer", en: "Gap filler", fr: "Bouche-trou" },
    },
    rows: {
      fill:    { c: { de: "Sie stellen einzeln ein, wenn es brennt.", en: "You hire one at a time, when there is a fire.", fr: "Vous recrutez une par une, dans l'urgence." }, g: { de: "In Gruppen von 3 bis 5 einstellen.", en: "Hire in groups of 3 to 5.", fr: "Recruter par groupes de 3 à 5." } },
      papers:  { c: { de: "Die Papiere dauern länger als gedacht.", en: "Paperwork takes longer than expected.", fr: "Les papiers prennent plus de temps que prévu." }, g: { de: "Vom Starttermin rückwärts planen.", en: "Plan backwards from the start date.", fr: "Planifier à rebours depuis la date de début." } },
      arrive:  { c: { de: "Ankommen hängt vom guten Willen Einzelner ab.", en: "Settling in depends on individual goodwill.", fr: "L'installation dépend de la bonne volonté de quelques-uns." }, g: { de: "Eine Checkliste für die Ankunft, jedes Mal gleich.", en: "One arrival checklist, the same every time.", fr: "Une check-list d'arrivée, toujours la même." } },
      onboard: { c: { de: "Einarbeitung je nachdem, wer Zeit hat.", en: "Onboarding depends on who has time.", fr: "L'intégration dépend de qui a le temps." }, g: { de: "Den 90-Tage-Plan für jede Neue nutzen.", en: "Use the 90-day plan for every new nurse.", fr: "Utiliser le plan de 90 jours pour chaque nouvelle." } },
      agency:  { c: { de: "Ohne Leihkräfte geht keine Woche.", en: "No week works without agency staff.", fr: "Aucune semaine sans intérim." }, g: { de: "Für jede neue Pflegekraft Leihstunden kündigen.", en: "Cancel agency hours for every new nurse.", fr: "Réduire l'intérim pour chaque nouvelle." } },
      keep:    { c: { de: "Manche bleiben, manche nicht, keiner weiß warum.", en: "Some stay, some don't, nobody knows why.", fr: "Certaines restent, d'autres non, sans savoir pourquoi." }, g: { de: "Messen: Wie viele schaffen die Probezeit?", en: "Measure: how many pass probation?", fr: "Mesurer : combien réussissent l'essai ?" } },
    },
    bottom: { de: "Sie zahlen viel Geld, nur um Lücken zu stopfen.", en: "You pay a lot just to fill gaps.", fr: "Vous payez cher juste pour boucher des trous." },
    gradBy: { de: "In Gruppen einstellen und rückwärts planen.", en: "Hire in groups and plan backwards.", fr: "Recruter en groupe et planifier à rebours." },
    story: { de: "Auf Stufe 2 läuft der Betrieb, aber nur dank Leihkräften und Überstunden. Sie stellen ein, aber einzeln und ohne Plan. Hier entscheidet sich, ob Sie weiter Lücken stopfen oder anfangen zu planen.", en: "On level 2 the house runs, but only thanks to agency staff and overtime. You hire, but one by one and without a plan. This is where you decide: keep filling gaps, or start planning.", fr: "Au niveau 2, la maison tourne, mais grâce à l'intérim et aux heures sup. Vous recrutez, mais une par une, sans plan. C'est ici que vous choisissez : boucher des trous ou commencer à planifier." },
  },
  3: {
    profile: {
      open: { de: "einige", en: "a few", fr: "quelques-uns" },
      leave: { de: "etwa 1 von 8", en: "about 1 in 8", fr: "environ 1 sur 8" },
      agency: { de: "regelmäßig", en: "regularly", fr: "régulièrement" },
      role: { de: "Verwalter", en: "Administrator", fr: "Gestionnaire" },
    },
    rows: {
      fill:    { c: { de: "Neue kommen, wenn es brennt, nicht nach Plan.", en: "New nurses come when there is a fire, not by plan.", fr: "Les nouvelles arrivent dans l'urgence, pas selon un plan." }, g: { de: "Jedes Quartal eine Gruppe, fest im Kalender.", en: "One group every quarter, fixed in the calendar.", fr: "Un groupe chaque trimestre, fixé au calendrier." } },
      papers:  { c: { de: "Jeder Fall wird neu erfunden.", en: "Every case is reinvented.", fr: "Chaque dossier est réinventé." }, g: { de: "Ein fester Ablauf und ein fester Partner.", en: "One fixed process and one fixed partner.", fr: "Un processus fixe et un partenaire fixe." } },
      arrive:  { c: { de: "Die Familie fehlt, das Heimweh bleibt.", en: "Family is missing, homesickness stays.", fr: "La famille manque, le mal du pays reste." }, g: { de: "Familiennachzug früh mitplanen.", en: "Plan bringing the family early.", fr: "Prévoir tôt le regroupement familial." } },
      onboard: { c: { de: "Patinnen sind überlastet.", en: "Mentors are overloaded.", fr: "Les marraines sont débordées." }, g: { de: "Patinnen Zeit geben: 2 Stunden pro Woche.", en: "Give mentors time: 2 hours a week.", fr: "Donner du temps aux marraines : 2 heures par semaine." } },
      agency:  { c: { de: "Leihkräfte sind fest eingeplant.", en: "Agency staff are part of the plan.", fr: "L'intérim fait partie du plan." }, g: { de: "Leihstunden im Tempo der Neuen abbauen.", en: "Cut agency hours at the pace of new hires.", fr: "Réduire l'intérim au rythme des arrivées." } },
      keep:    { c: { de: "Überraschungen beim Lohn führen zu Kündigungen.", en: "Payslip surprises lead to resignations.", fr: "Les surprises sur la paie font partir." }, g: { de: "Lohn und Zeitplan ehrlich und schriftlich.", en: "Pay and timeline honest and in writing.", fr: "Salaire et calendrier honnêtes et écrits." } },
    },
    bottom: { de: "Jede Kündigung kostet Sie wieder Leihkräfte.", en: "Every resignation costs you agency staff again.", fr: "Chaque départ vous coûte de nouveau de l'intérim." },
    gradBy: { de: "Fester Rhythmus statt Feuerwehr.", en: "A fixed rhythm instead of firefighting.", fr: "Un rythme fixe au lieu de l'urgence." },
    story: { de: "Auf Stufe 3 sind die meisten Stellen besetzt. Aber jedes Jahr gehen Leute, und jede Lücke kostet wieder Leihkräfte. Wer jetzt einen festen Rhythmus baut, spart jedes Jahr viel Geld.", en: "On level 3 most posts are filled. But people leave every year and every gap costs agency staff again. Building a fixed rhythm now saves a lot of money every year.", fr: "Au niveau 3, la plupart des postes sont pourvus. Mais des départs chaque année, et chaque trou coûte de l'intérim. Un rythme fixe maintenant fait économiser beaucoup chaque année." },
  },
  4: {
    profile: {
      open: { de: "kaum", en: "hardly any", fr: "presque aucun" },
      leave: { de: "weniger als 1 von 10", en: "fewer than 1 in 10", fr: "moins de 1 sur 10" },
      agency: { de: "nur für Spitzen", en: "only for peaks", fr: "seulement pour les pics" },
      role: { de: "Planer", en: "Planner", fr: "Planificateur" },
    },
    rows: {
      fill:    { c: { de: "Neue nur über bezahlte Wege.", en: "New nurses only through paid channels.", fr: "Les nouvelles seulement par des canaux payants." }, g: { de: "Prämie für Empfehlungen aus dem eigenen Team.", en: "A bonus for referrals from your own team.", fr: "Une prime pour les recommandations de l'équipe." } },
      papers:  { c: { de: "Läuft, aber hängt an einer Person.", en: "It works, but depends on one person.", fr: "Ça marche, mais dépend d'une personne." }, g: { de: "Ablauf aufschreiben, Vertretung einarbeiten.", en: "Write down the process, train a backup.", fr: "Écrire le processus, former un remplaçant." } },
      arrive:  { c: { de: "Die Neuen bleiben unter sich.", en: "New nurses stay among themselves.", fr: "Les nouvelles restent entre elles." }, g: { de: "Feste Paten aus dem Stammteam, gemeinsame Aktivitäten.", en: "Mentors from the core team, shared activities.", fr: "Marraines de l'équipe, activités communes." } },
      onboard: { c: { de: "Nach 90 Tagen hört die Begleitung auf.", en: "Support stops after 90 days.", fr: "L'accompagnement s'arrête après 90 jours." }, g: { de: "Karriereweg im ersten Jahr zeigen.", en: "Show a career path in year one.", fr: "Montrer un parcours dès la première année." } },
      agency:  { c: { de: "Leihkräfte nur noch für Spitzen.", en: "Agency staff only for peaks.", fr: "L'intérim seulement pour les pics." }, g: { de: "Einen eigenen Springer-Pool aufbauen.", en: "Build your own float pool.", fr: "Créer votre propre pool de remplaçantes." } },
      keep:    { c: { de: "Sie messen, aber selten.", en: "You measure, but rarely.", fr: "Vous mesurez, mais rarement." }, g: { de: "Drei Zahlen jedes Quartal: offen, gegangen, Leihstunden.", en: "Three numbers every quarter: open, left, agency hours.", fr: "Trois chiffres par trimestre : vides, départs, intérim." } },
    },
    bottom: { de: "Es läuft nach Plan, aber nur mit bezahlter Suche.", en: "It runs by plan, but only with paid hiring.", fr: "Tout suit le plan, mais seulement avec un recrutement payant." },
    gradBy: { de: "Ihre Leute holen Leute.", en: "Your people bring people.", fr: "Vos équipes font venir d'autres." },
    story: { de: "Auf Stufe 4 läuft es nach Plan. Neue kommen in Gruppen, haben Patinnen, und Leihkräfte sind die Ausnahme. Der nächste Schritt kommt von den Pflegekräften, die schon da sind.", en: "On level 4 things go by plan. New nurses come in groups, have mentors, and agency staff are rare. The next step comes from the nurses who are already there.", fr: "Au niveau 4, tout suit le plan. Les nouvelles arrivent en groupe, ont des marraines, et l'intérim est rare. La prochaine étape vient des infirmières déjà là." },
  },
  5: {
    profile: {
      open: { de: "fast keine", en: "almost none", fr: "presque aucun" },
      leave: { de: "sehr wenige", en: "very few", fr: "très peu" },
      agency: { de: "die Ausnahme", en: "the exception", fr: "l'exception" },
      role: { de: "Magnet", en: "Magnet", fr: "Aimant" },
    },
    rows: {
      fill:    { c: { de: "Bewerbungen kommen von selbst.", en: "Applications come by themselves.", fr: "Les candidatures arrivent seules." }, g: { de: "Rhythmus halten, auch in guten Zeiten.", en: "Keep the rhythm, also in good times.", fr: "Garder le rythme, même quand tout va bien." } },
      papers:  { c: { de: "Läuft wie ein Uhrwerk.", en: "Runs like clockwork.", fr: "Tourne comme une horloge." }, g: { de: "Neue Regeln früh kennen.", en: "Know new rules early.", fr: "Connaître tôt les nouvelles règles." } },
      arrive:  { c: { de: "Familien kommen nach und bleiben.", en: "Families follow and stay.", fr: "Les familles suivent et restent." }, g: { de: "Gemeinschaft pflegen.", en: "Look after the community.", fr: "Entretenir la communauté." } },
      onboard: { c: { de: "Ehemalige Neue sind heute Patinnen.", en: "Former newcomers are mentors today.", fr: "Les anciennes nouvelles sont marraines." }, g: { de: "Patinnen ausbilden und danken.", en: "Train and thank mentors.", fr: "Former et remercier les marraines." } },
      agency:  { c: { de: "Leihkräfte sind die Ausnahme.", en: "Agency staff are the exception.", fr: "L'intérim est l'exception." }, g: { de: "So bleibt es.", en: "Keep it that way.", fr: "Que ça reste ainsi." } },
      keep:    { c: { de: "Fast niemand geht.", en: "Almost nobody leaves.", fr: "Presque personne ne part." }, g: { de: "Jedes Quartal messen.", en: "Measure every quarter.", fr: "Mesurer chaque trimestre." } },
    },
    bottom: { de: "Ihr Ruf holt die Leute. Halten Sie ihn.", en: "Your name brings people in. Keep it that way.", fr: "Votre réputation attire. Gardez-la." },
    gradBy: { de: "Dranbleiben.", en: "Keep at it.", fr: "Persévérer." },
    story: { de: "Auf Stufe 5 sind Sie ein Ort, an dem Pflegekräfte arbeiten wollen. Ihre Aufgabe: das halten, was Sie aufgebaut haben.", en: "On level 5 you are a place nurses want to work. Your job: keep what you have built.", fr: "Au niveau 5, vous êtes un lieu où les infirmières veulent travailler. Votre travail : garder ce que vous avez construit." },
  },
};

export const STAGE_UI: Record<"de" | "en" | "fr", Record<string, string>> = {
  de: {
    whenYou: "Wenn Sie auf Stufe {n} sind", typical: "Typisch für Stufe {n}",
    bottom: "Unterm Strich", gradBy: "Aufsteigen durch",
    areasTitle: "Bereich für Bereich", areasSub: "Was Ihr Haus auf dieser Stufe bremst, und was Sie dagegen tun.",
    constraint: "Was bremst", graduate: "So steigen Sie auf",
    remember: "Merken", rememberTxt: "Fangen Sie nicht mit allen sechs Bereichen an. Nehmen Sie den, der am meisten brennt. Ihren größten Engpass finden Sie auf der nächsten Seite.",
    prev: "Diese Stufe haben Sie hinter sich", next: "Das kommt als Nächstes",
    wantNext: "Wollen Sie auf die nächste Stufe?",
    stuck: "Viele Häuser bleiben auf ihrer Stufe hängen. Nicht, weil sie es nicht können, sondern weil zu viel auf einmal brennt.",
  },
  en: {
    whenYou: "When you are on level {n}", typical: "Typical for level {n}",
    bottom: "Bottom line", gradBy: "Move up by",
    areasTitle: "Area by area", areasSub: "What holds your facility back on this level, and what you do about it.",
    constraint: "What holds you back", graduate: "How to move up",
    remember: "Remember", rememberTxt: "Don't start with all six areas. Pick the one that hurts most. Your biggest bottleneck is on the next page.",
    prev: "The level you have left behind", next: "What comes next",
    wantNext: "Do you want to reach the next level?",
    stuck: "Many facilities get stuck on their level. Not because they can't do it, but because too much is on fire at once.",
  },
  fr: {
    whenYou: "Quand vous êtes au niveau {n}", typical: "Typique du niveau {n}",
    bottom: "En résumé", gradBy: "Monter en",
    areasTitle: "Domaine par domaine", areasSub: "Ce qui freine votre établissement à ce niveau, et ce que vous pouvez faire.",
    constraint: "Ce qui bloque", graduate: "Comment monter",
    remember: "À retenir", rememberTxt: "Ne commencez pas par les six domaines. Prenez celui qui fait le plus mal. Votre plus gros blocage est à la page suivante.",
    prev: "Le niveau que vous avez dépassé", next: "Ce qui vient ensuite",
    wantNext: "Voulez-vous passer au niveau suivant ?",
    stuck: "Beaucoup d'établissements restent bloqués à leur niveau. Pas parce qu'ils n'y arrivent pas, mais parce que trop de choses brûlent en même temps.",
  },
};
