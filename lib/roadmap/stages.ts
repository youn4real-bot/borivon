/**
 * One table per Stufe, the hospital version of the "constraint → to graduate"
 * stage tables (founder's Hormozi breakdown, 2026-10-21): a short story, a
 * typical profile, six areas of nurse staffing (what blocks, what helps), then
 * the bottom line. Written so a 5-year-old could follow (founder, 2026-10-22).
 * No invented statistics.
 */
import type { Level } from "./score";
import type { L } from "./content";
import type { IconName } from "./icons";

export const AREAS: { key: string; name: L; icon: IconName }[] = [
  { key: "fill",    icon: "nurse",  name: { de: "Stellen besetzen", en: "Filling posts", fr: "Pourvoir les postes" } },
  { key: "papers",  icon: "papers", name: { de: "Deutsch & Papiere", en: "German & papers", fr: "Allemand & papiers" } },
  { key: "arrive",  icon: "house",  name: { de: "Ankommen", en: "Settling in", fr: "S'installer" } },
  { key: "onboard", icon: "team",   name: { de: "Einarbeitung", en: "Onboarding", fr: "Intégration" } },
  { key: "agency",  icon: "money",  name: { de: "Leihkräfte", en: "Agency staff", fr: "Intérim" } },
  { key: "keep",    icon: "heart",  name: { de: "Bleiben", en: "Staying", fr: "Rester" } },
];

