/**
 * The Pflege-Fahrplan's content: what Borivon knows about getting nurses AND
 * keeping them. Written for a 5th grader (founder rule): short sentences, no
 * jargon, one idea per line. Used by the PDF, the page and the emails.
 *
 * No price anywhere (founder rule) and no made-up statistics: every euro figure
 * comes from the facility's own answers via lib/roadmap/score.ts.
 */
import type { Level, RoadmapResult } from "./score";

export type Lang = "de" | "en" | "fr";
export type L = Record<Lang, string>;

export const LANGS: Lang[] = ["de", "en", "fr"];
export const pick = (l: L, lang: Lang): string => l[lang] ?? l.de;

export const LEVELS: Record<Level, { name: L; line: L; looks: L[]; trap: L }> = {
  1: {
    name: { de: "Notbetrieb", en: "Emergency mode", fr: "Mode urgence" },
    line: { de: "Jede Schicht ist ein Loch.", en: "Every shift has a hole.", fr: "Chaque garde a un trou." },
    looks: [
      { de: "Viele Stellen sind offen, seit Monaten.", en: "Many posts have been open for months.", fr: "Beaucoup de postes sont vides depuis des mois." },
      { de: "Leihkräfte und Überstunden halten alles am Laufen.", en: "Agency staff and overtime keep things running.", fr: "L'intérim et les heures sup. font tourner le service." },
      { de: "Das Team ist müde. Neue gehen schnell wieder.", en: "The team is tired. New people leave fast.", fr: "L'équipe est épuisée. Les nouveaux partent vite." },
    ],
    trap: { de: "Die Falle: noch mehr Agenturen anrufen. Mehr Lebensläufe heißt nicht mehr Pflegekräfte.", en: "The trap: calling even more agencies. More CVs does not mean more nurses.", fr: "Le piège : appeler encore plus d'agences. Plus de CV ne veut pas dire plus d'infirmières." },
  },
  2: {
    name: { de: "Lückenfüller", en: "Gap filler", fr: "Bouche-trou" },
    line: { de: "Leihkräfte halten den Betrieb am Laufen.", en: "Agency staff keep the house running.", fr: "L'intérim fait tourner la maison." },
    looks: [
      { de: "Die meisten Schichten sind besetzt, aber teuer.", en: "Most shifts are covered, but at a high price.", fr: "La plupart des gardes sont couvertes, mais cher." },
      { de: "Sie stellen ein, aber einzeln und ohne Plan.", en: "You hire, but one by one and without a plan.", fr: "Vous recrutez, mais une par une, sans plan." },
      { de: "Pflegekräfte aus dem Ausland: manche bleiben, manche nicht.", en: "Nurses from abroad: some stay, some don't.", fr: "Infirmières de l'étranger : certaines restent, d'autres non." },
    ],
    trap: { de: "Die Falle: die billigste Vermittlung nehmen. Wenn sie in der Probezeit geht, zahlen Sie alles doppelt.", en: "The trap: choosing the cheapest agency. If she leaves in probation, you pay for everything twice.", fr: "Le piège : prendre l'agence la moins chère. Si elle part pendant l'essai, vous payez tout deux fois." },
  },
  3: {
    name: { de: "Stabil, aber teuer", en: "Stable, but costly", fr: "Stable, mais coûteux" },
    line: { de: "Die Stellen sind besetzt. Aber es kostet zu viel.", en: "Posts are filled. But it costs too much.", fr: "Les postes sont pourvus. Mais ça coûte trop cher." },
    looks: [
      { de: "Wenige offene Stellen, aber jedes Jahr gehen Leute.", en: "Few open posts, but people leave every year.", fr: "Peu de postes vides, mais des départs chaque année." },
      { de: "Neue Pflegekräfte kommen, wenn es brennt, nicht nach Plan.", en: "New nurses come when there is a fire, not by plan.", fr: "Les nouvelles arrivent dans l'urgence, pas selon un plan." },
      { de: "Einarbeitung hängt davon ab, wer gerade Zeit hat.", en: "Onboarding depends on who has time that day.", fr: "L'intégration dépend de qui a le temps ce jour-là." },
    ],
    trap: { de: "Die Falle: sich ausruhen. Ohne festen Rhythmus rutschen Sie bei zwei Kündigungen zurück auf Stufe 2.", en: "The trap: relaxing. Without a fixed rhythm, two resignations put you back on level 2.", fr: "Le piège : se relâcher. Sans rythme fixe, deux départs vous ramènent au niveau 2." },
  },
  4: {
    name: { de: "Planbar", en: "Predictable", fr: "Prévisible" },
    line: { de: "Sie wissen Monate vorher, wer kommt.", en: "You know months ahead who is coming.", fr: "Vous savez des mois à l'avance qui arrive." },
    looks: [
      { de: "Neue Pflegekräfte kommen in Gruppen, nach Plan.", en: "New nurses arrive in groups, by plan.", fr: "Les nouvelles arrivent en groupe, selon un plan." },
      { de: "Jede hat eine feste Patin und einen 90-Tage-Plan.", en: "Each one has a fixed mentor and a 90-day plan.", fr: "Chacune a une marraine fixe et un plan de 90 jours." },
      { de: "Leihkräfte nur noch für Spitzen, nicht für den Alltag.", en: "Agency staff only for peaks, not every day.", fr: "L'intérim seulement pour les pics, pas au quotidien." },
    ],
    trap: { de: "Die Falle: nur auf neue Leute schauen. Die nächste Stufe gewinnen Sie mit denen, die schon da sind.", en: "The trap: only looking at new people. You win the next level with the ones already there.", fr: "Le piège : ne regarder que les nouvelles. Le niveau suivant se gagne avec celles qui sont déjà là." },
  },
  5: {
    name: { de: "Magnet", en: "Magnet", fr: "Aimant" },
    line: { de: "Pflegekräfte wollen zu Ihnen. Und sie bleiben.", en: "Nurses want to work for you. And they stay.", fr: "Les infirmières veulent venir chez vous. Et elles restent." },
    looks: [
      { de: "Ihre Pflegekräfte holen Freundinnen und Familie nach.", en: "Your nurses bring friends and family.", fr: "Vos infirmières font venir amies et famille." },
      { de: "Fast niemand geht in den ersten zwei Jahren.", en: "Almost nobody leaves in the first two years.", fr: "Presque personne ne part dans les deux premières années." },
      { de: "Leihkräfte sind die Ausnahme.", en: "Agency staff are the exception.", fr: "L'intérim est l'exception." },
    ],
    trap: { de: "Die Falle: aufhören zu messen. Bleiben Sie dran, jedes Quartal.", en: "The trap: stopping to measure. Keep checking, every quarter.", fr: "Le piège : arrêter de mesurer. Gardez le cap, chaque trimestre." },
  },
};

