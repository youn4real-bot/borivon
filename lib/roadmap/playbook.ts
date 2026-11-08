/**
 * The tactical part of the Fahrplan (founder 2026-11-08: "like the ACQ roadmap:
 * here's the constraint, here's exactly what you do"). Per Stufe:
 *   areas   · per area 2 problems (what you see) + 3 actions (what you do now)
 *   success · 4 blocks, 4 concrete steps each = how you graduate to the next Stufe
 * Short sentences, imperative, no theory. Only facts that are true in Germany
 * (Anerkennung, Kenntnisprüfung/Anpassungslehrgang, § 81a AufenthG). No numbers
 * we cannot back up.
 */
import type { L } from "./content";
import type { Level } from "./score";

type Area = { p: L[]; a: L[] };
export type Play = { areas: Record<"fill" | "papers" | "arrive" | "onboard" | "agency" | "keep", Area>; success: { t: L; items: L[] }[] };
const x = (de: string, en: string, fr: string): L => ({ de, en, fr });

export const PLAYBOOK: Record<Level, Play> = {
  // ── Stufe 1 · Notbetrieb ─────────────────────────────────────────────────
  1: {
    areas: {
      fill: {
        p: [x("Stellen sind seit Monaten leer.", "Posts have been empty for months.", "Des postes sont vides depuis des mois."),
            x("Sie sprechen mit vielen Agenturen. Keine liefert.", "You talk to many agencies. None delivers.", "Vous parlez à beaucoup d'agences. Aucune ne livre.")],
        a: [x("Schreiben Sie jede offene Stelle auf: Wohnbereich, Schicht, ab wann.", "Write down every open post: unit, shift, from when.", "Notez chaque poste vacant : unité, horaire, à partir de quand."),
            x("Wählen Sie EINEN Partner für Pflegekräfte aus dem Ausland. Stoppen Sie den Rest.", "Pick ONE partner for nurses from abroad. Stop the rest.", "Choisissez UN seul partenaire pour l'étranger. Arrêtez les autres."),
            x("Blocken Sie jede Woche 30 Minuten, um Profile zu prüfen.", "Block 30 minutes every week to review profiles.", "Bloquez 30 minutes par semaine pour lire les profils.")],
      },
      papers: {
        p: [x("Niemand weiß, wo die Anerkennung gerade steht.", "Nobody knows where the recognition stands.", "Personne ne sait où en est la reconnaissance."),
            x("Unterlagen liegen wochenlang bei Ämtern.", "Documents sit at offices for weeks.", "Les dossiers dorment des semaines dans les administrations.")],
        a: [x("Bestimmen Sie EINE Person im Haus für alle Papiere.", "Name ONE person in the house for all papers.", "Désignez UNE personne pour tous les papiers."),
            x("Nutzen Sie das beschleunigte Fachkräfteverfahren (§ 81a AufenthG). Das spart Monate.", "Use the fast-track procedure for skilled workers (§ 81a AufenthG). It saves months.", "Utilisez la procédure accélérée (§ 81a AufenthG). Elle fait gagner des mois."),
            x("Führen Sie eine Liste: jede Pflegekraft, jeder Schritt, jedes Datum.", "Keep one list: every nurse, every step, every date.", "Tenez une liste : chaque infirmière, chaque étape, chaque date.")],
      },
      arrive: {
        p: [x("Die Neue kommt an, aber es gibt keine Wohnung.", "The new nurse arrives, but there is no flat.", "La nouvelle arrive, mais il n'y a pas de logement."),
            x("Niemand holt sie ab.", "Nobody picks her up.", "Personne ne vient la chercher.")],
        a: [x("Klären Sie die Wohnung, bevor das Visum da ist.", "Sort out the flat before the visa arrives.", "Réglez le logement avant l'arrivée du visa."),
            x("Bestimmen Sie, wer sie am Flughafen oder Bahnhof abholt.", "Decide who picks her up at the airport or station.", "Décidez qui la récupère à l'aéroport ou à la gare."),
            x("Legen Sie Bettwäsche, Essen und eine SIM-Karte bereit.", "Have bedding, food and a SIM card ready.", "Préparez draps, nourriture et une carte SIM.")],
      },
      onboard: {
        p: [x("Neue arbeiten ab Tag 1 voll mit.", "New nurses work full shifts from day 1.", "Les nouvelles travaillent à plein dès le jour 1."),
            x("Keiner hat Zeit, ihr etwas zu zeigen.", "Nobody has time to show her anything.", "Personne n'a le temps de lui montrer.")],
        a: [x("Geben Sie jeder Neuen eine feste Patin.", "Give every new nurse one fixed mentor.", "Donnez à chaque nouvelle une marraine fixe."),
            x("Die ersten 2 Wochen: nur mitlaufen, nie allein.", "First 2 weeks: shadow only, never alone.", "2 premières semaines : en binôme, jamais seule."),
            x("Planen Sie die Patin im Dienstplan ein. Nicht obendrauf.", "Put the mentor into the rota. Not on top.", "Mettez la marraine dans le planning. Pas en plus.")],
      },
      agency: {
        p: [x("Leihkräfte kommen jeden Tag. Jeden Tag andere.", "Agency staff come every day. Different ones every day.", "L'intérim vient chaque jour. Chaque jour d'autres."),
            x("Die Rechnung steigt jeden Monat.", "The bill grows every month.", "La facture monte chaque mois.")],
        a: [x("Zählen Sie die Leihstunden. Jeden Monat.", "Count agency hours. Every month.", "Comptez les heures d'intérim. Chaque mois."),
            x("Buchen Sie Leihkräfte für ganze Monate, nicht für einzelne Schichten.", "Book agency staff for whole months, not single shifts.", "Réservez l'intérim au mois, pas à la garde."),
            x("Setzen Sie ein Ziel: wie viele Stunden weniger in 6 Monaten.", "Set a target: how many hours fewer in 6 months.", "Fixez un objectif : combien d'heures en moins dans 6 mois.")],
      },
      keep: {
        p: [x("Leute gehen, und Sie wissen nicht, warum.", "People leave and you don't know why.", "Des gens partent et vous ne savez pas pourquoi."),
            x("Kündigungen kommen als Überraschung.", "Resignations come as a surprise.", "Les démissions tombent par surprise.")],
        a: [x("Führen Sie mit jedem, der geht, ein Gespräch: Warum?", "Talk to everyone who leaves: why?", "Parlez à chaque personne qui part : pourquoi ?"),
            x("Schreiben Sie die Gründe auf. Nach 3 Gesprächen sehen Sie ein Muster.", "Write the reasons down. After 3 talks you see a pattern.", "Notez les raisons. Après 3 entretiens, un schéma apparaît."),
            x("Fragen Sie Ihr Team einmal im Monat: Was nervt am meisten?", "Ask your team once a month: what annoys you most?", "Demandez une fois par mois : qu'est-ce qui gêne le plus ?")],
      },
    },
    success: [
      { t: x("Den Geldverlust stoppen", "Stop losing money", "Arrêter de perdre de l'argent"), items: [
        x("Alle offenen Stellen auf einer Liste", "All open posts on one list", "Tous les postes vacants sur une liste"),
        x("Die teuerste Stelle zuerst besetzen", "Fill the most costly post first", "Pourvoir d'abord le poste le plus cher"),
        x("Leihstunden jeden Monat zählen", "Count agency hours every month", "Compter l'intérim chaque mois"),
        x("Ein Ziel für weniger Leihstunden setzen", "Set a target for fewer agency hours", "Fixer un objectif de moins d'intérim")] },
      { t: x("Einen Partner wählen", "Choose one partner", "Choisir un partenaire"), items: [
        x("Einen Partner statt fünf Agenturen", "One partner instead of five agencies", "Un partenaire au lieu de cinq agences"),
        x("Fragen: Wer prüft das Deutsch, und wie?", "Ask: who checks the German, and how?", "Demander : qui vérifie l'allemand, et comment ?"),
        x("Fragen: Wer macht Anerkennung und Visum?", "Ask: who handles recognition and visa?", "Demander : qui gère reconnaissance et visa ?"),
        x("Fragen: Was passiert, wenn sie in der Probezeit geht?", "Ask: what if she leaves during probation?", "Demander : et si elle part pendant l'essai ?")] },
      { t: x("Den Start vorbereiten", "Prepare the start", "Préparer l'arrivée"), items: [
        x("Wohnung klären", "Sort out the flat", "Régler le logement"),
        x("Abholen klären", "Sort out the pick-up", "Organiser l'accueil"),
        x("Eine Patin bestimmen", "Name a mentor", "Désigner une marraine"),
        x("Dienstplan für die ersten 2 Wochen schreiben", "Write the rota for the first 2 weeks", "Écrire le planning des 2 premières semaines")] },
      { t: x("Wissen, warum Leute gehen", "Know why people leave", "Savoir pourquoi on part"), items: [
        x("Gespräch mit jedem, der geht", "A talk with everyone who leaves", "Un entretien avec chaque départ"),
        x("Gründe aufschreiben", "Write the reasons down", "Noter les raisons"),
        x("Einmal im Monat das Team fragen", "Ask the team once a month", "Interroger l'équipe chaque mois"),
        x("Den häufigsten Grund zuerst lösen", "Fix the most common reason first", "Régler d'abord la raison la plus fréquente")] },
    ],
  },

  // ── Stufe 2 · Lückenfüller ───────────────────────────────────────────────
  2: {
    areas: {
      fill: {
        p: [x("Sie stellen ein, aber immer nur eine nach der anderen.", "You hire, but always one at a time.", "Vous recrutez, mais toujours une par une."),
            x("Jede Stelle ist ein neuer Kampf.", "Every post is a new fight.", "Chaque poste est un nouveau combat.")],
        a: [x("Holen Sie 3 bis 5 Pflegekräfte auf einmal, als Gruppe.", "Bring 3 to 5 nurses at once, as a group.", "Faites venir 3 à 5 infirmières à la fois, en groupe."),
            x("Planen Sie rückwärts: Wann brauchen Sie wen?", "Plan backwards: when do you need whom?", "Planifiez à rebours : qui, et quand ?"),
            x("Legen Sie fest, wer im Haus die Gespräche führt.", "Decide who in the house does the interviews.", "Décidez qui mène les entretiens.")],
      },
      papers: {
        p: [x("Papiere dauern länger als gedacht.", "Papers take longer than planned.", "Les papiers prennent plus de temps que prévu."),
            x("Kenntnisprüfung oder Anpassungslehrgang kommen überraschend.", "The knowledge exam or adaptation course comes as a surprise.", "L'examen ou le stage d'adaptation arrive par surprise.")],
        a: [x("Planen Sie vom ersten Arbeitstag rückwärts.", "Plan backwards from the first working day.", "Planifiez à rebours depuis le premier jour."),
            x("Klären Sie früh: Kenntnisprüfung oder Anpassungslehrgang?", "Settle early: knowledge exam or adaptation course?", "Décidez tôt : examen ou stage d'adaptation ?"),
            x("Bis zur Anerkennung: Einsatz als Pflegehilfskraft, mit Plan.", "Until recognition: work as a care assistant, with a plan.", "Jusqu'à la reconnaissance : aide-soignante, avec un plan.")],
      },
      arrive: {
        p: [x("Ankommen klappt mal gut, mal nicht.", "Arrival works sometimes, sometimes not.", "L'arrivée marche parfois, parfois non."),
            x("Jedes Mal fangen Sie bei null an.", "Every time you start from zero.", "À chaque fois, vous repartez de zéro.")],
        a: [x("Schreiben Sie eine Ankunfts-Liste. Für jede Neue dieselbe.", "Write one arrival checklist. The same for everyone.", "Écrivez une liste d'arrivée. La même pour toutes."),
            x("Eine Person ist für das Ankommen verantwortlich.", "One person owns the arrival.", "Une personne est responsable de l'arrivée."),
            x("Bank, Amt und Krankenkasse in Woche 1 einplanen.", "Plan bank, registration office and health insurance in week 1.", "Banque, mairie et assurance maladie en semaine 1.")],
      },
      onboard: {
        p: [x("Einarbeitung, wenn jemand Zeit hat.", "Onboarding when someone has time.", "L'intégration, quand quelqu'un a le temps."),
            x("Jede Patin macht es anders.", "Every mentor does it differently.", "Chaque marraine fait autrement.")],
        a: [x("Nutzen Sie den 90-Tage-Plan für jede Neue.", "Use the 90-day plan for every new nurse.", "Utilisez le plan de 90 jours pour chaque nouvelle."),
            x("Jede Woche 10 Minuten: Neue und Patin sprechen.", "Every week 10 minutes: new nurse and mentor talk.", "Chaque semaine 10 minutes : nouvelle et marraine parlent."),
            x("Zeigen Sie die Pflegedoku an echten Beispielen.", "Show the care notes with real examples.", "Montrez le dossier de soins avec de vrais exemples.")],
      },
      agency: {
        p: [x("Ohne Leihkräfte geht keine Woche.", "No week works without agency staff.", "Aucune semaine sans intérim."),
            x("Leihkräfte verdienen mehr als Ihr Team. Das gibt Ärger.", "Agency staff earn more than your team. That causes trouble.", "L'intérim gagne plus que votre équipe. Ça crée des tensions.")],
        a: [x("Kündigen Sie für jede Neue, die bleibt, Leihstunden.", "Cancel agency hours for every new nurse who stays.", "Annulez des heures d'intérim pour chaque nouvelle qui reste."),
            x("Rechnen Sie: Was kostet eine Leihkraft im Jahr, was eine eigene?", "Do the maths: agency nurse per year vs your own.", "Calculez : intérim par an contre infirmière à vous."),
            x("Leihkräfte nur noch für Spitzen.", "Agency staff only for peaks.", "L'intérim seulement pour les pics.")],
      },
      keep: {
        p: [x("Manche Neue bleiben. Manche nicht. Keiner weiß, warum.", "Some new nurses stay. Some don't. Nobody knows why.", "Certaines restent. D'autres non. Personne ne sait pourquoi."),
            x("Die Familie fehlt, das Heimweh ist groß.", "Family is far away, homesickness is big.", "La famille manque, le mal du pays est fort.")],
        a: [x("Zählen Sie: Wer schafft die Probezeit, wer nicht?", "Count: who passes probation, who doesn't?", "Comptez : qui passe l'essai, qui non ?"),
            x("Holen Sie Pflegekräfte in Gruppen. Zusammen bleiben sie eher.", "Bring nurses in groups. Together they stay.", "Faites venir en groupe. Ensemble, elles restent."),
            x("Fragen Sie nach Monat 1, 3 und 6: Wie geht es dir?", "Ask after month 1, 3 and 6: how are you?", "Demandez au mois 1, 3 et 6 : comment ça va ?")],
      },
    },
    success: [
      { t: x("In Gruppen holen", "Bring nurses in groups", "Recruter en groupes"), items: [
        x("3 bis 5 Pflegekräfte auf einmal", "3 to 5 nurses at once", "3 à 5 infirmières à la fois"),
        x("Feste Termine im Jahr", "Fixed dates in the year", "Des dates fixes dans l'année"),
        x("Ein Partner für alles", "One partner for everything", "Un partenaire pour tout"),
        x("Eine Ansprechperson im Haus", "One contact person in the house", "Un interlocuteur dans la maison")] },
      { t: x("Rückwärts planen", "Plan backwards", "Planifier à rebours"), items: [
        x("Den ersten Arbeitstag festlegen", "Fix the first working day", "Fixer le premier jour de travail"),
        x("Anerkennung und Visum rückwärts planen", "Plan recognition and visa backwards", "Planifier reconnaissance et visa à rebours"),
        x("Kenntnisprüfung oder Lehrgang früh klären", "Settle exam or course early", "Régler tôt examen ou stage"),
        x("Bis zur Anerkennung: Pflegehilfskraft mit Plan", "Until recognition: care assistant with a plan", "Jusqu'à la reconnaissance : aide-soignante avec un plan")] },
      { t: x("Gleicher Start für jede Neue", "The same start for everyone", "Le même départ pour toutes"), items: [
        x("Eine Ankunfts-Liste", "One arrival checklist", "Une liste d'arrivée"),
        x("Der 90-Tage-Plan", "The 90-day plan", "Le plan de 90 jours"),
        x("Eine feste Patin", "One fixed mentor", "Une marraine fixe"),
        x("Jede Woche ein Kurzgespräch", "A short talk every week", "Un court échange chaque semaine")] },
      { t: x("Leihkräfte abbauen", "Cut agency staff", "Réduire l'intérim"), items: [
        x("Leihstunden zählen", "Count agency hours", "Compter les heures d'intérim"),
        x("Für jede Neue Stunden kündigen", "Cancel hours for every new nurse", "Annuler des heures pour chaque nouvelle"),
        x("Leihkräfte nur für Spitzen", "Agency staff only for peaks", "L'intérim seulement pour les pics"),
        x("Jedes Quartal die Ersparnis ausrechnen", "Work out the savings every quarter", "Calculer l'économie chaque trimestre")] },
    ],
  },

  // ── Stufe 3 · Stabil, aber teuer ─────────────────────────────────────────
  3: {
    areas: {
      fill: {
        p: [x("Neue kommen erst, wenn es schon brennt.", "New nurses only come once it is on fire.", "Les nouvelles arrivent quand ça brûle déjà."),
            x("Jede Kündigung trifft Sie unvorbereitet.", "Every resignation hits you unprepared.", "Chaque démission vous prend de court.")],
        a: [x("Jedes Quartal eine Gruppe, fest im Kalender.", "One group every quarter, fixed in the calendar.", "Un groupe chaque trimestre, fixé au calendrier."),
            x("Besetzen Sie 1 bis 2 Stellen im Voraus.", "Fill 1 to 2 posts in advance.", "Pourvoyez 1 à 2 postes à l'avance."),
            x("Rechnen Sie mit den Kündigungen des letzten Jahres.", "Plan with last year's resignations.", "Comptez avec les départs de l'an dernier.")],
      },
      papers: {
        p: [x("Jedes Mal fangen Sie von vorne an.", "Every time you start over.", "À chaque fois, vous recommencez."),
            x("Das Wissen steckt in einem Kopf.", "The know-how sits in one head.", "Le savoir est dans une seule tête.")],
        a: [x("Schreiben Sie den Ablauf einmal auf, Schritt für Schritt.", "Write the process down once, step by step.", "Écrivez le processus une fois, étape par étape."),
            x("Ein fester Partner, ein fester Ablauf.", "One fixed partner, one fixed process.", "Un partenaire fixe, un processus fixe."),
            x("Eine zweite Person kennt den Ablauf auch.", "A second person knows the process too.", "Une deuxième personne connaît le processus.")],
      },
      arrive: {
        p: [x("Die Familie fehlt. Das Heimweh bleibt.", "Family is missing. Homesickness stays.", "La famille manque. Le mal du pays reste."),
            x("Nach der Arbeit sind die Neuen allein.", "After work the new nurses are alone.", "Après le travail, les nouvelles sont seules.")],
        a: [x("Planen Sie die Familie früh mit: Nachzug, Kita, Schule.", "Plan the family early: reunion, nursery, school.", "Prévoyez la famille tôt : regroupement, crèche, école."),
            x("Verbinden Sie Neue mit anderen aus ihrem Land.", "Connect new nurses with others from their country.", "Mettez les nouvelles en contact avec d'autres de leur pays."),
            x("Ein Treffen im Monat, außerhalb der Arbeit.", "One get-together a month, outside work.", "Une rencontre par mois, hors travail.")],
      },
      onboard: {
        p: [x("Die Patinnen haben keine Zeit.", "The mentors have no time.", "Les marraines n'ont pas le temps."),
            x("Wenn es voll ist, leidet die Einarbeitung.", "When it's busy, onboarding suffers.", "Quand c'est plein, l'intégration souffre.")],
        a: [x("Patinnen bekommen 2 Stunden pro Woche dafür.", "Mentors get 2 hours a week for it.", "Les marraines ont 2 heures par semaine pour ça."),
            x("Patinnen bekommen ein Danke: Geld oder freie Zeit.", "Mentors get a thank-you: money or time off.", "Les marraines reçoivent un merci : argent ou repos."),
            x("Jede Patin betreut höchstens 2 Neue.", "Each mentor looks after 2 new nurses at most.", "Chaque marraine suit 2 nouvelles au plus.")],
      },
      agency: {
        p: [x("Leihkräfte sind fest eingeplant.", "Agency staff are part of the plan.", "L'intérim est prévu d'office."),
            x("Niemand fragt mehr, was sie kosten.", "Nobody asks any more what they cost.", "Plus personne ne demande ce que ça coûte.")],
        a: [x("Bauen Sie Leihstunden ab, Schritt für Schritt.", "Cut agency hours, step by step.", "Réduisez l'intérim, pas à pas."),
            x("Setzen Sie ein Ziel pro Quartal.", "Set a target per quarter.", "Fixez un objectif par trimestre."),
            x("Zeigen Sie dem Team, was gespart wird.", "Show the team what is saved.", "Montrez à l'équipe ce qui est économisé.")],
      },
      keep: {
        p: [x("Überraschungen beim Lohn: Dann gehen Leute.", "Surprises on the pay slip: then people leave.", "Des surprises sur la paie : alors on part."),
            x("Gute Leute gehen, weil sie keinen Weg nach oben sehen.", "Good people leave because they see no way up.", "Les bons partent faute de perspective.")],
        a: [x("Sagen Sie klar und schriftlich, was jemand verdient, und ab wann mehr.", "Say clearly, in writing, what someone earns, and when more.", "Dites clairement, par écrit, le salaire, et quand il augmente."),
            x("Zeigen Sie einen Weg: Praxisanleitung, Wohnbereichsleitung.", "Show a path: practice mentor, unit lead.", "Montrez un chemin : tutrice, responsable d'unité."),
            x("Wer geht, bekommt ein Gespräch. Die Gründe kommen auf eine Liste.", "Whoever leaves gets a talk. The reasons go on a list.", "Chaque départ a un entretien. Les raisons vont sur une liste.")],
      },
    },
    success: [
      { t: x("Fester Rhythmus", "A fixed rhythm", "Un rythme fixe"), items: [
        x("Jedes Quartal eine Gruppe", "One group every quarter", "Un groupe par trimestre"),
        x("1 bis 2 Stellen im Voraus besetzt", "1 to 2 posts filled in advance", "1 à 2 postes pourvus d'avance"),
        x("Der Ablauf steht auf Papier", "The process is on paper", "Le processus est écrit"),
        x("Zwei Personen kennen den Ablauf", "Two people know the process", "Deux personnes connaissent le processus")] },
      { t: x("Leihkräfte abbauen", "Cut agency staff", "Réduire l'intérim"), items: [
        x("Ein Ziel pro Quartal", "One target per quarter", "Un objectif par trimestre"),
        x("Für jede Neue Stunden kündigen", "Cancel hours for every new nurse", "Annuler des heures pour chaque nouvelle"),
        x("Ersparnis dem Team zeigen", "Show the savings to the team", "Montrer l'économie à l'équipe"),
        x("Leihkräfte nur noch für Spitzen", "Agency staff only for peaks", "L'intérim seulement pour les pics")] },
      { t: x("Ehrlich beim Lohn", "Honest about pay", "Honnête sur le salaire"), items: [
        x("Lohn klar und schriftlich", "Pay clear and in writing", "Salaire clair et écrit"),
        x("Sagen, ab wann es mehr gibt", "Say when it goes up", "Dire quand il augmente"),
        x("Keine Überraschungen auf dem Zettel", "No surprises on the pay slip", "Pas de surprise sur la fiche de paie"),
        x("Ein Weg nach oben für die Guten", "A way up for the good ones", "Une perspective pour les meilleures")] },
      { t: x("Fragen, warum", "Ask why", "Demander pourquoi"), items: [
        x("Wer geht, bekommt 15 Minuten", "Whoever leaves gets 15 minutes", "Chaque départ a 15 minutes"),
        x("Gründe auf eine Liste", "Reasons on a list", "Les raisons sur une liste"),
        x("Jeden Monat die Liste lesen", "Read the list every month", "Lire la liste chaque mois"),
        x("Den häufigsten Grund lösen", "Fix the most common reason", "Régler la raison la plus fréquente")] },
    ],
  },

  // ── Stufe 4 · Planbar ────────────────────────────────────────────────────
  4: {
    areas: {
      fill: {
        p: [x("Sie wissen, wer kommt, aber nur für die nächsten Monate.", "You know who is coming, but only for the next months.", "Vous savez qui arrive, mais seulement pour quelques mois."),
            x("Wachstum ist nicht geplant.", "Growth is not planned.", "La croissance n'est pas planifiée.")],
        a: [x("Planen Sie 12 Monate voraus: Rente, Elternzeit, Kündigungen.", "Plan 12 months ahead: retirement, parental leave, resignations.", "Planifiez 12 mois : retraites, congés parentaux, départs."),
            x("Legen Sie fest, wie viele Plätze Sie mehr belegen wollen.", "Decide how many more places you want to fill.", "Décidez combien de places en plus vous voulez remplir."),
            x("Holen Sie dafür feste Gruppen pro Jahr.", "Bring fixed groups per year for it.", "Prévoyez des groupes fixes par an.")],
      },
      papers: {
        p: [x("Der Ablauf hängt noch an einer Person.", "The process still depends on one person.", "Le processus dépend encore d'une personne."),
            x("Fehler fallen spät auf.", "Mistakes show up late.", "Les erreurs apparaissent tard.")],
        a: [x("Machen Sie den Ablauf zur Checkliste für alle.", "Turn the process into a checklist for everyone.", "Faites du processus une check-list pour tous."),
            x("Jeden Monat 15 Minuten: Wo hängt welche Akte?", "15 minutes every month: which file is stuck where?", "15 minutes par mois : quel dossier bloque où ?"),
            x("Eine Vertretung für die Person mit den Papieren.", "A stand-in for the person doing the papers.", "Un remplaçant pour la personne des papiers.")],
      },
      arrive: {
        p: [x("Ankommen klappt, aber kostet viel Zeit.", "Arrival works, but takes a lot of time.", "L'arrivée marche, mais prend beaucoup de temps."),
            x("Wohnungen müssen jedes Mal neu gesucht werden.", "Flats have to be found anew every time.", "Il faut chercher un logement à chaque fois.")],
        a: [x("Mieten Sie feste Wohnungen für Neue.", "Rent fixed flats for new nurses.", "Louez des logements fixes pour les nouvelles."),
            x("Ein Ankunfts-Paket: alles an einem Ort.", "An arrival pack: everything in one place.", "Un kit d'arrivée : tout au même endroit."),
            x("Erfahrene Pflegekräfte aus dem Ausland helfen den Neuen.", "Experienced nurses from abroad help the new ones.", "Les infirmières venues avant aident les nouvelles.")],
      },
      onboard: {
        p: [x("Gute Einarbeitung, aber ohne Ziele.", "Good onboarding, but without goals.", "Bonne intégration, mais sans objectifs."),
            x("Neue wissen nicht, wann sie „fertig“ sind.", "New nurses don't know when they are “done”.", "Les nouvelles ne savent pas quand elles sont « prêtes ».")],
        a: [x("Schreiben Sie Ziele für Woche 4, 8 und 12 auf.", "Write goals for week 4, 8 and 12.", "Écrivez des objectifs pour les semaines 4, 8 et 12."),
            x("Nach 90 Tagen ein Abschlussgespräch.", "A closing talk after 90 days.", "Un entretien de bilan après 90 jours."),
            x("Gute Patinnen werden Praxisanleiterinnen.", "Good mentors become practice instructors.", "Les bonnes marraines deviennent tutrices.")],
      },
      agency: {
        p: [x("Leihkräfte nur noch bei Spitzen.", "Agency staff only for peaks.", "L'intérim seulement pour les pics."),
            x("Krankheitswellen treffen hart.", "Waves of sick leave hit hard.", "Les vagues de maladie frappent fort.")],
        a: [x("Bauen Sie einen eigenen Springer-Pool auf.", "Build your own float pool.", "Créez votre propre pool de remplaçantes."),
            x("Zahlen Sie für Einspringen einen festen Bonus.", "Pay a fixed bonus for stepping in.", "Payez une prime fixe pour les remplacements."),
            x("Ziel: null Leihstunden im normalen Betrieb.", "Target: zero agency hours in normal times.", "Objectif : zéro intérim en temps normal.")],
      },
      keep: {
        p: [x("Leute bleiben, aber werden müde.", "People stay, but get tired.", "Les gens restent, mais s'épuisent."),
            x("Wer gut ist, wird abgeworben.", "The good ones get poached.", "Les meilleures sont débauchées.")],
        a: [x("Einmal im Jahr ein Gespräch über die Zukunft.", "Once a year a talk about the future.", "Une fois par an, un entretien sur l'avenir."),
            x("Dienstpläne fest und früh bekannt.", "Rotas fixed and known early.", "Des plannings fixes et connus tôt."),
            x("Fragen Sie: Was würde dich halten?", "Ask: what would keep you here?", "Demandez : qu'est-ce qui te ferait rester ?")],
      },
    },
    success: [
      { t: x("12 Monate voraus planen", "Plan 12 months ahead", "Planifier 12 mois"), items: [
        x("Abgänge des Jahres kennen", "Know the year's departures", "Connaître les départs de l'année"),
        x("Wachstumsziel in Plätzen", "A growth target in places", "Un objectif de croissance en places"),
        x("Gruppen fest im Kalender", "Groups fixed in the calendar", "Des groupes fixés au calendrier"),
        x("Wohnungen im Voraus", "Flats in advance", "Des logements d'avance")] },
      { t: x("Eigener Springer-Pool", "Your own float pool", "Votre pool de remplaçantes"), items: [
        x("Feste Springer statt Leihkräfte", "Fixed floats instead of agency", "Des remplaçantes fixes au lieu de l'intérim"),
        x("Bonus fürs Einspringen", "Bonus for stepping in", "Prime de remplacement"),
        x("Null Leihstunden im Normalbetrieb", "Zero agency hours in normal times", "Zéro intérim en temps normal"),
        x("Ersparnis jedes Quartal zeigen", "Show the savings every quarter", "Montrer l'économie chaque trimestre")] },
      { t: x("Einarbeitung mit Zielen", "Onboarding with goals", "Intégration avec objectifs"), items: [
        x("Ziele für Woche 4, 8, 12", "Goals for week 4, 8, 12", "Objectifs semaines 4, 8, 12"),
        x("Abschlussgespräch nach 90 Tagen", "Closing talk after 90 days", "Bilan après 90 jours"),
        x("Patinnen werden Praxisanleiterinnen", "Mentors become practice instructors", "Les marraines deviennent tutrices"),
        x("Checkliste für alle Papiere", "Checklist for all papers", "Check-list pour tous les papiers")] },
      { t: x("Gute Leute halten", "Keep the good people", "Garder les meilleures"), items: [
        x("Ein Zukunftsgespräch pro Jahr", "One future talk per year", "Un entretien d'avenir par an"),
        x("Dienstpläne früh und fest", "Rotas early and fixed", "Plannings tôt et fixes"),
        x("Fragen, was hält", "Ask what keeps them", "Demander ce qui retient"),
        x("Wege nach oben zeigen", "Show the ways up", "Montrer les évolutions")] },
    ],
  },

  // ── Stufe 5 · Magnet ─────────────────────────────────────────────────────
  5: {
    areas: {
      fill: {
        p: [x("Bewerbungen kommen, aber nicht immer die richtigen.", "Applications come, but not always the right ones.", "Les candidatures arrivent, pas toujours les bonnes."),
            x("Ihr Ruf trägt, aber nur, solange es läuft.", "Your reputation carries you, but only while it works.", "Votre réputation porte, tant que tout va bien.")],
        a: [x("Lassen Sie Ihre Pflegekräfte erzählen: Video, Empfehlung.", "Let your nurses tell their story: video, referral.", "Laissez vos infirmières raconter : vidéo, recommandation."),
            x("Belohnen Sie Empfehlungen aus dem Team.", "Reward referrals from the team.", "Récompensez les recommandations de l'équipe."),
            x("Wählen Sie streng aus: Wer passt zum Haus?", "Select strictly: who fits the house?", "Sélectionnez strictement : qui correspond à la maison ?")],
      },
      papers: {
        p: [x("Alles läuft, aber Regeln ändern sich.", "Everything works, but rules change.", "Tout marche, mais les règles changent."),
            x("Neue Länder bringen neue Papiere.", "New countries bring new papers.", "De nouveaux pays, de nouveaux papiers.")],
        a: [x("Prüfen Sie den Ablauf einmal im Jahr.", "Review the process once a year.", "Revoyez le processus une fois par an."),
            x("Neue Regeln früh kennen: Fragen Sie Ihren Partner.", "Know new rules early: ask your partner.", "Connaître tôt les nouvelles règles : demandez au partenaire."),
            x("Ein neues Herkunftsland nur mit demselben Ablauf.", "A new country of origin only with the same process.", "Un nouveau pays seulement avec le même processus.")],
      },
      arrive: {
        p: [x("Viele Neue auf einmal: Es wird unpersönlich.", "Many new nurses at once: it gets impersonal.", "Beaucoup de nouvelles à la fois : ça devient impersonnel."),
            x("Die ersten Gruppen helfen nicht mehr mit.", "The first groups no longer help.", "Les premiers groupes n'aident plus.")],
        a: [x("Jede Gruppe hat eine Ansprechperson aus der Gruppe davor.", "Every group gets a contact from the group before.", "Chaque groupe a un contact du groupe précédent."),
            x("Ein Willkommensfest pro Gruppe.", "A welcome party for every group.", "Une fête d'accueil par groupe."),
            x("Fragen Sie jede Gruppe nach 90 Tagen: Was machen wir besser?", "Ask every group after 90 days: what can we do better?", "Demandez à chaque groupe après 90 jours : que faire mieux ?")],
      },
      onboard: {
        p: [x("Die Einarbeitung wird Routine.", "Onboarding becomes routine.", "L'intégration devient routine."),
            x("Gute Patinnen sind überlastet.", "Good mentors are overloaded.", "Les bonnes marraines sont surchargées.")],
        a: [x("Lassen Sie die Patinnen-Rolle wechseln.", "Rotate the mentor role.", "Faites tourner le rôle de marraine."),
            x("Verbessern Sie die Einarbeitung jedes Jahr, mit Feedback der Neuen.", "Improve onboarding every year, with feedback from new nurses.", "Améliorez l'intégration chaque année, avec l'avis des nouvelles."),
            x("Fördern Sie gute Patinnen: Praxisanleitung, Leitung.", "Develop good mentors: practice instruction, leadership.", "Faites évoluer les bonnes marraines : tutorat, encadrement.")],
      },
      agency: {
        p: [x("Keine Leihkräfte mehr. Ausfälle gibt es trotzdem.", "No more agency staff. Absences still happen.", "Plus d'intérim. Les absences arrivent quand même."),
            x("Kosten laufen woanders hoch.", "Costs creep up elsewhere.", "Les coûts montent ailleurs.")],
        a: [x("Pflegen Sie den Springer-Pool.", "Look after the float pool.", "Entretenez le pool de remplaçantes."),
            x("Vergleichen Sie die Kosten pro Pflegekraft jedes Jahr.", "Compare cost per nurse every year.", "Comparez le coût par infirmière chaque année."),
            x("Geben Sie einen Teil der Ersparnis ans Team.", "Give part of the savings to the team.", "Reversez une part de l'économie à l'équipe.")],
      },
      keep: {
        p: [x("Wer oben ist, wird bequem.", "Whoever is on top gets comfortable.", "Au sommet, on se repose."),
            x("Andere Häuser werben Ihre Leute ab.", "Other homes poach your people.", "D'autres maisons débauchent vos équipes.")],
        a: [x("Weiter jedes Jahr ein Gespräch.", "Keep one talk every year.", "Gardez un entretien chaque année."),
            x("Zeigen Sie Wege nach oben.", "Show the ways up.", "Montrez les évolutions."),
            x("Feiern Sie, wer 1, 3 und 5 Jahre bleibt.", "Celebrate who stays 1, 3 and 5 years.", "Fêtez celles qui restent 1, 3 et 5 ans.")],
      },
    },
    success: [
      { t: x("Den Ruf nutzen", "Use your reputation", "Utiliser votre réputation"), items: [
        x("Pflegekräfte erzählen lassen", "Let nurses tell their story", "Laisser les infirmières raconter"),
        x("Empfehlungen belohnen", "Reward referrals", "Récompenser les recommandations"),
        x("Streng auswählen", "Select strictly", "Sélectionner strictement"),
        x("Eine Warteliste führen", "Keep a waiting list", "Tenir une liste d'attente")] },
      { t: x("Den Ablauf pflegen", "Look after the process", "Entretenir le processus"), items: [
        x("Einmal im Jahr prüfen", "Review once a year", "Revoir une fois par an"),
        x("Neue Regeln früh kennen", "Know new rules early", "Connaître tôt les règles"),
        x("Neue Länder nur mit gleichem Ablauf", "New countries only with the same process", "Nouveaux pays avec le même processus"),
        x("Kosten pro Pflegekraft vergleichen", "Compare cost per nurse", "Comparer le coût par infirmière")] },
      { t: x("Das Team wachsen lassen", "Let the team grow", "Faire grandir l'équipe"), items: [
        x("Patinnen-Rolle wechseln", "Rotate the mentor role", "Faire tourner les marraines"),
        x("Gute Patinnen fördern", "Develop good mentors", "Faire évoluer les marraines"),
        x("Feedback jeder Gruppe", "Feedback from every group", "L'avis de chaque groupe"),
        x("Ersparnis ans Team geben", "Share savings with the team", "Partager l'économie avec l'équipe")] },
      { t: x("Oben bleiben", "Stay on top", "Rester au sommet"), items: [
        x("Jedes Jahr ein Gespräch", "One talk every year", "Un entretien par an"),
        x("Wege nach oben zeigen", "Show the ways up", "Montrer les évolutions"),
        x("Treue feiern: 1, 3, 5 Jahre", "Celebrate loyalty: 1, 3, 5 years", "Fêter la fidélité : 1, 3, 5 ans"),
        x("Nie aufhören zu fragen", "Never stop asking", "Ne jamais arrêter de demander")] },
    ],
  },
};