export const PROFILE_ROWS: { key: "open" | "leave" | "agency" | "role"; name: L; icon: IconName }[] = [
  { key: "open",   icon: "bed",   name: { de: "Leere Stellen", en: "Empty posts", fr: "Postes vides" } },
  { key: "leave",  icon: "door",  name: { de: "Wer jedes Jahr geht", en: "Who leaves each year", fr: "Départs par an" } },
  { key: "agency", icon: "money", name: { de: "Leihkräfte", en: "Agency staff", fr: "Intérim" } },
  { key: "role",   icon: "nurse", name: { de: "Ihre Rolle", en: "Your role", fr: "Votre rôle" } },
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
      fill:    { c: { de: "Viele Stellen sind seit Monaten leer.", en: "Many posts are empty for months.", fr: "Des postes vides depuis des mois." }, g: { de: "Ein guter Partner. Nicht fünf Agenturen.", en: "One good partner. Not five agencies.", fr: "Un bon partenaire. Pas cinq agences." } },
      papers:  { c: { de: "Niemand kümmert sich um die Papiere.", en: "Nobody looks after the papers.", fr: "Personne ne gère les papiers." }, g: { de: "Eine Person macht die Papiere. Jeden Tag.", en: "One person does the papers. Every day.", fr: "Une personne gère les papiers. Chaque jour." } },
      arrive:  { c: { de: "Keine Wohnung. Kein Plan.", en: "No flat. No plan.", fr: "Pas de logement. Pas de plan." }, g: { de: "Wohnung und Abholen vorher klären.", en: "Sort out flat and pick-up first.", fr: "Régler logement et accueil avant." } },
      onboard: { c: { de: "Neue arbeiten sofort voll.", en: "New nurses work full shifts at once.", fr: "Les nouvelles travaillent à plein tout de suite." }, g: { de: "Jede Neue bekommt eine Patin.", en: "Every new nurse gets a mentor.", fr: "Chaque nouvelle a une marraine." } },
      agency:  { c: { de: "Leihkräfte jeden Tag. Sehr teuer.", en: "Agency staff every day. Very costly.", fr: "Intérim tous les jours. Très cher." }, g: { de: "Leihkräfte für ganze Monate buchen.", en: "Book agency staff for whole months.", fr: "Réserver l'intérim au mois." } },
      keep:    { c: { de: "Sie wissen nicht, warum Leute gehen.", en: "You don't know why people leave.", fr: "Vous ne savez pas pourquoi on part." }, g: { de: "Jeden Monat leere Stellen zählen.", en: "Count empty posts every month.", fr: "Compter les postes vides chaque mois." } },
    },
    bottom: { de: "Sie verlieren Geld und Leute. Jeden Monat.", en: "You lose money and people. Every month.", fr: "Vous perdez de l'argent et des gens. Chaque mois." },
    gradBy: { de: "Erst mal kein Geld mehr verlieren.", en: "First, stop losing money.", fr: "D'abord, arrêter de perdre de l'argent." },
    story: { de: "Jeden Tag fehlen Leute. Das Team ist müde. Leihkräfte kosten viel Geld. Die gute Nachricht: Die ersten Schritte sind leicht. Und sie helfen schnell.", en: "People are missing every day. The team is tired. Agency staff cost a lot. The good news: the first steps are easy. And they help fast.", fr: "Il manque du monde chaque jour. L'équipe est fatiguée. L'intérim coûte cher. La bonne nouvelle : les premiers pas sont simples. Et ils aident vite." },
  },
  2: {
    profile: {
      open: { de: "etwa 1 von 10", en: "about 1 in 10", fr: "environ 1 sur 10" },
      leave: { de: "etwa 1 von 6", en: "about 1 in 6", fr: "environ 1 sur 6" },
      agency: { de: "fast jeden Tag", en: "almost every day", fr: "presque tous les jours" },
      role: { de: "Lückenstopfer", en: "Gap filler", fr: "Bouche-trou" },
    },
    rows: {
      fill:    { c: { de: "Sie stellen eine nach der anderen ein.", en: "You hire one at a time.", fr: "Vous recrutez une par une." }, g: { de: "3 bis 5 auf einmal holen.", en: "Bring 3 to 5 at once.", fr: "En faire venir 3 à 5 à la fois." } },
      papers:  { c: { de: "Papiere dauern länger als gedacht.", en: "Papers take longer than you thought.", fr: "Les papiers prennent plus de temps que prévu." }, g: { de: "Vom ersten Arbeitstag rückwärts planen.", en: "Plan back from the first work day.", fr: "Planifier à rebours depuis le premier jour." } },
      arrive:  { c: { de: "Ankommen klappt mal gut, mal nicht.", en: "Settling in works sometimes.", fr: "L'arrivée marche une fois sur deux." }, g: { de: "Eine Liste für die Ankunft. Jedes Mal gleich.", en: "One arrival list. The same every time.", fr: "Une liste d'arrivée. Toujours la même." } },
      onboard: { c: { de: "Einarbeitung, wenn jemand Zeit hat.", en: "Onboarding when someone has time.", fr: "Intégration quand quelqu'un a le temps." }, g: { de: "Den 90-Tage-Plan für jede Neue.", en: "The 90-day plan for every new nurse.", fr: "Le plan de 90 jours pour chaque nouvelle." } },
      agency:  { c: { de: "Ohne Leihkräfte geht keine Woche.", en: "No week works without agency staff.", fr: "Aucune semaine sans intérim." }, g: { de: "Für jede Neue: Leihstunden kündigen.", en: "For every new nurse: cancel agency hours.", fr: "Pour chaque nouvelle : moins d'intérim." } },
      keep:    { c: { de: "Manche bleiben. Keiner weiß, warum.", en: "Some stay. Nobody knows why.", fr: "Certaines restent. Personne ne sait pourquoi." }, g: { de: "Zählen: Wer schafft die Probezeit?", en: "Count: who passes probation?", fr: "Compter : qui réussit l'essai ?" } },
    },
    bottom: { de: "Sie zahlen viel Geld, nur um Löcher zu stopfen.", en: "You pay a lot just to plug holes.", fr: "Vous payez cher juste pour boucher des trous." },
    gradBy: { de: "In Gruppen holen. Rückwärts planen.", en: "Hire in groups. Plan backwards.", fr: "Recruter en groupe. Planifier à rebours." },
    story: { de: "Der Betrieb läuft. Aber nur mit Leihkräften und Überstunden. Sie stellen ein, aber eine nach der anderen. Jetzt ist die Zeit für einen Plan.", en: "The house runs. But only with agency staff and overtime. You hire, but one at a time. Now is the time for a plan.", fr: "La maison tourne. Mais seulement avec l'intérim et les heures sup. Vous recrutez, mais une par une. C'est le moment d'avoir un plan." },
  },
  3: {
    profile: {
      open: { de: "einige", en: "a few", fr: "quelques-uns" },
      leave: { de: "etwa 1 von 8", en: "about 1 in 8", fr: "environ 1 sur 8" },
      agency: { de: "oft", en: "often", fr: "souvent" },
      role: { de: "Verwalter", en: "Manager", fr: "Gestionnaire" },
    },
    rows: {
      fill:    { c: { de: "Neue kommen erst, wenn es brennt.", en: "New nurses only come when there is a fire.", fr: "Les nouvelles n'arrivent qu'en urgence." }, g: { de: "Jedes Quartal eine Gruppe. Fest im Kalender.", en: "A group every quarter. In the calendar.", fr: "Un groupe par trimestre. Au calendrier." } },
      papers:  { c: { de: "Jedes Mal fangen Sie von vorne an.", en: "Every time you start from zero.", fr: "Chaque fois, vous repartez de zéro." }, g: { de: "Ein fester Ablauf. Ein fester Partner.", en: "One fixed process. One fixed partner.", fr: "Un processus fixe. Un partenaire fixe." } },
      arrive:  { c: { de: "Die Familie fehlt. Das Heimweh bleibt.", en: "Family is far. Homesickness stays.", fr: "La famille manque. Le mal du pays reste." }, g: { de: "Die Familie früh mitplanen.", en: "Plan for the family early.", fr: "Prévoir tôt la famille." } },
      onboard: { c: { de: "Die Patinnen haben keine Zeit.", en: "Mentors have no time.", fr: "Les marraines n'ont pas le temps." }, g: { de: "Patinnen bekommen 2 Stunden pro Woche.", en: "Mentors get 2 hours a week.", fr: "Les marraines ont 2 heures par semaine." } },
      agency:  { c: { de: "Leihkräfte sind fest eingeplant.", en: "Agency staff are part of the plan.", fr: "L'intérim fait partie du plan." }, g: { de: "Leihstunden abbauen, Schritt für Schritt.", en: "Cut agency hours, step by step.", fr: "Réduire l'intérim, pas à pas." } },
      keep:    { c: { de: "Überraschungen beim Lohn. Dann gehen Leute.", en: "Pay surprises. Then people leave.", fr: "Surprises sur la paie. Puis départs." }, g: { de: "Lohn ehrlich und schriftlich.", en: "Pay, honest and in writing.", fr: "Salaire honnête, par écrit." } },
    },
    bottom: { de: "Jede Kündigung kostet Sie wieder Leihkräfte.", en: "Every resignation costs you agency staff again.", fr: "Chaque départ vous coûte de nouveau de l'intérim." },
    gradBy: { de: "Ein fester Rhythmus statt Feuerwehr.", en: "A fixed rhythm instead of firefighting.", fr: "Un rythme fixe au lieu de l'urgence." },
    story: { de: "Fast alles ist besetzt. Aber jedes Jahr gehen Leute. Jede Lücke kostet wieder Leihkräfte. Mit einem festen Rhythmus sparen Sie viel Geld.", en: "Almost everything is filled. But people leave every year. Every gap costs agency staff again. A fixed rhythm saves you a lot of money.", fr: "Presque tout est pourvu. Mais des gens partent chaque année. Chaque trou coûte de nouveau de l'intérim. Un rythme fixe vous fait économiser beaucoup." },
  },
  4: {
    profile: {
      open: { de: "kaum", en: "hardly any", fr: "presque aucun" },
      leave: { de: "weniger als 1 von 10", en: "fewer than 1 in 10", fr: "moins de 1 sur 10" },
      agency: { de: "nur selten", en: "only now and then", fr: "rarement" },
      role: { de: "Planer", en: "Planner", fr: "Planificateur" },
    },
    rows: {
      fill:    { c: { de: "Neue nur über bezahlte Suche.", en: "New nurses only through paid search.", fr: "Les nouvelles seulement par recrutement payant." }, g: { de: "Prämie, wenn Ihr Team Freunde holt.", en: "A bonus when your team brings friends.", fr: "Une prime quand l'équipe amène des amies." } },
      papers:  { c: { de: "Klappt. Aber nur mit einer Person.", en: "It works. But only with one person.", fr: "Ça marche. Mais avec une seule personne." }, g: { de: "Aufschreiben. Eine Vertretung einarbeiten.", en: "Write it down. Train a backup.", fr: "L'écrire. Former un remplaçant." } },
      arrive:  { c: { de: "Die Neuen bleiben unter sich.", en: "New nurses stay among themselves.", fr: "Les nouvelles restent entre elles." }, g: { de: "Gemeinsam etwas machen. Mit dem ganzen Team.", en: "Do things together. With the whole team.", fr: "Faire des choses ensemble. Avec toute l'équipe." } },
      onboard: { c: { de: "Nach 90 Tagen hört die Hilfe auf.", en: "Help stops after 90 days.", fr: "L'aide s'arrête après 90 jours." }, g: { de: "Im ersten Jahr einen Weg nach oben zeigen.", en: "Show a way up in year one.", fr: "Montrer une évolution dès la première année." } },
      agency:  { c: { de: "Leihkräfte nur noch für Spitzen.", en: "Agency staff only for busy times.", fr: "L'intérim seulement pour les pics." }, g: { de: "Eigene Springer aufbauen.", en: "Build your own float team.", fr: "Créer vos propres remplaçantes." } },
      keep:    { c: { de: "Sie zählen, aber selten.", en: "You count, but rarely.", fr: "Vous comptez, mais rarement." }, g: { de: "Drei Zahlen, jedes Quartal.", en: "Three numbers, every quarter.", fr: "Trois chiffres, chaque trimestre." } },
    },
    bottom: { de: "Es läuft nach Plan. Aber nur mit bezahlter Suche.", en: "It runs by plan. But only with paid hiring.", fr: "Tout suit le plan. Mais seulement avec un recrutement payant." },
    gradBy: { de: "Ihre Leute holen Leute.", en: "Your people bring people.", fr: "Vos équipes font venir d'autres." },
    story: { de: "Es läuft nach Plan. Neue kommen in Gruppen. Sie haben Patinnen. Leihkräfte sind selten. Der nächste Schritt kommt von Ihren eigenen Leuten.", en: "Things run by plan. New nurses come in groups. They have mentors. Agency staff are rare. The next step comes from your own people.", fr: "Tout suit le plan. Les nouvelles arrivent en groupe. Elles ont des marraines. L'intérim est rare. La prochaine étape vient de vos équipes." },
  },
  5: {
    profile: {
      open: { de: "fast keine", en: "almost none", fr: "presque aucun" },
      leave: { de: "sehr wenige", en: "very few", fr: "très peu" },
      agency: { de: "fast nie", en: "almost never", fr: "presque jamais" },
      role: { de: "Magnet", en: "Magnet", fr: "Aimant" },
    },
    rows: {
      fill:    { c: { de: "Bewerbungen kommen von allein.", en: "Applications come by themselves.", fr: "Les candidatures arrivent seules." }, g: { de: "Rhythmus halten. Auch in guten Zeiten.", en: "Keep the rhythm. Also in good times.", fr: "Garder le rythme. Même quand tout va bien." } },
      papers:  { c: { de: "Läuft wie ein Uhrwerk.", en: "Runs like clockwork.", fr: "Tourne comme une horloge." }, g: { de: "Neue Regeln früh kennen.", en: "Know new rules early.", fr: "Connaître tôt les nouvelles règles." } },
      arrive:  { c: { de: "Familien kommen nach. Und bleiben.", en: "Families follow. And stay.", fr: "Les familles suivent. Et restent." }, g: { de: "Die Gemeinschaft pflegen.", en: "Look after the community.", fr: "Entretenir la communauté." } },
      onboard: { c: { de: "Frühere Neue sind heute Patinnen.", en: "Former newcomers are mentors now.", fr: "Les anciennes nouvelles sont marraines." }, g: { de: "Patinnen ausbilden. Und danken.", en: "Train mentors. And thank them.", fr: "Former les marraines. Et les remercier." } },
      agency:  { c: { de: "Leihkräfte fast nie.", en: "Agency staff almost never.", fr: "L'intérim presque jamais." }, g: { de: "So bleibt es.", en: "Keep it that way.", fr: "Que ça reste ainsi." } },
      keep:    { c: { de: "Fast niemand geht.", en: "Almost nobody leaves.", fr: "Presque personne ne part." }, g: { de: "Jedes Quartal zählen.", en: "Count every quarter.", fr: "Compter chaque trimestre." } },
    },
    bottom: { de: "Ihr guter Ruf holt die Leute. Halten Sie ihn.", en: "Your good name brings people. Keep it.", fr: "Votre réputation attire. Gardez-la." },
    gradBy: { de: "Dranbleiben.", en: "Keep at it.", fr: "Persévérer." },
    story: { de: "Pflegekräfte wollen zu Ihnen. Und sie bleiben. Ihre Aufgabe: Das so halten.", en: "Nurses want to work for you. And they stay. Your job: keep it that way.", fr: "Les infirmières veulent venir. Et elles restent. Votre travail : que ça dure." },
  },
};