/** How to climb ONE level from where they are. Level 5 = how to stay there. */
export const CLIMB: Record<Level, { goal: L; steps: { t: L; d: L }[] }> = {
  1: {
    goal: { de: "Von Stufe 1 auf Stufe 2: die Blutung stoppen.", en: "From level 1 to level 2: stop the bleeding.", fr: "Du niveau 1 au niveau 2 : arrêter l'hémorragie." },
    steps: [
      { t: { de: "Liste machen", en: "Make a list", fr: "Faire une liste" }, d: { de: "Schreiben Sie jede offene Stelle auf. Daneben: wie viele Betten deshalb leer sind. Fangen Sie mit der teuersten an.", en: "Write down every open post. Next to it: how many beds are empty because of it. Start with the most expensive one.", fr: "Notez chaque poste vide. À côté : combien de lits restent vides à cause de lui. Commencez par le plus cher." } },
      { t: { de: "Eine gute Quelle statt fünf", en: "One good source, not five", fr: "Une bonne source, pas cinq" }, d: { de: "Wählen Sie EINE Quelle für Pflegekräfte aus dem Ausland, die Deutsch vorher prüft und die Papiere macht. Fünf Agenturen heißt: fünfmal Lebensläufe, keinmal Pflegekraft.", en: "Pick ONE source for nurses from abroad that checks German first and does the paperwork. Five agencies means five piles of CVs and zero nurses.", fr: "Choisissez UNE source d'infirmières de l'étranger qui vérifie l'allemand avant et gère les papiers. Cinq agences, c'est cinq piles de CV et zéro infirmière." } },
      { t: { de: "Patin vorher festlegen", en: "Pick a mentor first", fr: "Choisir une marraine avant" }, d: { de: "Bevor die neue Pflegekraft kommt, steht fest, wer ihre Patin ist. Ohne Patin gehen die meisten wieder.", en: "Before the new nurse arrives, decide who her mentor is. Without a mentor, most leave again.", fr: "Avant l'arrivée, décidez qui sera sa marraine. Sans marraine, la plupart repartent." } },
      { t: { de: "Leihkräfte im Block buchen", en: "Book agency staff in blocks", fr: "Réserver l'intérim en bloc" }, d: { de: "Buchen Sie Leihkräfte für feste Monate, nicht Schicht für Schicht. Das ist billiger und planbar, bis Ihre eigenen Leute da sind.", en: "Book agency staff for fixed months, not shift by shift. It is cheaper and you can plan until your own people arrive.", fr: "Réservez l'intérim par mois fixes, pas garde par garde. C'est moins cher et prévisible jusqu'à l'arrivée de vos équipes." } },
    ],
  },
  2: {
    goal: { de: "Von Stufe 2 auf Stufe 3: weg von Leihkräften.", en: "From level 2 to level 3: get off agency staff.", fr: "Du niveau 2 au niveau 3 : sortir de l'intérim." },
    steps: [
      { t: { de: "In Gruppen einstellen", en: "Hire in groups", fr: "Recruter en groupe" }, d: { de: "Holen Sie 3 bis 5 Pflegekräfte zusammen, nicht eine allein. Sie helfen sich gegenseitig, und weniger gehen.", en: "Bring 3 to 5 nurses together, not one alone. They help each other, and fewer leave.", fr: "Faites venir 3 à 5 infirmières ensemble, pas une seule. Elles s'entraident, et moins partent." } },
      { t: { de: "Rückwärts planen", en: "Plan backwards", fr: "Planifier à rebours" }, d: { de: "Anerkennung und Visum dauern Monate. Nehmen Sie das Datum, an dem Sie die Pflegekraft brauchen, und rechnen Sie von dort zurück. Starten Sie jetzt.", en: "Recognition and visa take months. Take the date you need the nurse and count back from there. Start now.", fr: "La reconnaissance et le visa prennent des mois. Partez de la date où vous en avez besoin et comptez à rebours. Commencez maintenant." } },
      { t: { de: "Den 90-Tage-Plan nutzen", en: "Use the 90-day plan", fr: "Utiliser le plan de 90 jours" }, d: { de: "Nehmen Sie den Plan auf Seite 7 Ihres PDFs. Jede neue Pflegekraft bekommt eine Patin mit 2 Stunden pro Woche.", en: "Use the plan on page 7 of your PDF. Every new nurse gets a mentor with 2 hours a week.", fr: "Prenez le plan de la page 7 de votre PDF. Chaque nouvelle reçoit une marraine avec 2 heures par semaine." } },
      { t: { de: "Eine Zahl messen", en: "Measure one number", fr: "Mesurer un chiffre" }, d: { de: "Wie viele schaffen die Probezeit? Ziel: mindestens 85 von 100. Schreiben Sie die Zahl jeden Monat auf.", en: "How many pass probation? Goal: at least 85 out of 100. Write the number down every month.", fr: "Combien réussissent la période d'essai ? Objectif : au moins 85 sur 100. Notez le chiffre chaque mois." } },
    ],
  },
  3: {
    goal: { de: "Von Stufe 3 auf Stufe 4: aus Feuerwehr wird Plan.", en: "From level 3 to level 4: turn firefighting into a plan.", fr: "Du niveau 3 au niveau 4 : passer de l'urgence au plan." },
    steps: [
      { t: { de: "Fester Rhythmus", en: "A fixed rhythm", fr: "Un rythme fixe" }, d: { de: "Eine neue Gruppe jedes Quartal, auch wenn gerade alles besetzt ist. Kündigungen kommen sicher, nur nicht wann.", en: "A new group every quarter, even when everything is filled. Resignations will come, you just don't know when.", fr: "Un nouveau groupe chaque trimestre, même quand tout est pourvu. Les départs viendront, on ne sait juste pas quand." } },
      { t: { de: "Leihkräfte Schritt für Schritt abbauen", en: "Cut agency staff step by step", fr: "Réduire l'intérim pas à pas" }, d: { de: "Jede neue Pflegekraft, die bleibt, ersetzt etwa 160 Stunden Leihkräfte im Monat. Kündigen Sie die Leihstunden im gleichen Tempo.", en: "Every new nurse who stays replaces about 160 agency hours a month. Cancel agency hours at the same pace.", fr: "Chaque nouvelle infirmière qui reste remplace environ 160 heures d'intérim par mois. Réduisez l'intérim au même rythme." } },
      { t: { de: "Ehrlich beim Lohn", en: "Be honest about pay", fr: "Être honnête sur le salaire" }, d: { de: "Schreiben Sie ins Angebot: Lohn während der Anerkennung, Lohn danach, ab wann. Überraschungen beim Gehalt sind ein Hauptgrund zu gehen.", en: "Write it in the offer: pay during recognition, pay after, from when. Surprises in the payslip are a main reason to leave.", fr: "Écrivez-le dans l'offre : salaire pendant la reconnaissance, salaire après, à partir de quand. Les surprises sur la fiche de paie font partir." } },
      { t: { de: "Jedes Gehen verstehen", en: "Understand every departure", fr: "Comprendre chaque départ" }, d: { de: "Wer geht, bekommt ein 15-Minuten-Gespräch. Schreiben Sie den Grund auf. Nach drei Gesprächen sehen Sie das Muster.", en: "Everyone who leaves gets a 15-minute talk. Write down the reason. After three talks you see the pattern.", fr: "Chaque départ a droit à un entretien de 15 minutes. Notez la raison. Après trois entretiens, vous voyez le schéma." } },
    ],
  },
  4: {
    goal: { de: "Von Stufe 4 auf Stufe 5: werden Sie zum Magnet.", en: "From level 4 to level 5: become a magnet.", fr: "Du niveau 4 au niveau 5 : devenir un aimant." },
    steps: [
      { t: { de: "Ihre Leute werben lassen", en: "Let your people recruit", fr: "Laisser vos équipes recruter" }, d: { de: "Eine Prämie für jede Freundin von zu Hause, die kommt und bleibt. Die besten Pflegekräfte kennen andere gute Pflegekräfte.", en: "A bonus for every friend from home who comes and stays. The best nurses know other good nurses.", fr: "Une prime pour chaque amie du pays qui vient et reste. Les meilleures infirmières en connaissent d'autres." } },
      { t: { de: "Karriere zeigen", en: "Show a career", fr: "Montrer une carrière" }, d: { de: "Praxisanleitung, Weiterbildung, Teamleitung: zeigen Sie im ersten Jahr, wohin der Weg geht.", en: "Mentoring students, further training, team lead: show in year one where the road goes.", fr: "Tutorat, formation continue, chef d'équipe : montrez dès la première année où mène le chemin." } },
      { t: { de: "Familie mitdenken", en: "Think of the family", fr: "Penser à la famille" }, d: { de: "Helfen Sie beim Familiennachzug: Partner, Kinder, Schule, Kita. Wer seine Familie hier hat, bleibt Jahre.", en: "Help with bringing the family: partner, children, school, daycare. People with their family here stay for years.", fr: "Aidez au regroupement familial : conjoint, enfants, école, crèche. Avec la famille ici, on reste des années." } },
      { t: { de: "Darüber reden", en: "Talk about it", fr: "En parler" }, d: { de: "Zeigen Sie öffentlich, wie Ihr internationales Team arbeitet. Gute Geschichten holen gute Leute.", en: "Show publicly how your international team works. Good stories attract good people.", fr: "Montrez publiquement comment travaille votre équipe internationale. Les belles histoires attirent les bonnes personnes." } },
    ],
  },
  5: {
    goal: { de: "Auf Stufe 5 bleiben.", en: "Staying on level 5.", fr: "Rester au niveau 5." },
    steps: [
      { t: { de: "Rhythmus halten", en: "Keep the rhythm", fr: "Garder le rythme" }, d: { de: "Weiter jedes Quartal eine Gruppe, auch in guten Zeiten.", en: "Keep one group every quarter, also in good times.", fr: "Continuez un groupe par trimestre, même quand tout va bien." } },
      { t: { de: "Paten ausbilden", en: "Train mentors", fr: "Former les marraines" }, d: { de: "Ihre erfahrenen Pflegekräfte aus dem Ausland werden Patinnen für die nächsten.", en: "Your experienced nurses from abroad become mentors for the next ones.", fr: "Vos infirmières expérimentées venues de l'étranger deviennent marraines des suivantes." } },
      { t: { de: "Jedes Quartal messen", en: "Measure every quarter", fr: "Mesurer chaque trimestre" }, d: { de: "Offene Stellen, Kündigungen, Leihstunden. Drei Zahlen, einmal im Quartal.", en: "Open posts, resignations, agency hours. Three numbers, once a quarter.", fr: "Postes vides, départs, heures d'intérim. Trois chiffres, une fois par trimestre." } },
    ],
  },
};

