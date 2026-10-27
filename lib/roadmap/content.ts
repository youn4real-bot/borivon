/**
 * The Pflege-Fahrplan's content: what Borivon knows about getting nurses AND
 * keeping them. Founder rule (2026-10-22): write it so a 5-year-old could
 * follow. Tiny sentences, everyday words, one idea at a time. Used by the PDF,
 * the page and the emails.
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
    line: { de: "Jeden Tag fehlen Leute.", en: "People are missing every day.", fr: "Il manque du monde chaque jour." },
    looks: [
      { de: "Viele Stellen sind leer.", en: "Many posts are empty.", fr: "Beaucoup de postes sont vides." },
      { de: "Leihkräfte füllen die Löcher.", en: "Agency staff fill the holes.", fr: "L'intérim bouche les trous." },
      { de: "Das Team ist müde.", en: "The team is tired.", fr: "L'équipe est fatiguée." },
    ],
    trap: { de: "Vorsicht: Mehr Agenturen helfen nicht. Viele Lebensläufe sind noch keine Pflegekraft.", en: "Watch out: more agencies won't help. A pile of CVs is not a nurse.", fr: "Attention : plus d'agences n'aident pas. Une pile de CV n'est pas une infirmière." },
  },
  2: {
    name: { de: "Lückenfüller", en: "Gap filler", fr: "Bouche-trou" },
    line: { de: "Leihkräfte stopfen die Löcher.", en: "Agency staff plug the holes.", fr: "L'intérim bouche les trous." },
    looks: [
      { de: "Die Schichten sind voll. Aber teuer.", en: "Shifts are full. But costly.", fr: "Les gardes sont pleines. Mais chères." },
      { de: "Sie stellen eine nach der anderen ein.", en: "You hire one person at a time.", fr: "Vous recrutez une personne à la fois." },
      { de: "Manche Neue bleiben. Manche nicht.", en: "Some new nurses stay. Some don't.", fr: "Certaines restent. D'autres non." },
    ],
    trap: { de: "Vorsicht: Die billigste Agentur wird oft die teuerste. Geht die Pflegekraft wieder, zahlen Sie doppelt.", en: "Watch out: the cheapest agency often ends up the most costly. If she leaves, you pay twice.", fr: "Attention : l'agence la moins chère finit souvent la plus chère. Si elle part, vous payez deux fois." },
  },
  3: {
    name: { de: "Stabil, aber teuer", en: "Stable, but costly", fr: "Stable, mais coûteux" },
    line: { de: "Alles ist besetzt. Aber es kostet zu viel.", en: "Everything is filled. But it costs too much.", fr: "Tout est pourvu. Mais ça coûte trop cher." },
    looks: [
      { de: "Wenige Stellen sind leer.", en: "Few posts are empty.", fr: "Peu de postes sont vides." },
      { de: "Aber jedes Jahr gehen Leute.", en: "But people leave every year.", fr: "Mais des gens partent chaque année." },
      { de: "Neue kommen erst, wenn es brennt.", en: "New nurses only come when there is a fire.", fr: "Les nouvelles n'arrivent qu'en urgence." },
    ],
    trap: { de: "Vorsicht: Nicht ausruhen. Zwei Kündigungen, und Sie sind wieder auf Stufe 2.", en: "Watch out: don't relax. Two resignations and you are back on level 2.", fr: "Attention : ne vous relâchez pas. Deux départs, et vous revoilà au niveau 2." },
  },
  4: {
    name: { de: "Planbar", en: "Predictable", fr: "Prévisible" },
    line: { de: "Sie wissen früh, wer kommt.", en: "You know early who is coming.", fr: "Vous savez tôt qui arrive." },
    looks: [
      { de: "Neue kommen in Gruppen.", en: "New nurses come in groups.", fr: "Les nouvelles arrivent en groupe." },
      { de: "Jede Neue hat eine Patin.", en: "Every new nurse has a mentor.", fr: "Chaque nouvelle a une marraine." },
      { de: "Leihkräfte nur noch selten.", en: "Agency staff only now and then.", fr: "L'intérim seulement de temps en temps." },
    ],
    trap: { de: "Vorsicht: Nicht nur auf Neue schauen. Die nächste Stufe schaffen Sie mit den Leuten, die schon da sind.", en: "Watch out: don't only look at new people. You reach the next level with the people you already have.", fr: "Attention : ne regardez pas que les nouvelles. Le niveau suivant se gagne avec celles qui sont déjà là." },
  },
  5: {
    name: { de: "Magnet", en: "Magnet", fr: "Aimant" },
    line: { de: "Pflegekräfte wollen zu Ihnen. Und sie bleiben.", en: "Nurses want to work for you. And they stay.", fr: "Les infirmières veulent venir. Et elles restent." },
    looks: [
      { de: "Ihre Leute holen Freunde.", en: "Your people bring friends.", fr: "Vos équipes amènent des amies." },
      { de: "Fast niemand geht.", en: "Almost nobody leaves.", fr: "Presque personne ne part." },
      { de: "Leihkräfte braucht es kaum.", en: "You hardly need agency staff.", fr: "Presque plus besoin d'intérim." },
    ],
    trap: { de: "Vorsicht: Nicht aufhören zu zählen. Schauen Sie jedes Quartal auf Ihre Zahlen.", en: "Watch out: don't stop counting. Check your numbers every quarter.", fr: "Attention : ne cessez pas de compter. Regardez vos chiffres chaque trimestre." },
  },
};

/** How to climb ONE level from where they are. Level 5 = how to stay there. */
export const CLIMB: Record<Level, { goal: L; steps: { t: L; d: L }[] }> = {
  1: {
    goal: { de: "Von Stufe 1 auf 2: Erst mal kein Geld mehr verlieren.", en: "From level 1 to 2: first, stop losing money.", fr: "Du niveau 1 au 2 : d'abord, arrêter de perdre de l'argent." },
    steps: [
      { t: { de: "Liste machen", en: "Make a list", fr: "Faire une liste" }, d: { de: "Schreiben Sie jede leere Stelle auf. Fangen Sie mit der teuersten an.", en: "Write down every empty post. Start with the most costly one.", fr: "Notez chaque poste vide. Commencez par le plus cher." } },
      { t: { de: "Ein Partner, nicht fünf", en: "One partner, not five", fr: "Un partenaire, pas cinq" }, d: { de: "Nehmen Sie einen Partner. Er prüft das Deutsch und macht die Papiere.", en: "Pick one partner. They check German and do the papers.", fr: "Prenez un seul partenaire. Il vérifie l'allemand et fait les papiers." } },
      { t: { de: "Zuerst eine Patin", en: "A mentor first", fr: "D'abord une marraine" }, d: { de: "Bevor die Neue kommt, wissen Sie: Wer hilft ihr? Ohne Patin gehen viele wieder.", en: "Before she comes, know who will help her. Without a mentor, many leave.", fr: "Avant son arrivée, sachez qui l'aidera. Sans marraine, beaucoup repartent." } },
      { t: { de: "Leihkräfte im Block", en: "Agency staff in blocks", fr: "L'intérim en bloc" }, d: { de: "Buchen Sie Leihkräfte für ganze Monate. Das ist billiger als jede Schicht einzeln.", en: "Book agency staff for whole months. It is cheaper than shift by shift.", fr: "Réservez l'intérim pour des mois entiers. C'est moins cher que garde par garde." } },
    ],
  },
  2: {
    goal: { de: "Von Stufe 2 auf 3: Weniger Leihkräfte.", en: "From level 2 to 3: less agency staff.", fr: "Du niveau 2 au 3 : moins d'intérim." },
    steps: [
      { t: { de: "In Gruppen holen", en: "Hire in groups", fr: "Recruter en groupe" }, d: { de: "Holen Sie 3 bis 5 Pflegekräfte auf einmal. Zusammen bleiben sie eher.", en: "Bring 3 to 5 nurses at once. Together, they stay.", fr: "Faites venir 3 à 5 infirmières à la fois. Ensemble, elles restent." } },
      { t: { de: "Rückwärts planen", en: "Plan backwards", fr: "Planifier à rebours" }, d: { de: "Papiere dauern Monate. Wann brauchen Sie die Pflegekraft? Zählen Sie von dort zurück.", en: "Papers take months. When do you need her? Count back from that day.", fr: "Les papiers prennent des mois. Quand en avez-vous besoin ? Comptez à rebours." } },
      { t: { de: "Den 90-Tage-Plan nutzen", en: "Use the 90-day plan", fr: "Utiliser le plan de 90 jours" }, d: { de: "Jede Neue bekommt den Plan aus diesem PDF. Und eine Patin, 2 Stunden pro Woche.", en: "Every new nurse gets the plan in this PDF. And a mentor, 2 hours a week.", fr: "Chaque nouvelle reçoit le plan de ce PDF. Et une marraine, 2 heures par semaine." } },
      { t: { de: "Eine Zahl zählen", en: "Count one number", fr: "Compter un chiffre" }, d: { de: "Wie viele schaffen die Probezeit? Schreiben Sie es jeden Monat auf.", en: "How many pass probation? Write it down every month.", fr: "Combien réussissent la période d'essai ? Notez-le chaque mois." } },
    ],
  },
  3: {
    goal: { de: "Von Stufe 3 auf 4: Planen statt löschen.", en: "From level 3 to 4: plan, don't put out fires.", fr: "Du niveau 3 au 4 : planifier au lieu d'éteindre des feux." },
    steps: [
      { t: { de: "Fester Rhythmus", en: "A fixed rhythm", fr: "Un rythme fixe" }, d: { de: "Jedes Quartal eine neue Gruppe. Auch wenn gerade alles voll ist.", en: "A new group every quarter. Even when you are full.", fr: "Un nouveau groupe chaque trimestre. Même quand tout est plein." } },
      { t: { de: "Leihkräfte abbauen", en: "Cut agency staff", fr: "Réduire l'intérim" }, d: { de: "Für jede Neue, die bleibt: Leihstunden kündigen.", en: "For every new nurse who stays: cancel agency hours.", fr: "Pour chaque nouvelle qui reste : annulez des heures d'intérim." } },
      { t: { de: "Ehrlich beim Lohn", en: "Be honest about pay", fr: "Être honnête sur le salaire" }, d: { de: "Sagen Sie klar, was sie verdient. Und ab wann. Böse Überraschungen beim Lohn lassen Leute gehen.", en: "Say clearly what she earns, and from when. Bad pay surprises make people leave.", fr: "Dites clairement combien elle gagne, et à partir de quand. Les mauvaises surprises font partir." } },
      { t: { de: "Fragen, warum", en: "Ask why", fr: "Demander pourquoi" }, d: { de: "Wer geht, bekommt 15 Minuten. Fragen Sie: Warum? Schreiben Sie es auf.", en: "Everyone who leaves gets 15 minutes. Ask: why? Write it down.", fr: "Chaque départ a droit à 15 minutes. Demandez : pourquoi ? Notez-le." } },
    ],
  },
  4: {
    goal: { de: "Von Stufe 4 auf 5: Werden Sie ein Magnet.", en: "From level 4 to 5: become a magnet.", fr: "Du niveau 4 au 5 : devenez un aimant." },
    steps: [
      { t: { de: "Ihre Leute holen Leute", en: "Your people bring people", fr: "Vos équipes recrutent" }, d: { de: "Geben Sie eine Prämie für jede Freundin, die kommt und bleibt.", en: "Give a bonus for every friend who comes and stays.", fr: "Une prime pour chaque amie qui vient et reste." } },
      { t: { de: "Einen Weg zeigen", en: "Show a path", fr: "Montrer un chemin" }, d: { de: "Zeigen Sie im ersten Jahr: Wohin kann sie wachsen?", en: "Show in year one: where can she grow?", fr: "Montrez dès la première année : où peut-elle évoluer ?" } },
      { t: { de: "An die Familie denken", en: "Think of the family", fr: "Penser à la famille" }, d: { de: "Helfen Sie, die Familie herzuholen. Mit Familie bleibt man Jahre.", en: "Help bring the family over. With family here, people stay for years.", fr: "Aidez à faire venir la famille. Avec la famille ici, on reste des années." } },
      { t: { de: "Davon erzählen", en: "Tell the story", fr: "Le raconter" }, d: { de: "Zeigen Sie Ihr Team. Gute Geschichten holen gute Leute.", en: "Show your team. Good stories bring good people.", fr: "Montrez votre équipe. Les belles histoires attirent." } },
    ],
  },
  5: {
    goal: { de: "Auf Stufe 5 bleiben.", en: "Staying on level 5.", fr: "Rester au niveau 5." },
    steps: [
      { t: { de: "Rhythmus halten", en: "Keep the rhythm", fr: "Garder le rythme" }, d: { de: "Jedes Quartal eine Gruppe. Auch in guten Zeiten.", en: "One group every quarter. Also in good times.", fr: "Un groupe par trimestre. Même quand tout va bien." } },
      { t: { de: "Patinnen ausbilden", en: "Train mentors", fr: "Former des marraines" }, d: { de: "Ihre erfahrenen Leute helfen den Neuen.", en: "Your experienced people help the new ones.", fr: "Vos anciennes aident les nouvelles." } },
      { t: { de: "Drei Zahlen zählen", en: "Count three numbers", fr: "Compter trois chiffres" }, d: { de: "Leere Stellen, Kündigungen, Leihstunden. Jedes Quartal.", en: "Empty posts, resignations, agency hours. Every quarter.", fr: "Postes vides, départs, heures d'intérim. Chaque trimestre." } },
    ],
  },
};