export const STAGE_UI: Record<"de" | "en" | "fr", Record<string, string>> = {
  de: {
    whenYou: "Das ist Stufe {n}.", typical: "So sieht Stufe {n} oft aus",
    bottom: "Unterm Strich", gradBy: "So kommen Sie weiter",
    areasTitle: "Bereich für Bereich", areasSub: "Was bremst. Und was hilft.",
    constraint: "Was bremst", graduate: "Was hilft",
    remember: "Merken", rememberTxt: "Nicht alles auf einmal. Fangen Sie mit dem an, was am meisten weh tut.",
    prev: "Geschafft", next: "Als Nächstes", aroundTitle: "Davor und danach.",
    wantNext: "Wollen Sie auf die nächste Stufe?", wantStay: "Wollen Sie oben bleiben?",
    stuck: "Viele Häuser bleiben auf ihrer Stufe stecken. Nicht, weil sie es nicht können. Sondern weil zu viel auf einmal brennt.",
    fitLine: "Wir arbeiten pro Runde mit höchstens 10 Häusern. In 15 Minuten prüfen wir, ob Ihr Haus passt.",
  },
  en: {
    whenYou: "This is level {n}.", typical: "What level {n} often looks like",
    bottom: "Bottom line", gradBy: "How to move up",
    areasTitle: "Area by area", areasSub: "What holds you back. And what helps.",
    constraint: "What holds you back", graduate: "What helps",
    remember: "Remember", rememberTxt: "Not everything at once. Start with what hurts most.",
    prev: "Done", next: "Up next", aroundTitle: "Before and after.",
    wantNext: "Do you want to reach the next level?", wantStay: "Do you want to stay on top?",
    stuck: "Many facilities get stuck on their level. Not because they can't do it. But because too much is on fire at once.",
    fitLine: "We work with at most 10 employers per group. In 15 minutes we check if your facility is a fit.",
  },
  fr: {
    whenYou: "Voici le niveau {n}.", typical: "Le niveau {n}, souvent",
    bottom: "En résumé", gradBy: "Pour monter",
    areasTitle: "Domaine par domaine", areasSub: "Ce qui freine. Et ce qui aide.",
    constraint: "Ce qui freine", graduate: "Ce qui aide",
    remember: "À retenir", rememberTxt: "Pas tout à la fois. Commencez par ce qui fait le plus mal.",
    prev: "Réussi", next: "Ensuite", aroundTitle: "Avant et après.",
    wantNext: "Voulez-vous passer au niveau suivant ?", wantStay: "Voulez-vous rester au sommet ?",
    stuck: "Beaucoup d'établissements restent bloqués à leur niveau. Pas parce qu'ils n'y arrivent pas. Mais parce que trop de choses brûlent à la fois.",
    fitLine: "Nous travaillons avec 10 employeurs au maximum par groupe. En 15 minutes, nous vérifions si votre établissement correspond.",
  },
};