export const BOTTLENECK: Record<RoadmapResult["bottleneck"], { t: L; d: L }> = {
  fill: { t: { de: "Ihr Engpass: Stellen füllen", en: "Your bottleneck: filling posts", fr: "Votre blocage : pourvoir les postes" }, d: { de: "Bei Ihnen kostet am meisten, dass Stellen leer sind. Jeder Monat ohne Pflegekraft ist Geld, das nicht zurückkommt. Starten Sie den Weg zur neuen Pflegekraft heute, denn er dauert Monate.", en: "What costs you most is posts staying empty. Every month without a nurse is money that never comes back. Start the road to a new nurse today, because it takes months.", fr: "Ce qui vous coûte le plus, ce sont les postes vides. Chaque mois sans infirmière est de l'argent perdu pour toujours. Commencez aujourd'hui, car le chemin prend des mois." } },
  keep: { t: { de: "Ihr Engpass: Pflegekräfte halten", en: "Your bottleneck: keeping nurses", fr: "Votre blocage : garder les infirmières" }, d: { de: "Bei Ihnen kostet am meisten, dass Pflegekräfte wieder gehen. Jede, die geht, kostet Sie den ganzen Weg noch einmal. Mehr einstellen hilft hier nicht. Besser ankommen lassen hilft.", en: "What costs you most is nurses leaving again. Each one who leaves costs you the whole road again. Hiring more does not fix this. Helping them settle in does.", fr: "Ce qui vous coûte le plus, ce sont les départs. Chaque départ vous coûte tout le chemin une deuxième fois. Recruter plus n'aide pas. Mieux accueillir, oui." } },
  agency: { t: { de: "Ihr Engpass: zu viele Leihkräfte", en: "Your bottleneck: too much agency staff", fr: "Votre blocage : trop d'intérim" }, d: { de: "Bei Ihnen frisst die Leiharbeit das Geld. Leihkräfte lösen das Problem für heute, aber nie für morgen. Jede eigene Pflegekraft, die bleibt, ersetzt etwa 160 Leihstunden im Monat.", en: "Agency staff are eating your money. They fix today, never tomorrow. Every nurse of your own who stays replaces about 160 agency hours a month.", fr: "L'intérim mange votre argent. Il règle aujourd'hui, jamais demain. Chaque infirmière à vous qui reste remplace environ 160 heures d'intérim par mois." } },
  process: { t: { de: "Ihr Engpass: Papiere und Ämter", en: "Your bottleneck: paperwork and offices", fr: "Votre blocage : papiers et administrations" }, d: { de: "Bei Ihnen hängt es an Anerkennung, Visum und Ämtern. Das ist lösbar: mit einem klaren Zeitplan und jemandem, der die Papiere jeden Tag macht.", en: "You are stuck on recognition, visa and offices. That can be solved: with a clear timeline and someone who does the paperwork every day.", fr: "Vous êtes bloqué par la reconnaissance, le visa et les administrations. C'est soluble : un calendrier clair et quelqu'un qui gère les papiers chaque jour." } },
  language: { t: { de: "Ihr Engpass: Deutsch auf Station", en: "Your bottleneck: German on the ward", fr: "Votre blocage : l'allemand en service" }, d: { de: "Bei Ihnen scheitert es an der Sprache. Ein Zertifikat ist nicht genug. Prüfen Sie das Deutsch für den Stationsalltag, bevor Sie zusagen, und üben Sie Übergabe und Telefon im Dienst.", en: "Language is where it fails for you. A certificate is not enough. Check German for real ward work before you say yes, and practise handovers and phone calls on the job.", fr: "Chez vous, c'est la langue qui bloque. Un certificat ne suffit pas. Vérifiez l'allemand du quotidien avant de dire oui, et entraînez transmissions et téléphone en service." } },
};