export const BOTTLENECK: Record<RoadmapResult["bottleneck"], { t: L; d: L }> = {
  fill: { t: { de: "Ihr Engpass: leere Stellen", en: "Your bottleneck: empty posts", fr: "Votre blocage : les postes vides" }, d: { de: "Leere Stellen kosten Sie am meisten. Jeder Monat ohne Pflegekraft kostet Geld. Fangen Sie heute an. Der Weg dauert Monate.", en: "Empty posts cost you most. Every month without a nurse costs money. Start today. It takes months.", fr: "Les postes vides vous coûtent le plus. Chaque mois sans infirmière coûte. Commencez aujourd'hui. Le chemin prend des mois." } },
  keep: { t: { de: "Ihr Engpass: Leute gehen wieder", en: "Your bottleneck: people leave again", fr: "Votre blocage : elles repartent" }, d: { de: "Am meisten kostet: Pflegekräfte gehen wieder. Dann fängt alles von vorne an. Mehr einstellen hilft nicht. Ein besserer Start hilft.", en: "What costs most: nurses leave again. Then it all starts over. Hiring more won't fix it. A better start will.", fr: "Ce qui coûte le plus : les infirmières repartent. Tout recommence. Recruter plus n'aide pas. Un meilleur départ, oui." } },
  agency: { t: { de: "Ihr Engpass: zu viele Leihkräfte", en: "Your bottleneck: too much agency staff", fr: "Votre blocage : trop d'intérim" }, d: { de: "Leihkräfte fressen Ihr Geld. Sie helfen heute. Aber nie morgen. Jede eigene Pflegekraft, die bleibt, ersetzt etwa 160 Leihstunden im Monat.", en: "Agency staff eat your money. They help today. But never tomorrow. Every nurse of your own who stays replaces about 160 agency hours a month.", fr: "L'intérim mange votre argent. Il aide aujourd'hui. Jamais demain. Chaque infirmière à vous qui reste remplace environ 160 heures d'intérim par mois." } },
  process: { t: { de: "Ihr Engpass: Papiere", en: "Your bottleneck: paperwork", fr: "Votre blocage : les papiers" }, d: { de: "Bei Ihnen hängt es an Papieren und Ämtern. Das geht zu lösen: mit einem klaren Plan. Und mit jemandem, der sich jeden Tag darum kümmert.", en: "You are stuck on papers and offices. That can be fixed: with a clear plan. And someone who takes care of it every day.", fr: "Vous êtes bloqué par les papiers. C'est réglable : avec un plan clair. Et quelqu'un qui s'en occupe chaque jour." } },
  language: { t: { de: "Ihr Engpass: Deutsch", en: "Your bottleneck: German", fr: "Votre blocage : l'allemand" }, d: { de: "Bei Ihnen hakt es an der Sprache. Ein Zeugnis reicht nicht. Prüfen Sie das Deutsch vorher. Üben Sie im Dienst: Übergabe und Telefon.", en: "Language is the problem. A certificate is not enough. Check German first. Practise at work: handovers and phone calls.", fr: "C'est la langue qui bloque. Un certificat ne suffit pas. Vérifiez l'allemand avant. Entraînez-vous au travail : transmissions et téléphone." } },
};

