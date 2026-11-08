/**
 * The plan part of the Fahrplan, modelled on the acquisition.com roadmap
 * (founder 2026-11-08: "easy for anyone, fewer words, things they can execute").
 * Per Stufe:
 *   areas   · per area 3 short lines: the problem, then 2 things to do
 *   success · 4 blocks × 4 steps of a few words = how you reach the next Stufe
 * Plain words only: no paragraphs, no laws, no exam names, no numbers we can't back up.
 */
import type { L } from "./content";
import type { Level } from "./score";

export type AreaKey = "fill" | "papers" | "arrive" | "onboard" | "agency" | "keep";
export type Play = { areas: Record<AreaKey, L[]>; success: { t: L; items: L[] }[] };
const x = (de: string, en: string, fr: string): L => ({ de, en, fr });

export const PLAYBOOK: Record<Level, Play> = {
  // ── Stufe 1 · Notbetrieb ─────────────────────────────────────────────────
  1: {
    areas: {
      fill: [
        x("Stellen sind seit Monaten leer.", "Posts have been empty for months.", "Des postes sont vides depuis des mois."),
        x("Sie brauchen EINEN Partner, nicht fünf Agenturen.", "You need ONE partner, not five agencies.", "Il vous faut UN partenaire, pas cinq agences."),
        x("Schreiben Sie jede leere Stelle auf eine Liste.", "Put every empty post on one list.", "Mettez chaque poste vide sur une liste."),
      ],
      papers: [
        x("Keiner weiß, wo die Papiere gerade stehen.", "Nobody knows where the papers are.", "Personne ne sait où en sont les papiers."),
        x("Eine Person im Haus kümmert sich um alle Papiere.", "One person in the house handles all papers.", "Une seule personne gère tous les papiers."),
        x("Eine Liste: wer, welcher Schritt, welches Datum.", "One list: who, which step, which date.", "Une liste : qui, quelle étape, quelle date."),
      ],
      arrive: [
        x("Die Neue kommt an, aber es gibt keine Wohnung.", "She arrives, but there is no flat.", "Elle arrive, mais il n'y a pas de logement."),
        x("Klären Sie die Wohnung, bevor das Visum da ist.", "Sort the flat before the visa comes.", "Réglez le logement avant le visa."),
        x("Legen Sie fest, wer sie am ersten Tag abholt.", "Decide who picks her up on day one.", "Décidez qui l'accueille le premier jour."),
      ],
      onboard: [
        x("Neue arbeiten ab Tag 1 voll mit. Das geht schief.", "New nurses work full shifts from day 1. It goes wrong.", "Les nouvelles travaillent à plein dès le jour 1. Ça casse."),
        x("Jede Neue bekommt eine feste Patin.", "Every new nurse gets one fixed mentor.", "Chaque nouvelle a une marraine fixe."),
        x("Die ersten 2 Wochen: nie allein im Dienst.", "First 2 weeks: never alone on shift.", "2 premières semaines : jamais seule."),
      ],
      agency: [
        x("Leihkräfte kommen jeden Tag. Die Rechnung wächst.", "Agency staff come every day. The bill grows.", "L'intérim vient chaque jour. La facture monte."),
        x("Zählen Sie die Leihstunden. Jeden Monat.", "Count agency hours. Every month.", "Comptez les heures d'intérim. Chaque mois."),
        x("Setzen Sie ein Ziel: weniger Stunden in 6 Monaten.", "Set a goal: fewer hours in 6 months.", "Fixez un but : moins d'heures dans 6 mois."),
      ],
      keep: [
        x("Leute gehen, und Sie wissen nicht, warum.", "People leave and you don't know why.", "Des gens partent, sans savoir pourquoi."),
        x("Fragen Sie jeden, der geht: Warum?", "Ask everyone who leaves: why?", "Demandez à chaque départ : pourquoi ?"),
        x("Schreiben Sie die Gründe auf. Lösen Sie den häufigsten.", "Write the reasons down. Fix the most common one.", "Notez les raisons. Réglez la plus fréquente."),
      ],
    },
    success: [
      { t: x("Kein Geld mehr verlieren", "Stop losing money", "Arrêter de perdre de l'argent"), items: [
        x("Alle leeren Stellen auf eine Liste", "All empty posts on one list", "Tous les postes vides sur une liste"),
        x("Die teuerste Stelle zuerst", "The most costly post first", "Le poste le plus cher d'abord"),
        x("Leihstunden jeden Monat zählen", "Count agency hours monthly", "Compter l'intérim chaque mois"),
        x("Ziel: weniger Leihstunden", "Goal: fewer agency hours", "But : moins d'intérim")] },
      { t: x("Einen Partner wählen", "Choose one partner", "Choisir un partenaire"), items: [
        x("Einer statt fünf Agenturen", "One instead of five agencies", "Un au lieu de cinq agences"),
        x("Fragen: Wer prüft das Deutsch?", "Ask: who checks the German?", "Demander : qui vérifie l'allemand ?"),
        x("Fragen: Wer macht die Papiere?", "Ask: who does the papers?", "Demander : qui fait les papiers ?"),
        x("Fragen: Was, wenn sie früh geht?", "Ask: what if she leaves early?", "Demander : et si elle part tôt ?")] },
      { t: x("Den Start vorbereiten", "Prepare the start", "Préparer l'arrivée"), items: [
        x("Wohnung klären", "Sort the flat", "Régler le logement"),
        x("Abholen klären", "Sort the pick-up", "Organiser l'accueil"),
        x("Eine Patin bestimmen", "Name a mentor", "Désigner une marraine"),
        x("Dienstplan für 2 Wochen", "Rota for 2 weeks", "Planning pour 2 semaines")] },
      { t: x("Wissen, warum Leute gehen", "Know why people leave", "Savoir pourquoi on part"), items: [
        x("Mit jedem reden, der geht", "Talk to everyone who leaves", "Parler à chaque départ"),
        x("Gründe aufschreiben", "Write the reasons down", "Noter les raisons"),
        x("Jeden Monat das Team fragen", "Ask the team every month", "Interroger l'équipe chaque mois"),
        x("Den häufigsten Grund lösen", "Fix the most common reason", "Régler la raison la plus fréquente")] },
    ],
  },

  // ── Stufe 2 · Lückenfüller ───────────────────────────────────────────────
  2: {
    areas: {
      fill: [
        x("Sie holen eine nach der anderen. Jede ist ein Kampf.", "You hire one at a time. Each one is a fight.", "Vous recrutez une par une. Chaque fois, un combat."),
        x("Holen Sie 3 bis 5 Pflegekräfte auf einmal.", "Bring 3 to 5 nurses at once.", "Faites venir 3 à 5 infirmières à la fois."),
        x("Legen Sie feste Termine im Jahr fest.", "Set fixed dates in the year.", "Fixez des dates dans l'année."),
      ],
      papers: [
        x("Die Papiere dauern länger als gedacht.", "The papers take longer than planned.", "Les papiers prennent plus de temps que prévu."),
        x("Planen Sie vom ersten Arbeitstag rückwärts.", "Plan backwards from the first working day.", "Planifiez à rebours depuis le premier jour."),
        x("Bis alles fertig ist: Einsatz als Pflegehelferin.", "Until it's done: she works as a care assistant.", "En attendant : elle travaille comme aide-soignante."),
      ],
      arrive: [
        x("Jedes Mal fangen Sie bei null an.", "Every time you start from zero.", "À chaque fois, vous repartez de zéro."),
        x("Eine Ankunfts-Liste, für jede Neue dieselbe.", "One arrival checklist, the same for all.", "Une liste d'arrivée, la même pour toutes."),
        x("Bank, Amt und Krankenkasse in Woche 1.", "Bank, town hall, health insurance in week 1.", "Banque, mairie, assurance en semaine 1."),
      ],
      onboard: [
        x("Jede Patin macht es anders.", "Every mentor does it differently.", "Chaque marraine fait autrement."),
        x("Nutzen Sie den 90-Tage-Plan für jede Neue.", "Use the 90-day plan for every new nurse.", "Utilisez le plan de 90 jours pour chacune."),
        x("Jede Woche 10 Minuten: Neue und Patin reden.", "10 minutes a week: new nurse and mentor talk.", "10 minutes par semaine : nouvelle et marraine parlent."),
      ],
      agency: [
        x("Ohne Leihkräfte geht keine Woche.", "No week works without agency staff.", "Aucune semaine sans intérim."),
        x("Für jede Neue, die bleibt: Leihstunden kündigen.", "For every new nurse who stays: cancel agency hours.", "Pour chaque nouvelle qui reste : moins d'intérim."),
        x("Leihkräfte nur noch für Notfälle.", "Agency staff only for emergencies.", "L'intérim seulement pour les urgences."),
      ],
      keep: [
        x("Manche Neue bleiben, manche nicht.", "Some new nurses stay, some don't.", "Certaines restent, d'autres non."),
        x("Holen Sie sie in Gruppen. Zusammen bleiben sie.", "Bring them in groups. Together they stay.", "Faites-les venir en groupe. Ensemble, elles restent."),
        x("Fragen Sie in Monat 1, 3 und 6: Wie geht es dir?", "Ask in month 1, 3 and 6: how are you?", "Demandez au mois 1, 3 et 6 : ça va ?"),
      ],
    },
    success: [
      { t: x("In Gruppen holen", "Hire in groups", "Recruter en groupes"), items: [
        x("3 bis 5 auf einmal", "3 to 5 at once", "3 à 5 à la fois"),
        x("Feste Termine im Jahr", "Fixed dates in the year", "Des dates fixes dans l'année"),
        x("Ein Partner für alles", "One partner for everything", "Un partenaire pour tout"),
        x("Eine Ansprechperson im Haus", "One contact in the house", "Un interlocuteur dans la maison")] },
      { t: x("Rückwärts planen", "Plan backwards", "Planifier à rebours"), items: [
        x("Ersten Arbeitstag festlegen", "Fix the first working day", "Fixer le premier jour"),
        x("Papiere rückwärts planen", "Plan the papers backwards", "Planifier les papiers à rebours"),
        x("Bis dahin: als Pflegehelferin", "Until then: care assistant", "En attendant : aide-soignante"),
        x("Jede Woche den Stand prüfen", "Check progress every week", "Vérifier chaque semaine")] },
      { t: x("Gleicher Start für jede", "The same start for all", "Le même départ pour toutes"), items: [
        x("Eine Ankunfts-Liste", "One arrival checklist", "Une liste d'arrivée"),
        x("Der 90-Tage-Plan", "The 90-day plan", "Le plan de 90 jours"),
        x("Eine feste Patin", "One fixed mentor", "Une marraine fixe"),
        x("Jede Woche 10 Minuten reden", "Talk 10 minutes every week", "Parler 10 minutes par semaine")] },
      { t: x("Leihkräfte abbauen", "Cut agency staff", "Réduire l'intérim"), items: [
        x("Leihstunden zählen", "Count agency hours", "Compter l'intérim"),
        x("Für jede Neue Stunden kündigen", "Cancel hours for each new nurse", "Annuler des heures par nouvelle"),
        x("Leihkräfte nur für Notfälle", "Agency only for emergencies", "L'intérim pour les urgences"),
        x("Ersparnis jedes Quartal rechnen", "Count the savings every quarter", "Calculer l'économie chaque trimestre")] },
    ],
  },

  // ── Stufe 3 · Stabil, aber teuer ─────────────────────────────────────────
  3: {
    areas: {
      fill: [
        x("Neue kommen erst, wenn es schon brennt.", "New nurses only come once it's on fire.", "Les nouvelles arrivent quand ça brûle déjà."),
        x("Jedes Quartal eine Gruppe, fest im Kalender.", "One group every quarter, fixed in the calendar.", "Un groupe par trimestre, fixé au calendrier."),
        x("Besetzen Sie 1 bis 2 Stellen im Voraus.", "Fill 1 to 2 posts in advance.", "Pourvoyez 1 à 2 postes d'avance."),
      ],
      papers: [
        x("Das ganze Wissen steckt in einem Kopf.", "All the know-how sits in one head.", "Tout le savoir est dans une seule tête."),
        x("Schreiben Sie den Ablauf einmal auf.", "Write the process down once.", "Écrivez le processus une fois."),
        x("Eine zweite Person lernt ihn auch.", "A second person learns it too.", "Une deuxième personne l'apprend aussi."),
      ],
      arrive: [
        x("Nach der Arbeit sind die Neuen allein.", "After work the new nurses are alone.", "Après le travail, les nouvelles sont seules."),
        x("Bringen Sie Neue mit Leuten aus ihrem Land zusammen.", "Connect them with people from their country.", "Mettez-les en contact avec des gens de leur pays."),
        x("Planen Sie die Familie früh mit: Kita, Schule.", "Plan for the family early: nursery, school.", "Prévoyez la famille tôt : crèche, école."),
      ],
      onboard: [
        x("Die Patinnen haben keine Zeit.", "The mentors have no time.", "Les marraines n'ont pas le temps."),
        x("Patinnen bekommen 2 Stunden pro Woche dafür.", "Mentors get 2 hours a week for it.", "Les marraines ont 2 heures par semaine pour ça."),
        x("Jede Patin hat höchstens 2 Neue.", "Each mentor has 2 new nurses at most.", "Chaque marraine a 2 nouvelles au plus."),
      ],
      agency: [
        x("Leihkräfte sind fest eingeplant.", "Agency staff are part of the plan.", "L'intérim est prévu d'office."),
        x("Jedes Quartal ein Ziel: weniger Leihstunden.", "Every quarter a goal: fewer agency hours.", "Chaque trimestre un but : moins d'intérim."),
        x("Zeigen Sie dem Team, was gespart wird.", "Show the team what you save.", "Montrez à l'équipe ce qui est économisé."),
      ],
      keep: [
        x("Gute Leute gehen, weil sie keinen Weg nach oben sehen.", "Good people leave because they see no way up.", "Les meilleures partent faute d'avenir."),
        x("Sagen Sie schriftlich, was sie verdient, und wann mehr.", "Say in writing what she earns, and when more.", "Dites par écrit le salaire, et quand il monte."),
        x("Zeigen Sie einen Weg nach oben.", "Show a way up.", "Montrez une évolution."),
      ],
    },
    success: [
      { t: x("Fester Rhythmus", "A fixed rhythm", "Un rythme fixe"), items: [
        x("Jedes Quartal eine Gruppe", "One group every quarter", "Un groupe par trimestre"),
        x("1 bis 2 Stellen im Voraus", "1 to 2 posts in advance", "1 à 2 postes d'avance"),
        x("Der Ablauf steht auf Papier", "The process is on paper", "Le processus est écrit"),
        x("Zwei Leute kennen ihn", "Two people know it", "Deux personnes le connaissent")] },
      { t: x("Leihkräfte abbauen", "Cut agency staff", "Réduire l'intérim"), items: [
        x("Ein Ziel pro Quartal", "One goal per quarter", "Un but par trimestre"),
        x("Für jede Neue Stunden kündigen", "Cancel hours for each new nurse", "Annuler des heures par nouvelle"),
        x("Ersparnis dem Team zeigen", "Show the team the savings", "Montrer l'économie à l'équipe"),
        x("Leihkräfte nur für Notfälle", "Agency only for emergencies", "L'intérim pour les urgences")] },
      { t: x("Klar beim Lohn", "Clear about pay", "Clair sur le salaire"), items: [
        x("Lohn schriftlich", "Pay in writing", "Salaire par écrit"),
        x("Sagen, wann es mehr gibt", "Say when it goes up", "Dire quand il monte"),
        x("Keine Überraschung beim Lohn", "No surprises on payday", "Pas de surprise sur la paie"),
        x("Ein Weg nach oben", "A way up", "Une évolution")] },
      { t: x("Fragen, warum", "Ask why", "Demander pourquoi"), items: [
        x("Wer geht, bekommt ein Gespräch", "Whoever leaves gets a talk", "Chaque départ a un entretien"),
        x("Gründe auf eine Liste", "Reasons on a list", "Les raisons sur une liste"),
        x("Jeden Monat die Liste lesen", "Read the list every month", "Lire la liste chaque mois"),
        x("Den häufigsten Grund lösen", "Fix the most common reason", "Régler la raison la plus fréquente")] },
    ],
  },

  // ── Stufe 4 · Planbar ────────────────────────────────────────────────────
  4: {
    areas: {
      fill: [
        x("Sie planen nur ein paar Monate voraus.", "You only plan a few months ahead.", "Vous ne planifiez que quelques mois."),
        x("Planen Sie 12 Monate: Rente, Elternzeit, Kündigungen.", "Plan 12 months: retirement, parental leave, leavers.", "Planifiez 12 mois : retraites, congés, départs."),
        x("Legen Sie fest, wie viele Plätze Sie mehr wollen.", "Decide how many more places you want.", "Décidez combien de places en plus vous voulez."),
      ],
      papers: [
        x("Fehler fallen zu spät auf.", "Mistakes show up too late.", "Les erreurs se voient trop tard."),
        x("Machen Sie den Ablauf zur Checkliste.", "Turn the process into a checklist.", "Faites du processus une check-list."),
        x("Jeden Monat 15 Minuten: Welche Akte hängt?", "15 minutes a month: which file is stuck?", "15 minutes par mois : quel dossier bloque ?"),
      ],
      arrive: [
        x("Jedes Mal eine Wohnung suchen kostet Zeit.", "Finding a flat every time takes time.", "Chercher un logement à chaque fois prend du temps."),
        x("Mieten Sie feste Wohnungen für Neue.", "Rent fixed flats for new nurses.", "Louez des logements fixes pour les nouvelles."),
        x("Die Erfahrenen helfen den Neuen.", "The experienced ones help the new ones.", "Les anciennes aident les nouvelles."),
      ],
      onboard: [
        x("Neue wissen nicht, wann sie „fertig“ sind.", "New nurses don't know when they're “ready”.", "Les nouvelles ne savent pas quand elles sont « prêtes »."),
        x("Schreiben Sie Ziele für Woche 4, 8 und 12 auf.", "Write goals for week 4, 8 and 12.", "Écrivez des buts pour les semaines 4, 8 et 12."),
        x("Nach 90 Tagen ein Abschlussgespräch.", "A wrap-up talk after 90 days.", "Un bilan après 90 jours."),
      ],
      agency: [
        x("Krankheitswellen treffen Sie hart.", "Waves of sick leave hit you hard.", "Les vagues de maladie frappent fort."),
        x("Bauen Sie eigene Springer auf.", "Build your own floaters.", "Créez vos propres remplaçantes."),
        x("Ziel: null Leihstunden im Alltag.", "Goal: zero agency hours day to day.", "But : zéro intérim au quotidien."),
      ],
      keep: [
        x("Wer gut ist, wird abgeworben.", "The good ones get poached.", "Les meilleures sont débauchées."),
        x("Einmal im Jahr: ein Gespräch über die Zukunft.", "Once a year: a talk about the future.", "Une fois par an : parler de l'avenir."),
        x("Dienstpläne früh und fest.", "Rotas early and fixed.", "Des plannings tôt et fixes."),
      ],
    },
    success: [
      { t: x("12 Monate planen", "Plan 12 months", "Planifier 12 mois"), items: [
        x("Abgänge des Jahres kennen", "Know the year's leavers", "Connaître les départs"),
        x("Ein Ziel in Plätzen", "A goal in places", "Un but en places"),
        x("Gruppen fest im Kalender", "Groups fixed in the calendar", "Des groupes au calendrier"),
        x("Wohnungen im Voraus", "Flats in advance", "Des logements d'avance")] },
      { t: x("Eigene Springer", "Your own floaters", "Vos remplaçantes"), items: [
        x("Springer statt Leihkräfte", "Floaters instead of agency", "Remplaçantes au lieu d'intérim"),
        x("Bonus fürs Einspringen", "A bonus for stepping in", "Une prime de remplacement"),
        x("Null Leihstunden im Alltag", "Zero agency hours day to day", "Zéro intérim au quotidien"),
        x("Ersparnis jedes Quartal zeigen", "Show the savings every quarter", "Montrer l'économie chaque trimestre")] },
      { t: x("Einarbeitung mit Zielen", "Onboarding with goals", "Intégration avec des buts"), items: [
        x("Ziele für Woche 4, 8, 12", "Goals for week 4, 8, 12", "Buts semaines 4, 8, 12"),
        x("Gespräch nach 90 Tagen", "A talk after 90 days", "Un bilan après 90 jours"),
        x("Gute Patinnen bilden aus", "Good mentors train others", "Les bonnes marraines forment"),
        x("Checkliste für die Papiere", "A checklist for the papers", "Une check-list pour les papiers")] },
      { t: x("Gute Leute halten", "Keep the good people", "Garder les meilleures"), items: [
        x("Ein Zukunftsgespräch im Jahr", "One future talk a year", "Un entretien d'avenir par an"),
        x("Dienstpläne früh", "Rotas early", "Plannings tôt"),
        x("Fragen: Was hält dich?", "Ask: what keeps you here?", "Demander : qu'est-ce qui te retient ?"),
        x("Wege nach oben zeigen", "Show the ways up", "Montrer les évolutions")] },
    ],
  },

  // ── Stufe 5 · Magnet ─────────────────────────────────────────────────────
  5: {
    areas: {
      fill: [
        x("Es kommen Bewerbungen, nicht immer die richtigen.", "Applications come, not always the right ones.", "Les candidatures arrivent, pas toujours les bonnes."),
        x("Lassen Sie Ihre Pflegekräfte erzählen und empfehlen.", "Let your nurses tell their story and refer friends.", "Laissez vos infirmières raconter et recommander."),
        x("Wählen Sie streng: Wer passt zu Ihnen?", "Choose strictly: who fits you?", "Choisissez strictement : qui vous correspond ?"),
      ],
      papers: [
        x("Die Regeln ändern sich.", "The rules change.", "Les règles changent."),
        x("Prüfen Sie den Ablauf einmal im Jahr.", "Check the process once a year.", "Revoyez le processus une fois par an."),
        x("Neue Regeln früh kennen: Fragen Sie Ihren Partner.", "Know new rules early: ask your partner.", "Connaître tôt les règles : demandez au partenaire."),
      ],
      arrive: [
        x("Viele Neue auf einmal: Es wird unpersönlich.", "Many new nurses at once: it gets impersonal.", "Beaucoup de nouvelles : ça devient impersonnel."),
        x("Jede Gruppe hat eine Helferin aus der Gruppe davor.", "Each group has a helper from the group before.", "Chaque groupe a une aide du groupe d'avant."),
        x("Fragen Sie nach 90 Tagen: Was machen wir besser?", "Ask after 90 days: what can we do better?", "Demandez après 90 jours : que faire mieux ?"),
      ],
      onboard: [
        x("Gute Patinnen sind überlastet.", "Good mentors are overloaded.", "Les bonnes marraines sont surchargées."),
        x("Wechseln Sie die Patinnen ab.", "Rotate the mentors.", "Faites tourner les marraines."),
        x("Machen Sie gute Patinnen zu Ausbilderinnen.", "Turn good mentors into trainers.", "Faites des bonnes marraines des formatrices."),
      ],
      agency: [
        x("Keine Leihkräfte mehr. Ausfälle gibt es trotzdem.", "No more agency staff. Absences still happen.", "Plus d'intérim. Les absences arrivent quand même."),
        x("Halten Sie Ihre Springer gut.", "Look after your floaters.", "Prenez soin de vos remplaçantes."),
        x("Geben Sie einen Teil der Ersparnis ans Team.", "Give part of the savings to the team.", "Reversez une part de l'économie à l'équipe."),
      ],
      keep: [
        x("Andere Häuser werben Ihre Leute ab.", "Other homes poach your people.", "D'autres maisons débauchent vos équipes."),
        x("Jedes Jahr ein Gespräch mit jeder.", "One talk with everyone every year.", "Un entretien avec chacune chaque année."),
        x("Feiern Sie 1, 3 und 5 Jahre.", "Celebrate 1, 3 and 5 years.", "Fêtez 1, 3 et 5 ans."),
      ],
    },
    success: [
      { t: x("Den Ruf nutzen", "Use your good name", "Utiliser votre réputation"), items: [
        x("Pflegekräfte erzählen lassen", "Let nurses tell their story", "Laisser les infirmières raconter"),
        x("Empfehlungen belohnen", "Reward referrals", "Récompenser les recommandations"),
        x("Streng auswählen", "Choose strictly", "Choisir strictement"),
        x("Eine Warteliste führen", "Keep a waiting list", "Tenir une liste d'attente")] },
      { t: x("Den Ablauf pflegen", "Look after the process", "Entretenir le processus"), items: [
        x("Einmal im Jahr prüfen", "Check once a year", "Revoir une fois par an"),
        x("Neue Regeln früh kennen", "Know new rules early", "Connaître tôt les règles"),
        x("Kosten pro Pflegekraft vergleichen", "Compare cost per nurse", "Comparer le coût par infirmière"),
        x("Neue Länder, gleicher Ablauf", "New countries, same process", "Nouveaux pays, même processus")] },
      { t: x("Das Team wachsen lassen", "Let the team grow", "Faire grandir l'équipe"), items: [
        x("Patinnen abwechseln", "Rotate mentors", "Faire tourner les marraines"),
        x("Gute Patinnen fördern", "Promote good mentors", "Faire évoluer les marraines"),
        x("Jede Gruppe fragen", "Ask every group", "Demander à chaque groupe"),
        x("Ersparnis ans Team", "Savings to the team", "L'économie à l'équipe")] },
      { t: x("Oben bleiben", "Stay on top", "Rester au sommet"), items: [
        x("Jedes Jahr ein Gespräch", "One talk every year", "Un entretien par an"),
        x("Wege nach oben zeigen", "Show the ways up", "Montrer les évolutions"),
        x("1, 3, 5 Jahre feiern", "Celebrate 1, 3, 5 years", "Fêter 1, 3, 5 ans"),
        x("Nie aufhören zu fragen", "Never stop asking", "Ne jamais arrêter de demander")] },
    ],
  },
};