export const PLAN_90: { when: L; items: L[] }[] = [
  { when: { de: "Bevor sie kommt", en: "Before she arrives", fr: "Avant son arrivée" }, items: [
    { de: "Wohnung fertig: möbliert, nah, bezahlbar.", en: "Flat ready: furnished, close, affordable.", fr: "Logement prêt : meublé, proche, abordable." },
    { de: "Patin steht fest und hat sich per Video vorgestellt.", en: "Mentor chosen and has said hello by video.", fr: "Marraine choisie, elle s'est présentée en vidéo." },
    { de: "Dienstplan der ersten zwei Wochen ist fertig.", en: "Rota for the first two weeks is done.", fr: "Planning des deux premières semaines prêt." },
  ] },
  { when: { de: "Tag 1", en: "Day 1", fr: "Jour 1" }, items: [
    { de: "Abholen am Bahnhof oder Flughafen.", en: "Pick her up at the station or airport.", fr: "L'accueillir à la gare ou à l'aéroport." },
    { de: "Rundgang, Spind, Kleidung, Zugänge.", en: "Tour, locker, uniform, logins.", fr: "Visite, casier, tenue, accès." },
    { de: "Mittagessen mit dem Team.", en: "Lunch with the team.", fr: "Déjeuner avec l'équipe." },
  ] },
  { when: { de: "Woche 1", en: "Week 1", fr: "Semaine 1" }, items: [
    { de: "Nur mitlaufen, mit der Patin.", en: "Only shadowing, with the mentor.", fr: "Seulement en binôme avec la marraine." },
    { de: "Anmeldung, Bankkonto, Krankenkasse erledigen.", en: "Registration, bank account, health insurance done.", fr: "Déclaration de domicile, banque, assurance maladie faites." },
    { de: "Jeden Tag 10 Minuten: Wie war es?", en: "10 minutes every day: how was it?", fr: "10 minutes chaque jour : comment ça s'est passé ?" },
  ] },
  { when: { de: "Monat 1", en: "Month 1", fr: "Mois 1" }, items: [
    { de: "Deutsch für die Arbeit üben: Übergabe, Doku, Telefon.", en: "Practise German for work: handover, notes, phone.", fr: "Pratiquer l'allemand du travail : transmissions, dossier, téléphone." },
    { de: "Erstes Feedback-Gespräch, in Ruhe.", en: "First feedback talk, without rush.", fr: "Premier entretien de retour, au calme." },
  ] },
  { when: { de: "Monat 2", en: "Month 2", fr: "Mois 2" }, items: [
    { de: "Eigene Patienten, mit Rückhalt.", en: "Her own patients, with backup.", fr: "Ses propres patients, avec soutien." },
    { de: "Nächste Schritte der Anerkennung mit Datum.", en: "Next recognition steps, with dates.", fr: "Prochaines étapes de reconnaissance, avec dates." },
    { de: "Leben außerhalb der Arbeit: Sport, Gemeinde, Landsleute.", en: "Life outside work: sport, community, people from home.", fr: "Vie hors travail : sport, communauté, compatriotes." },
  ] },
  { when: { de: "Monat 3", en: "Month 3", fr: "Mois 3" }, items: [
    { de: "Gespräch: Wie geht es dir wirklich?", en: "Talk: how are you really?", fr: "Entretien : comment vas-tu vraiment ?" },
    { de: "Plan für Familie und Karriere.", en: "Plan for family and career.", fr: "Plan pour la famille et la carrière." },
  ] },
];