export const PLAN_90: { when: L; items: L[] }[] = [
  { when: { de: "Bevor sie kommt", en: "Before she comes", fr: "Avant son arrivée" }, items: [
    { de: "Die Wohnung ist fertig.", en: "The flat is ready.", fr: "Le logement est prêt." },
    { de: "Die Patin sagt per Video Hallo.", en: "The mentor says hello by video.", fr: "La marraine dit bonjour en vidéo." },
    { de: "Der Dienstplan für 2 Wochen steht.", en: "The rota for 2 weeks is done.", fr: "Le planning de 2 semaines est prêt." },
  ] },
  { when: { de: "Tag 1", en: "Day 1", fr: "Jour 1" }, items: [
    { de: "Jemand holt sie ab.", en: "Someone picks her up.", fr: "Quelqu'un vient la chercher." },
    { de: "Rundgang, Spind, Kleidung.", en: "Tour, locker, uniform.", fr: "Visite, casier, tenue." },
    { de: "Mittagessen mit dem Team.", en: "Lunch with the team.", fr: "Déjeuner avec l'équipe." },
  ] },
  { when: { de: "Woche 1", en: "Week 1", fr: "Semaine 1" }, items: [
    { de: "Nur mitlaufen, mit der Patin.", en: "Only shadowing, with the mentor.", fr: "Seulement en binôme avec la marraine." },
    { de: "Bank, Amt, Krankenkasse.", en: "Bank, town hall, health insurance.", fr: "Banque, mairie, assurance maladie." },
    { de: "Jeden Tag 10 Minuten: Wie war es?", en: "10 minutes a day: how was it?", fr: "10 minutes par jour : comment ça va ?" },
  ] },
  { when: { de: "Monat 1", en: "Month 1", fr: "Mois 1" }, items: [
    { de: "Deutsch für die Arbeit üben.", en: "Practise German for work.", fr: "Pratiquer l'allemand du travail." },
    { de: "Erstes Gespräch, in Ruhe.", en: "First talk, without rush.", fr: "Premier entretien, au calme." },
  ] },
  { when: { de: "Monat 2", en: "Month 2", fr: "Mois 2" }, items: [
    { de: "Eigene Patienten, mit Hilfe.", en: "Her own patients, with help.", fr: "Ses propres patients, avec aide." },
    { de: "Nächste Papiere, mit Datum.", en: "Next papers, with dates.", fr: "Prochains papiers, avec dates." },
    { de: "Leben neben der Arbeit: Sport, Freunde.", en: "Life outside work: sport, friends.", fr: "Vie hors travail : sport, amis." },
  ] },
  { when: { de: "Monat 3", en: "Month 3", fr: "Mois 3" }, items: [
    { de: "Fragen: Wie geht es dir wirklich?", en: "Ask: how are you really?", fr: "Demander : comment vas-tu vraiment ?" },
    { de: "Plan für Familie und Zukunft.", en: "Plan for family and future.", fr: "Plan pour la famille et l'avenir." },
  ] },
];

export const REASONS: { why: L; fix: L }[] = [
  { why: { de: "Keine gute Wohnung", en: "No good flat", fr: "Pas de bon logement" }, fix: { de: "Wohnung vorher suchen.", en: "Find the flat before she comes.", fr: "Trouver le logement avant." } },
  { why: { de: "Allein, ohne Freunde", en: "Alone, no friends", fr: "Seule, sans amis" }, fix: { de: "Patin, Gruppe, Leute von zu Hause.", en: "Mentor, group, people from home.", fr: "Marraine, groupe, gens du pays." } },
  { why: { de: "Deutsch im Stress", en: "German under stress", fr: "L'allemand sous stress" }, fix: { de: "Im Dienst üben. Nicht nur im Kurs.", en: "Practise at work. Not only in class.", fr: "S'entraîner au travail. Pas qu'en cours." } },
  { why: { de: "Weniger Lohn als gedacht", en: "Less pay than she thought", fr: "Moins payée que prévu" }, fix: { de: "Lohn ehrlich und schriftlich.", en: "Pay, honest and in writing.", fr: "Salaire honnête, par écrit." } },
  { why: { de: "Die Familie fehlt", en: "She misses her family", fr: "La famille manque" }, fix: { de: "Familie früh mitplanen.", en: "Plan for the family early.", fr: "Prévoir tôt la famille." } },
  { why: { de: "Nur als Hilfe eingesetzt", en: "Used only as a helper", fr: "Utilisée comme aide" }, fix: { de: "Ihr Können nutzen.", en: "Use her skills.", fr: "Utiliser ses compétences." } },
  { why: { de: "Niemand hört zu", en: "Nobody listens", fr: "Personne n'écoute" }, fix: { de: "Eine feste Person. Feste Gespräche.", en: "One fixed person. Regular talks.", fr: "Une personne fixe. Des échanges réguliers." } },
];