export const REASONS: { why: L; fix: L }[] = [
  { why: { de: "Keine gute Wohnung", en: "No good flat", fr: "Pas de bon logement" }, fix: { de: "Wohnung vor der Ankunft organisieren.", en: "Arrange the flat before she arrives.", fr: "Trouver le logement avant l'arrivée." } },
  { why: { de: "Allein, ohne Anschluss", en: "Alone, no friends", fr: "Seule, sans contacts" }, fix: { de: "Patin, Gruppe und Kontakt zu Landsleuten.", en: "Mentor, a group, and contact with people from home.", fr: "Marraine, groupe et contact avec des compatriotes." } },
  { why: { de: "Deutsch im Stress", en: "German under stress", fr: "L'allemand sous pression" }, fix: { de: "Üben im Dienst, nicht nur im Kurs.", en: "Practise on the job, not only in class.", fr: "S'entraîner en service, pas seulement en cours." } },
  { why: { de: "Weniger Lohn als gedacht", en: "Less pay than expected", fr: "Moins payée que prévu" }, fix: { de: "Lohn und Zeitplan der Anerkennung schriftlich, ehrlich.", en: "Pay and recognition timeline in writing, honestly.", fr: "Salaire et calendrier de reconnaissance par écrit, honnêtement." } },
  { why: { de: "Die Familie fehlt", en: "Missing her family", fr: "La famille manque" }, fix: { de: "Familiennachzug früh planen.", en: "Plan bringing the family early.", fr: "Prévoir tôt le regroupement familial." } },
  { why: { de: "Nur als Hilfskraft eingesetzt", en: "Treated like a helper", fr: "Traitée comme une aide" }, fix: { de: "Ihr Können nutzen, Aufgaben steigern.", en: "Use her skills, give her more over time.", fr: "Utiliser ses compétences, augmenter les tâches." } },
  { why: { de: "Niemand, der zuhört", en: "Nobody who listens", fr: "Personne pour écouter" }, fix: { de: "Eine feste Person und regelmäßige Gespräche.", en: "One fixed person and regular talks.", fr: "Une personne fixe et des échanges réguliers." } },
];

/** Labels for the PDF and the result card. */
export const UI: Record<Lang, Record<string, string>> = {
  de: {
    title: "Ihr Pflege-Fahrplan", for: "Erstellt für", level: "Stufe", of5: "von 5",
    numbers: "Ihre Zahlen", openPosts: "Offene Stellen kosten Sie", leaving: "Pflegekräfte, die gingen, kosten Sie",
    total: "Zusammen pro Jahr", perMonth: "pro Monat", perYear: "pro Jahr",
    perNurse: "Jede Pflegekraft, die bleibt, bringt Ihnen etwa", howCounted: "So rechnen wir",
    openModel: "Eine offene Stelle: 160 Stunden Leihkräfte à 55 € plus 3 leere Betten à 3.200 € im Monat = 18.400 € pro Monat.",
    leaveModel: "Eine Pflegekraft, die geht: 3 Monate Leihkräfte (26.400 €) + verlorene Einarbeitung (5.400 €) + Suche nach der Nächsten (8.000 €) = 39.800 €.",
    ownNumbers: "Ihre echten Zahlen sind anders? Wir rechnen sie im Gespräch mit Ihnen durch.",
    ladder: "Die 5 Stufen", youAreHere: "Sie sind hier", looks: "So sieht es aus", plan: "Ihr Plan für die nächste Stufe",
    plan90: "Der 90-Tage-Bleibe-Plan", plan90sub: "Für jede neue Pflegekraft aus dem Ausland. Zum Ausdrucken und Abhaken.",
    reasons: "7 Gründe, warum Pflegekräfte gehen", reasonsSub: "Und was dagegen hilft.", why: "Warum", fix: "Was hilft",
    next: "Ihr nächster Schritt", nextBody: "Sie können diesen Plan allein umsetzen. Schneller geht es mit uns: Sie führen ein Interview, wir machen den Rest, bis die Pflegekraft die Probezeit geschafft hat. Wir arbeiten pro Runde mit höchstens 10 Häusern. In 15 Minuten prüfen wir, ob Ihr Haus passt.",
    book: "Prüfen, ob mein Haus passt", contact: "Oder schreiben Sie uns", page: "Seite",
    disclaimer: "Alle Beträge sind Schätzungen aus Ihren Angaben und einem einfachen Rechenmodell.",
    lossYear: "Leere Stellen und Kündigungen kosten Sie etwa", inside: "In diesem Fahrplan",
    toc: "Sie sind hier|Ihre Stufe|Ihre Zahlen|Bereich für Bereich|Ihr Plan für die nächste Stufe|Der 90-Tage-Bleibe-Plan|7 Gründe, warum Pflegekräfte gehen|Davor und danach|Passt Ihr Haus?",
    e90: "Zum Abhaken", eReasons: "Woran es scheitert", eNext: "Kostenlos",
    callGet: "Im Gespräch bekommen Sie", callPts: "Ihre echten Zahlen, auf den Euro|Passende Profile (ohne Namen)|Ihren Zeitplan bis zum ersten Arbeitstag",
  },
  en: {
    title: "Your nurse staffing roadmap", for: "Prepared for", level: "Level", of5: "of 5",
    numbers: "Your numbers", openPosts: "Open posts cost you", leaving: "Nurses who left cost you",
    total: "Together per year", perMonth: "per month", perYear: "per year",
    perNurse: "Every nurse who stays brings you about", howCounted: "How we count",
    openModel: "One open post: 160 agency hours at €55 plus 3 empty beds at €3,200 a month = €18,400 a month.",
    leaveModel: "One nurse who leaves: 3 months of agency staff (€26,400) + lost onboarding (€5,400) + finding the next one (€8,000) = €39,800.",
    ownNumbers: "Your real numbers are different? We go through them with you on a call.",
    ladder: "The 5 levels", youAreHere: "You are here", looks: "What it looks like", plan: "Your plan for the next level",
    plan90: "The 90-day stay plan", plan90sub: "For every new nurse from abroad. Print it and tick it off.",
    reasons: "7 reasons nurses leave", reasonsSub: "And what helps.", why: "Why", fix: "What helps",
    next: "Your next step", nextBody: "You can do this plan on your own. It is faster with us: you do one interview, we do the rest, until the nurse has passed probation. We work with at most 10 employers per group. In 15 minutes we check if your facility is a fit.",
    book: "Check if we are a fit", contact: "Or write to us", page: "Page",
    disclaimer: "All amounts are estimates from your answers and a simple model.",
    lossYear: "Empty posts and resignations cost you about", inside: "In this roadmap",
    toc: "You are here|Your level|Your numbers|Area by area|Your plan for the next level|The 90-day stay plan|7 reasons nurses leave|Before and after|Are you a fit?",
    e90: "To tick off", eReasons: "Why it fails", eNext: "Free",
    callGet: "On the call you get", callPts: "Your real numbers, to the euro|Matching profiles (no names)|Your timeline to her first day at work",
  },
  fr: {
    title: "Votre plan infirmier", for: "Préparé pour", level: "Niveau", of5: "sur 5",
    numbers: "Vos chiffres", openPosts: "Les postes vides vous coûtent", leaving: "Les départs vous coûtent",
    total: "Au total par an", perMonth: "par mois", perYear: "par an",
    perNurse: "Chaque infirmière qui reste vous rapporte environ", howCounted: "Notre calcul",
    openModel: "Un poste vide : 160 heures d'intérim à 55 € plus 3 lits vides à 3 200 € par mois = 18 400 € par mois.",
    leaveModel: "Un départ : 3 mois d'intérim (26 400 €) + intégration perdue (5 400 €) + recherche de la suivante (8 000 €) = 39 800 €.",
    ownNumbers: "Vos vrais chiffres sont différents ? Nous les calculons avec vous pendant un appel.",
    ladder: "Les 5 niveaux", youAreHere: "Vous êtes ici", looks: "À quoi ça ressemble", plan: "Votre plan pour le niveau suivant",
    plan90: "Le plan de 90 jours pour qu'elle reste", plan90sub: "Pour chaque nouvelle infirmière de l'étranger. À imprimer et cocher.",
    reasons: "7 raisons pour lesquelles les infirmières partent", reasonsSub: "Et ce qui aide.", why: "Pourquoi", fix: "Ce qui aide",
    next: "Votre prochaine étape", nextBody: "Vous pouvez suivre ce plan seul. C'est plus rapide avec nous : vous faites un entretien, nous faisons le reste, jusqu'à la fin de la période d'essai. Nous travaillons avec 10 employeurs au maximum par groupe. En 15 minutes, nous vérifions si votre établissement correspond.",
    book: "Vérifier si nous correspondons", contact: "Ou écrivez-nous", page: "Page",
    disclaimer: "Tous les montants sont des estimations à partir de vos réponses et d'un modèle simple.",
    lossYear: "Les postes vides et les départs vous coûtent environ", inside: "Dans ce plan",
    toc: "Vous êtes ici|Votre niveau|Vos chiffres|Domaine par domaine|Votre plan pour le niveau suivant|Le plan de 90 jours|7 raisons pour lesquelles elles partent|Avant et après|Correspondez-vous ?",
    e90: "À cocher", eReasons: "Pourquoi ça échoue", eNext: "Gratuit",
    callGet: "Pendant l'appel, vous recevez", callPts: "Vos vrais chiffres, à l'euro près|Des profils adaptés (sans nom)|Votre calendrier jusqu'à son premier jour",
  },
};