/** Labels for the PDF and the result card. */
export const UI: Record<Lang, Record<string, string>> = {
  de: {
    title: "Ihr Pflege-Fahrplan", for: "Für", level: "Stufe", of5: "von 5",
    numbers: "Ihre Zahlen", openPosts: "Leere Stellen kosten Sie", leaving: "Leute, die gehen, kosten Sie",
    total: "Zusammen, jedes Jahr", perMonth: "im Monat", perYear: "im Jahr",
    perNurse: "Jede Pflegekraft, die bleibt, bringt Ihnen", howCounted: "So rechnen wir",
    openModel: "1 leere Stelle = 160 Leihstunden à 55 € + 3 leere Betten à 3.200 € = 18.400 € im Monat.",
    leaveModel: "1 Pflegekraft geht = 3 Monate Leihkräfte (26.400 €) + Einarbeitung weg (5.400 €) + neue Suche (8.000 €) = 39.800 €.",
    ownNumbers: "Ihre Zahlen sind anders? Wir rechnen sie mit Ihnen nach.",
    ladder: "Die 5 Stufen", youAreHere: "Sie sind hier", looks: "So sieht es aus", plan: "Ihr Plan",
    plan90: "Der 90-Tage-Plan", plan90sub: "Für jede neue Pflegekraft. Ausdrucken. Abhaken.",
    reasons: "7 Gründe, warum Pflegekräfte gehen", reasonsSub: "Und was hilft.", why: "Warum", fix: "Was hilft",
    next: "Ihr nächster Schritt", nextBody: "Sie schaffen das allein. Mit uns geht es schneller: Sie führen ein Gespräch. Wir machen den Rest. Bis die Probezeit geschafft ist.",
    book: "Prüfen, ob meine Einrichtung passt", contact: "Oder schreiben Sie uns", page: "Seite",
    disclaimer: "Alle Zahlen sind Schätzungen. Sie kommen aus Ihren Antworten.",
    lossYear: "Leere Stellen und Kündigungen kosten Sie etwa",
    e90: "Zum Abhaken", eReasons: "Warum Leute gehen", eNext: "Kostenlos",
    callGet: "Im Gespräch bekommen Sie", callPts: "Ihre echten Zahlen|Passende Pflegekräfte (ohne Namen)|Ihren Zeitplan bis Tag 1",
  },
  en: {
    title: "Your nurse staffing roadmap", for: "For", level: "Level", of5: "of 5",
    numbers: "Your numbers", openPosts: "Empty posts cost you", leaving: "People who leave cost you",
    total: "Together, every year", perMonth: "a month", perYear: "a year",
    perNurse: "Every nurse who stays brings you", howCounted: "How we count",
    openModel: "1 empty post = 160 agency hours at €55 + 3 empty beds at €3,200 = €18,400 a month.",
    leaveModel: "1 nurse leaves = 3 months of agency staff (€26,400) + lost onboarding (€5,400) + a new search (€8,000) = €39,800.",
    ownNumbers: "Your numbers are different? We work them out with you.",
    ladder: "The 5 levels", youAreHere: "You are here", looks: "What it looks like", plan: "Your plan",
    plan90: "The 90-day plan", plan90sub: "For every new nurse. Print it. Tick it off.",
    reasons: "7 reasons nurses leave", reasonsSub: "And what helps.", why: "Why", fix: "What helps",
    next: "Your next step", nextBody: "You can do this on your own. With us it is faster: you have one talk. We do the rest. Until probation is passed.",
    book: "Check if we are a fit", contact: "Or write to us", page: "Page",
    disclaimer: "All numbers are estimates. They come from your answers.",
    lossYear: "Empty posts and resignations cost you about",
    e90: "To tick off", eReasons: "Why people leave", eNext: "Free",
    callGet: "On the call you get", callPts: "Your real numbers|Matching nurses (no names)|Your timeline to day 1",
  },
  fr: {
    title: "Votre plan infirmier", for: "Pour", level: "Niveau", of5: "sur 5",
    numbers: "Vos chiffres", openPosts: "Les postes vides vous coûtent", leaving: "Les départs vous coûtent",
    total: "Au total, chaque année", perMonth: "par mois", perYear: "par an",
    perNurse: "Chaque infirmière qui reste vous rapporte", howCounted: "Notre calcul",
    openModel: "1 poste vide = 160 heures d'intérim à 55 € + 3 lits vides à 3 200 € = 18 400 € par mois.",
    leaveModel: "1 départ = 3 mois d'intérim (26 400 €) + intégration perdue (5 400 €) + nouvelle recherche (8 000 €) = 39 800 €.",
    ownNumbers: "Vos chiffres sont différents ? Nous les calculons avec vous.",
    ladder: "Les 5 niveaux", youAreHere: "Vous êtes ici", looks: "À quoi ça ressemble", plan: "Votre plan",
    plan90: "Le plan de 90 jours", plan90sub: "Pour chaque nouvelle infirmière. À imprimer. À cocher.",
    reasons: "7 raisons pour lesquelles elles partent", reasonsSub: "Et ce qui aide.", why: "Pourquoi", fix: "Ce qui aide",
    next: "Votre prochaine étape", nextBody: "Vous pouvez le faire seul. Avec nous, c'est plus rapide : vous faites un entretien. Nous faisons le reste. Jusqu'à la fin de la période d'essai.",
    book: "Vérifier si nous correspondons", contact: "Ou écrivez-nous", page: "Page",
    disclaimer: "Tous les chiffres sont des estimations. Ils viennent de vos réponses.",
    lossYear: "Les postes vides et les départs vous coûtent environ",
    e90: "À cocher", eReasons: "Pourquoi on part", eNext: "Gratuit",
    callGet: "Pendant l'appel, vous recevez", callPts: "Vos vrais chiffres|Des infirmières adaptées (sans nom)|Votre calendrier jusqu'au jour 1",
  },
};
