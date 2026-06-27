/**
 * Trilingual copy for the /v2 marketing site (FR · EN · DE).
 *
 * POSITIONING: ENTERPRISE ONLY. Borivon teaches PROFESSIONAL GERMAN to companies
 * whose teams work with German-speaking clients, partners, head offices and
 * markets (Germany, Austria, Switzerland). No B2C / individuals, no recruitment,
 * no migration-to-Germany. Structure mirrors proven enterprise language-training
 * sites (gofluent etc.): positioning -> proof -> method -> outcomes -> one
 * repeated "book a needs audit" CTA.
 *
 * Voice: premium but PLAIN (5th-grade reading level), confident, human. Short
 * sentences, common words, no jargon, NO em-dashes. NEVER write "DACH" (say
 * "German-speaking" or name the three countries). No fabricated stats/logos.
 *
 * Usage:
 *   const { lang } = useLang();
 *   const T = (t: Tri) => t[lang];
 *   <h1>{T(C.home.heroTitle)}</h1>
 */
import type { Lang } from "@/lib/translations";

export type Tri = { fr: string; en: string; de: string };
export const pick = (t: Tri, lang: Lang) => t[lang];

const tri = (fr: string, en: string, de: string): Tri => ({ fr, en, de });

/** Brand motto, constant, shown across the site, never translated. */
export const MOTTO = "Ambitions without Borders";

export const COPY = {
  // ── Chrome ──────────────────────────────────────────────────────────────
  nav: {
    business:    tri("Solutions", "Solutions", "Lösungen"),
    model:       tri("Méthode", "Method", "Methode"),
    about:       tri("À propos", "About", "Über uns"),
    contact:     tri("Réserver un audit", "Book an audit", "Audit buchen"),
    menu:        tri("Menu", "Menu", "Menü"),
  },
  footer: {
    tagline: tri(
      "L'allemand professionnel qui fait gagner vos équipes.",
      "Professional German that helps your teams win.",
      "Professionelles Deutsch, mit dem Ihre Teams gewinnen.",
    ),
    colSite:    tri("Site", "Site", "Seite"),
    colCompany: tri("Entreprise", "Company", "Firma"),
    login:      tri("Espace client", "Client portal", "Kundenbereich"),
    rights:     tri("Tous droits réservés.", "All rights reserved.", "Alle Rechte vorbehalten."),
    company:    tri("Borivon LLC", "Borivon LLC", "Borivon LLC"),
    country:    tri("États-Unis", "United States", "Vereinigte Staaten"),
    email:      tri("contact@borivon.com", "contact@borivon.com", "contact@borivon.com"),
    institut:   tri("Allemand professionnel pour les équipes", "Professional German for teams", "Berufsdeutsch für Teams"),
  },

  // ── Home (enterprise) ──────────────────────────────────────────────────────
  home: {
    heroEyebrow: tri("Allemand professionnel pour les équipes", "Professional German for teams", "Berufsdeutsch für Teams"),
    // heroTitle is split word-by-word for the reveal; heroAccent rises last, in gold.
    heroTitle:   tri("Vos équipes travaillent avec des marchés germanophones.", "Your teams work with German-speaking markets.", "Ihre Teams arbeiten mit deutschsprachigen Märkten."),
    heroAccent:  tri("Faites-les enfin parler allemand.", "Now make them speak German.", "Jetzt lassen Sie sie Deutsch sprechen."),
    heroSub:     tri(
      "Nous apprenons à vos collaborateurs à parler allemand au travail, dès la première leçon : en réunion, au téléphone et avec vos clients en Allemagne, en Autriche et en Suisse.",
      "We teach your people to speak German at work, from the first lesson: in meetings, on calls, and with your clients in Germany, Austria and Switzerland.",
      "Wir bringen Ihren Mitarbeitenden bei, ab der ersten Stunde Deutsch im Beruf zu sprechen: in Meetings, am Telefon und mit Ihren Kunden in Deutschland, Österreich und der Schweiz.",
    ),
    heroCta1:    tri("Réserver un audit des besoins", "Book a needs audit", "Bedarfsanalyse buchen"),
    heroCta2:    tri("Voir la méthode", "See the method", "Methode ansehen"),
    chip1:       tri("Propulsé par l'IA", "Powered by AI", "Mit KI"),
    chip2:       tri("Parler dès la 1re leçon", "Speak from lesson one", "Sprechen ab der ersten Stunde"),
    chip3:       tri("100% en ligne", "100% online", "100% online"),

    // Trust strip (one credibility line under the hero)
    trustStrip:  tri(
      "Plus de 8 ans d'expérience. Plus de 20 entreprises formées. Une méthode où l'on parle dès la première leçon.",
      "8+ years of experience. 20+ companies trained. A method where you speak from the first lesson.",
      "Über 8 Jahre Erfahrung. Über 20 Unternehmen geschult. Eine Methode, bei der Sie ab der ersten Stunde sprechen.",
    ),

    problemEyebrow: tri("Le problème", "The problem", "Das Problem"),
    problemTitle:   tri("Quand une équipe ne parle pas allemand,", "When a team cannot speak German,", "Wenn ein Team kein Deutsch spricht,"),
    problemAccent:  tri("le business en paie le prix.", "the business pays for it.", "zahlt das Geschäft den Preis."),
    problemSub:     tri(
      "Concrètement, voici ce que ça vous coûte.",
      "Here is what that costs you, concretely.",
      "Konkret kostet Sie das Folgendes.",
    ),
    problem1Title: tri("Les réunions ralentissent", "Meetings slow down", "Meetings stocken"),
    problem1Body:  tri("Vos collaborateurs comprennent mais n'osent pas parler. Les échanges passent en anglais ou s'enlisent, et vos partenaires allemands le ressentent.", "Your people understand but freeze when it is time to speak. Talks switch to English or stall, and your German partners feel it.", "Ihre Mitarbeitenden verstehen, trauen sich aber nicht zu sprechen. Gespräche wechseln ins Englische oder geraten ins Stocken, und Ihre deutschen Partner merken es."),
    problem2Title: tri("Les relations restent fragiles", "Relationships stay fragile", "Beziehungen bleiben fragil"),
    problem2Body:  tri("La confiance se construit dans la langue du client. Sans allemand parlé, vos équipes restent à distance de vos clients et de votre maison mère.", "Trust is built in the client's language. Without spoken German, your teams stay at arm's length from your clients and your head office.", "Vertrauen entsteht in der Sprache des Kunden. Ohne gesprochenes Deutsch bleiben Ihre Teams auf Distanz zu Kunden und zur Zentrale."),
    problem3Title: tri("Les contrats vous échappent", "Deals slip away", "Aufträge gehen verloren"),
    problem3Body:  tri("Une négociation se gagne ou se perd sur quelques phrases. Quand vos équipes ne peuvent pas les dire en allemand, un concurrent local prend la place.", "A negotiation is won or lost on a few sentences. When your teams cannot say them in German, a local competitor steps in.", "Eine Verhandlung entscheidet sich an wenigen Sätzen. Wenn Ihre Teams sie nicht auf Deutsch sagen können, übernimmt ein lokaler Wettbewerber."),

    // Delivery modes (used by the /methode page)
    modelEyebrow: tri("Pourquoi ça marche", "Why it works", "Warum es funktioniert"),
    modelTitle:   tri("Fait pour parler,", "Built to speak,", "Zum Sprechen gemacht,"),
    modelAccent:  tri("pas pour réviser.", "not to study.", "nicht zum Pauken."),
    modelSub:     tri(
      "Pas de grammaire sans fin. On part de vos vraies situations et on fait parler vos équipes dès le premier cours.",
      "No endless grammar. We start with your real situations and get your teams speaking from the first class.",
      "Keine endlose Grammatik. Wir starten mit Ihren echten Situationen und bringen Ihre Teams ab dem ersten Kurs zum Sprechen.",
    ),
    modeOnlineTag:  tri("On parle d'abord", "Speaking first", "Sprechen zuerst"),
    modeOnlineH:    tri("Parler, dès le 1er cours.", "Speak from day one.", "Sprechen ab Tag eins."),
    modeOnlineB:    tri("Pas de théorie. Vos équipes parlent tout de suite, parce que c'est ce que le travail demande.", "No theory. Your teams speak right away, because that is what the work needs.", "Keine Theorie. Ihre Teams sprechen sofort, weil die Arbeit genau das braucht."),
    modeHybridTag:  tri("Vos situations", "Your situations", "Ihre Situationen"),
    modeHybridH:    tri("Votre allemand, pas un manuel.", "Your German, not a textbook.", "Ihr Deutsch, kein Lehrbuch."),
    modeHybridB:    tri("On travaille vos vraies situations : vos réunions, vos appels, vos clients. Un problème clair, une solution claire.", "We work on your real situations: your meetings, calls and clients. A clear problem, a clear answer.", "Wir arbeiten an Ihren echten Situationen: Meetings, Anrufe, Kunden. Klares Problem, klare Lösung."),
    modeVorOrtTag:  tri("Sans perdre de temps", "No time lost", "Keine Zeit verlieren"),
    modeVorOrtH:    tri("Autour du travail.", "Around the workday.", "Rund um die Arbeit."),
    modeVorOrtB:    tri("En ligne, en direct, à l'heure qui vous arrange. Aucune heure de travail perdue.", "Online, live, at a time that works for you. No work hours lost.", "Online, live, zur passenden Zeit. Keine verlorene Arbeitszeit."),
    modelGloss:     tri(
      "En direct avec un vrai professeur qui fait parler vos équipes et les corrige. Jamais juste une vidéo.",
      "Live with a real teacher who gets your teams speaking and corrects them. Never just a video.",
      "Live mit einer echten Lehrkraft, die Ihre Teams zum Sprechen bringt und korrigiert. Nie nur ein Video.",
    ),

    // How it works (4 program steps, shown on the home)
    journeyEyebrow: tri("Comment ça marche", "How it works", "So geht's"),
    journeyTitle:   tri("Une méthode bâtie pour", "A method built for", "Eine Methode, gebaut für"),
    journeyAccent:  tri("parler, pas réciter.", "speaking, not reciting.", "das Sprechen, nicht das Auswendiglernen."),
    journeySub:     tri("Un vrai professeur à chaque séance, l'IA pour aller plus vite, un seul partenaire du premier audit au suivi.", "A real teacher in every session, AI to move faster, one partner from the first audit to follow-up.", "Eine echte Lehrkraft in jeder Sitzung, KI für mehr Tempo, ein Partner von der ersten Analyse bis zur Nachbetreuung."),
    step1: tri("Audit des besoins", "Needs audit", "Bedarfsanalyse"),
    step1B: tri("Nous écoutons votre réalité : qui parle à qui, dans quelles situations, et ce qui doit changer pour votre business.", "We listen to your reality: who speaks to whom, in which situations, and what must change for your business.", "Wir hören uns Ihre Realität an: wer spricht mit wem, in welchen Situationen, und was sich fürs Geschäft ändern muss."),
    step2: tri("Programme sur mesure", "Tailored program", "Maßgeschneidertes Programm"),
    step2B: tri("Nous construisons un parcours autour de vos vrais cas : vos réunions, vos appels, vos clients, votre secteur.", "We build a path around your real cases: your meetings, your calls, your clients, your industry.", "Wir bauen einen Kurs um Ihre echten Fälle: Ihre Meetings, Anrufe, Kunden, Ihre Branche."),
    step3: tri("On parle, chaque leçon", "Speaking, every lesson", "Sprechen in jeder Stunde"),
    step3B: tri("Un vrai professeur guide chaque séance et l'IA décuple l'entraînement entre les cours. Vos équipes parlent, encore et encore.", "A real teacher leads every session and AI multiplies practice between classes. Your teams speak, again and again.", "Eine echte Lehrkraft leitet jede Sitzung, und KI vervielfacht das Üben zwischen den Stunden. Ihre Teams sprechen, immer wieder."),
    step4: tri("Suivi et résultats", "Follow-up and results", "Nachbetreuung und Ergebnisse"),
    step4B: tri("Nous mesurons les progrès et restons à vos côtés. Le même partenaire, du début à la fin.", "We measure progress and stay by your side. The same partner, start to finish.", "Wir messen die Fortschritte und bleiben an Ihrer Seite. Derselbe Partner, von Anfang bis Ende."),

    trustA_h: tri("Spécialistes de l'allemand pro", "Business-German experts", "Profis für Business-Deutsch"),
    trustA_b: tri("Une école 100% dédiée à l'allemand professionnel.", "A school fully focused on professional German.", "Eine Schule, ganz auf professionelles Deutsch fokussiert."),
    trustB_h: tri("Tournés vers les résultats", "Results first", "Ergebnisse zuerst"),
    trustB_b: tri("On vise l'allemand qui marche en réunion, pas les diplômes pour la vitrine.", "We aim for German that works in meetings, not diplomas for show.", "Wir wollen Deutsch, das im Meeting funktioniert, keine Diplome fürs Schaufenster."),
    trustC_h: tri("Un partenaire, pas un fournisseur", "A partner, not a vendor", "Ein Partner, kein Lieferant"),
    trustC_b: tri("Du premier audit au suivi, une seule équipe avec vous.", "From the first audit to follow-up, one team at your side.", "Von der ersten Analyse bis zur Nachbetreuung, ein Team an Ihrer Seite."),

    finalTitle:  tri("Donnez à vos équipes la langue", "Give your teams the language", "Geben Sie Ihren Teams die Sprache"),
    finalAccent: tri("qui gagne vos marchés.", "that wins your markets.", "die Ihre Märkte gewinnt."),
    finalCta:    tri("Réserver un audit des besoins", "Book a needs audit", "Bedarfsanalyse buchen"),
    finalSub:    tri("Commençons par un audit des besoins. Nous écoutons, puis nous vous montrons exactement comment faire parler vos équipes.", "Let's start with a needs audit. We listen, then we show you exactly how to get your teams speaking.", "Beginnen wir mit einer Bedarfsanalyse. Wir hören zu und zeigen Ihnen genau, wie Ihre Teams sprechen lernen."),

    // Scrollytelling manifesto (word-by-word gold sweep on scroll).
    manifesto: tri(
      "L'allemand n'est pas une matière scolaire. C'est la langue dans laquelle vos équipes gagnent, ou perdent, le marché.",
      "German is not a school subject. It is the language your teams win, or lose, the market in.",
      "Deutsch ist kein Schulfach. Es ist die Sprache, in der Ihre Teams den Markt gewinnen, oder verlieren.",
    ),
  },

  // ── Home: horizontal pinned showcase (where teams will speak German) ───────
  showcase: {
    eyebrow: tri("En situation", "In the room", "In der Praxis"),
    title:   tri("Là où vos équipes", "Where your teams", "Wo Ihre Teams"),
    accent:  tri("parleront allemand.", "will speak German.", "Deutsch sprechen."),
    // Tags are German situation words — same in every language.
    p1Tag: "Meetings",          p1H: tri("Mener la réunion", "Lead the meeting", "Das Meeting führen"),
    p2Tag: "Kundengespräch",    p2H: tri("Gérer vos clients", "Handle your clients", "Kunden betreuen"),
    p3Tag: "Verhandlung",       p3H: tri("Gagner la négociation", "Win the negotiation", "Die Verhandlung gewinnen"),
    p4Tag: "Präsentation",      p4H: tri("Présenter avec assurance", "Present with confidence", "Sicher präsentieren"),
    p5Tag: "Vorstellungsgespräch", p5H: tri("Réussir l'entretien", "Nail the interview", "Das Gespräch bestehen"),
  },

  // ── AI — we teach WITH AI + teach teams to USE AI to learn faster ─────────
  ai: {
    eyebrow: tri("Propulsé par l'IA", "Powered by AI", "Mit KI"),
    title:   tri("L'IA fait apprendre l'allemand", "AI makes learning German", "KI macht Deutschlernen"),
    accent:  tri("bien plus vite.", "far faster.", "viel schneller."),
    sub:     tri(
      "Nous enseignons avec l'IA et nous apprenons à vos équipes à s'en servir pour progresser chaque jour, pas seulement en cours.",
      "We teach with AI and we teach your teams to use it to improve every day, not only in class.",
      "Wir unterrichten mit KI und bringen Ihren Teams bei, sie zu nutzen, um jeden Tag besser zu werden, nicht nur im Unterricht.",
    ),
    c1H: tri("Entraînement sans limite", "Practice without limits", "Üben ohne Grenzen"),
    c1B: tri("Vos équipes s'exercent à parler quand elles veulent, autant qu'elles veulent, entre deux cours.", "Your teams practice speaking whenever they want, as much as they want, between lessons.", "Ihre Teams üben das Sprechen, wann und so viel sie wollen, zwischen den Stunden."),
    c2H: tri("Adapté à chacun", "Tailored to each person", "Auf jede Person zugeschnitten"),
    c2B: tri("L'IA suit le niveau de chaque collaborateur et propose le bon exercice au bon moment.", "AI follows each person's level and serves the right exercise at the right time.", "Die KI verfolgt das Niveau jeder Person und liefert die richtige Übung zur richtigen Zeit."),
    c3H: tri("Une compétence qui reste", "A skill that stays", "Eine Fähigkeit, die bleibt"),
    c3B: tri("Vos équipes repartent en sachant utiliser l'IA pour continuer à apprendre, longtemps après la formation.", "Your teams leave knowing how to use AI to keep learning, long after the program ends.", "Ihre Teams gehen mit dem Wissen, KI zum Weiterlernen zu nutzen, lange nach dem Programm."),
  },

  // ── Home outcomes (what changes for the business) ─────────────────────────
  ent: {
    eyebrow: tri("Résultats", "Outcomes", "Ergebnisse"),
    title:   tri("Ce qui change quand vos équipes", "What changes when your teams", "Was sich ändert, wenn Ihre Teams"),
    accent:  tri("parlent enfin allemand.", "finally speak German.", "endlich Deutsch sprechen."),
    body:    tri(
      "Pas des notes. Des résultats que votre business ressent, dès les premières semaines.",
      "Not grades. Results your business feels, within the first weeks.",
      "Keine Noten. Ergebnisse, die Ihr Geschäft spürt, schon in den ersten Wochen.",
    ),
    cta:  tri("Réserver un audit des besoins", "Book a needs audit", "Bedarfsanalyse buchen"),
    p1:   tri("Vos collaborateurs mènent réunions et appels en allemand, sans bloquer.", "Your people run meetings and calls in German, without freezing.", "Ihre Mitarbeitenden führen Meetings und Anrufe auf Deutsch, ohne zu blockieren."),
    p2:   tri("Vos clients et partenaires germanophones se sentent compris et respectés.", "Your German-speaking clients and partners feel understood and respected.", "Ihre deutschsprachigen Kunden und Partner fühlen sich verstanden und respektiert."),
    p3:   tri("Les négociations avancent plus vite, dans la langue qui compte.", "Negotiations move faster, in the language that matters.", "Verhandlungen kommen schneller voran, in der Sprache, die zählt."),
    p4:   tri("Aucune heure de travail perdue : la formation est 100% en ligne.", "No work hours lost: training is 100% online.", "Keine Arbeitszeit verloren: Die Schulung ist 100% online."),
  },

  // ── Home: full-bleed photo statement (text overlaid on the image) ─────────
  statement: {
    eyebrow: tri("En réunion", "In the meeting", "Im Meeting"),
    line1:   tri("Vos équipes prennent la parole", "Your teams speak up", "Ihre Teams reden mit"),
    line2:   tri("et gagnent le marché.", "and win the market.", "und gewinnen den Markt."),
    sub:     tri("Le moment qui compte, vos équipes sont prêtes.", "The moment that matters, your teams are ready.", "Im wichtigen Moment sind Ihre Teams bereit."),
  },

  // ── Home: on-site / Vor Ort (online by default, on-site on request) ───────
  vorort: {
    eyebrow: tri("Sur site", "On-site", "Vor Ort"),
    title:   tri("En ligne par défaut, sur site quand vous voulez", "Online by default, on-site when you want it", "Standardmäßig online, vor Ort wenn Sie möchten"),
    body:    tri(
      "Nos formations sont 100% en ligne pour ne perdre aucune heure de travail. Si vous préférez la présence, nous venons chez vous, sur demande.",
      "Our training is 100% online so no work hours are lost. If you prefer presence, we come to you, on request.",
      "Unsere Schulungen sind zu 100% online, damit keine Arbeitszeit verloren geht. Wenn Sie Präsenz bevorzugen, kommen wir auf Wunsch zu Ihnen, vor Ort.",
    ),
    cta:     tri("Demander une formation sur site", "Request on-site training", "Vor-Ort-Schulung anfragen"),
  },

  // ── /solutions (enterprise deep-dive) ─────────────────────────────────────
  solutions: {
    eyebrow:  tri("Solutions entreprise", "Business solutions", "Lösungen für Firmen"),
    title:    tri("Une seule chose sépare vos équipes du marché allemand :", "One thing stands between your teams and the German market:", "Nur eine Sache steht zwischen Ihren Teams und dem deutschen Markt:"),
    accent:   tri("la langue.", "language.", "die Sprache."),
    sub:      tri("On l'enlève. 100% en ligne, fait pour l'allemand professionnel.", "We remove it. 100% online, built for professional German.", "Wir nehmen sie weg. 100% online, für professionelles Deutsch gebaut."),
    cta:      tri("Réserver un audit", "Book an audit", "Audit buchen"),

    forEyebrow: tri("Pour qui", "Who it's for", "Für wen"),
    forTitle:   tri("Fait pour les entreprises qui visent les clients allemands.", "Built for companies aiming at German clients.", "Für Firmen, die deutsche Kunden im Blick haben."),
    seg1H: tri("Équipes commerciales et clients", "Sales and client teams", "Vertrieb und Kundenteams"),
    seg1B: tri("Vos commerciaux parlent avec des clients allemands et veulent gagner, pas traduire.", "Your salespeople talk to German clients and want to win, not translate.", "Ihr Vertrieb spricht mit deutschen Kunden und will gewinnen, nicht übersetzen."),
    seg2H: tri("Partenaires et maison mère", "Partners and HQ", "Partner und Zentrale"),
    seg2B: tri("Vos équipes travaillent chaque jour avec des partenaires, fournisseurs ou une maison mère allemande.", "Your teams work every day with German partners, suppliers or a head office.", "Ihre Teams arbeiten täglich mit deutschen Partnern, Lieferanten oder einer Zentrale."),
    seg3H: tri("Allemagne, Autriche, Suisse", "Germany, Austria, Switzerland", "Deutschland, Österreich, Schweiz"),
    seg3B: tri("Vous visez ces marchés. Là-bas, on gagne en allemand, pas en anglais.", "You're aiming for these markets. There, you win in German, not in English.", "Diese Märkte sind Ihr Ziel. Dort gewinnt man auf Deutsch, nicht auf Englisch."),

    outEyebrow: tri("Ce que vous y gagnez", "What you gain", "Ihr Gewinn"),
    outTitle:   tri("Des résultats que vous pouvez mesurer.", "Results you can measure.", "Ergebnisse, die Sie messen können."),
    out1H: tri("Plus d'affaires gagnées", "More deals won", "Mehr gewonnene Aufträge"),
    out1B: tri("Vos équipes gagnent en allemand, au lieu de perdre face à un concurrent qui le parle.", "Your teams win in German, instead of losing to a rival who speaks it.", "Ihre Teams gewinnen auf Deutsch, statt an einen Wettbewerber zu verlieren, der es spricht."),
    out2H: tri("Des relations plus fortes", "Stronger relationships", "Stärkere Beziehungen"),
    out2B: tri("La confiance naît dans la langue du partenaire. La vôtre monte d'un cran.", "Trust grows in the partner's language. Yours moves up a level.", "Vertrauen wächst in der Sprache des Partners. Ihres steigt eine Stufe."),
    out3H: tri("Des équipes confiantes", "Confident teams", "Sichere Teams"),
    out3B: tri("Fini le blocage au téléphone ou en réunion. Vos gens prennent la parole.", "No more freezing on calls or in meetings. Your people speak up.", "Kein Blockieren mehr am Telefon oder im Meeting. Ihre Leute reden mit."),
    out4H: tri("Un seul contact", "One contact", "Ein Ansprechpartner"),
    out4B: tri("Du premier audit au suivi : un parcours, un partenaire.", "From the first audit to follow-up: one path, one partner.", "Von der ersten Analyse bis zur Nachbetreuung: ein Weg, ein Partner."),

    needsEyebrow: tri("Vos besoins en détail", "Your needs in detail", "Ihre Bedürfnisse im Detail"),
    needsTitle:   tri("Fait pour le travail, pas pour la salle de classe.", "Built for work, not the classroom.", "Für die Arbeit gemacht, nicht fürs Klassenzimmer."),
    need1H: tri("Centré sur la parole", "Speaking-centred", "Auf Sprechen ausgerichtet"),
    need1B: tri("On fait parler vos équipes dès le premier cours. Pas de grammaire sans fin, juste l'allemand qu'elles utilisent vraiment.", "We get your teams speaking from the first class. No endless grammar, just the German they really use.", "Wir bringen Ihre Teams ab dem ersten Kurs zum Sprechen. Keine endlose Grammatik, nur das Deutsch, das sie wirklich nutzen."),
    need2H: tri("Sans les couper du travail", "Without taking them off work", "Ohne sie von der Arbeit abzuziehen"),
    need2B: tri("100% en ligne. Vos équipes apprennent autour du travail, sans déplacement ni arrêt.", "100% online. Your teams learn around work, no travel and no downtime.", "100% online. Ihre Teams lernen rund um die Arbeit, ohne Anreise und ohne Ausfall."),
    need3H: tri("L'allemand de votre secteur", "The German of your industry", "Das Deutsch Ihrer Branche"),
    need3B: tri("Pas l'allemand scolaire : les mots de vos clients, de vos réunions, de vos contrats.", "Not school German: the words of your clients, your meetings, your contracts.", "Kein Schuldeutsch: die Wörter Ihrer Kunden, Meetings und Verträge."),
    need4H: tri("Une vraie visibilité", "Real visibility", "Echte Übersicht"),
    need4B: tri("Vous voyez où en est chaque personne : progrès, présence, prêt à l'emploi.", "You see where each person stands: progress, attendance, ready to use it.", "Sie sehen, wo jede Person steht: Fortschritt, Anwesenheit, einsatzbereit."),
    need5H: tri("Un partenaire, pas un fournisseur", "A partner, not a vendor", "Ein Partner, kein Lieferant"),
    need5B: tri("Un seul contact qui comprend vos enjeux, du premier audit au suivi.", "One contact who gets your business, from the first audit to follow-up.", "Ein Ansprechpartner, der Ihr Geschäft versteht, von der ersten Analyse bis zur Nachbetreuung."),
  },

  // ── /methode (the model) ──────────────────────────────────────────────────
  methode: {
    eyebrow: tri("Méthode", "Method", "Methode"),
    title:   tri("L'allemand, en ligne.", "German, online.", "Deutsch, online."),
    accent:  tri("Et ça marche mieux.", "And it works better.", "Und es klappt sogar besser."),
    sub:     tri("On parle d'abord, autour du travail. L'allemand que vos équipes utilisent vraiment, sans grammaire ennuyeuse.", "We speak first, around the workday. The German your teams really use, without boring grammar.", "Wir sprechen zuerst, rund um die Arbeit. Das Deutsch, das Ihre Teams wirklich nutzen, ohne langweilige Grammatik."),
    cta:     tri("Réserver un audit", "Book an audit", "Audit buchen"),

    pEyebrow: tri("Les principes", "The principles", "Die Prinzipien"),
    pTitle:   tri("Ce qui rend l'allemand utile.", "What makes German useful.", "Was Deutsch nützlich macht."),
    pr1H: tri("Le but, pas le niveau", "The goal, not the level", "Das Ziel, nicht die Stufe"),
    pr1B: tri("On part de votre vrai but business, pas d'une échelle de niveaux abstraite.", "We start from your real business goal, not an abstract scale of levels.", "Wir starten von Ihrem echten Geschäftsziel, nicht von einer abstrakten Niveauskala."),
    pr2H: tri("La pratique d'abord", "Practice first", "Praxis zuerst"),
    pr2B: tri("L'allemand des clients, des réunions, des contrats. Pas la grammaire pour la grammaire.", "The German of clients, meetings and contracts. Not grammar for grammar's sake.", "Das Deutsch von Kunden, Meetings und Verträgen. Nicht Grammatik um der Grammatik willen."),
    pr3H: tri("Un humain à chaque étape", "A human at every step", "Ein Mensch bei jedem Schritt"),
    pr3B: tri("Des professeurs qui suivent, corrigent et encouragent. Jamais une appli toute seule.", "Teachers who follow, correct and encourage. Never an app alone.", "Lehrkräfte, die begleiten, korrigieren und motivieren. Nie nur eine App."),
    pr4H: tri("De la langue au résultat", "From language to results", "Von der Sprache zum Ergebnis"),
    pr4B: tri("On ne s'arrête pas au cours. On vous suit jusqu'au résultat sur le terrain.", "We don't stop at the course. We follow you to results on the ground.", "Wir hören nicht beim Kurs auf. Wir begleiten Sie bis zum Ergebnis im Alltag."),
  },

  // ── /a-propos (about) ─────────────────────────────────────────────────────
  about: {
    eyebrow: tri("À propos de Borivon", "About Borivon", "Über Borivon"),
    title:   tri("Une seule mission :", "One mission:", "Eine Mission:"),
    accent:  tri("faire parler allemand vos équipes.", "get your teams speaking German.", "Ihre Teams Deutsch sprechen zu lassen."),
    sub:     tri(
      "Depuis plus de 8 ans, nous aidons les entreprises à parler allemand avec leurs clients, partenaires et marchés germanophones.",
      "For 8+ years, we have helped companies speak German with their German-speaking clients, partners and markets.",
      "Seit über 8 Jahren helfen wir Unternehmen, mit ihren deutschsprachigen Kunden, Partnern und Märkten Deutsch zu sprechen.",
    ),

    // Social proof, founder-supplied, honest numbers (not fake-perfect).
    stat1N: tri("8+", "8+", "8+"),
    stat1L: tri("Années d'expérience", "Years of experience", "Jahre Erfahrung"),
    stat2N: tri("20+", "20+", "20+"),
    stat2L: tri("Entreprises formées", "Companies trained", "Geschulte Unternehmen"),
    stat3N: tri("100%", "100%", "100%"),
    stat3L: tri("En ligne, sans temps perdu", "Online, no time lost", "Online, ohne Zeitverlust"),

    storyEyebrow: tri("Pourquoi Borivon", "Why Borivon", "Warum Borivon"),
    storyTitle:   tri("Plus de 8 ans à faire parler les équipes.", "8+ years getting teams speaking.", "Über 8 Jahre, in denen wir Teams zum Sprechen bringen."),
    storyP1: tri(
      "Borivon est né d'un constat simple : trop d'équipes apprennent la grammaire allemande pendant des mois sans jamais oser parler. Nous avons inversé l'ordre. Chez nous, on parle dès la première leçon, avec un vrai professeur et l'aide de l'IA.",
      "Borivon began from a simple observation: too many teams study German grammar for months and never dare to speak. We flipped the order. With us, you speak from the first lesson, with a real teacher and the help of AI.",
      "Borivon entstand aus einer einfachen Beobachtung: Zu viele Teams lernen monatelang Grammatik und trauen sich nie zu sprechen. Wir haben die Reihenfolge umgedreht. Bei uns spricht man ab der ersten Stunde, mit einer echten Lehrkraft und der Hilfe von KI.",
    ),
    storyP2: tri(
      "Aujourd'hui, plus de 20 entreprises nous font confiance pour former leurs équipes. Nous restons un seul partenaire, du premier audit au suivi, et nous mesurons une seule chose : vos collaborateurs parlent-ils vraiment allemand au travail.",
      "Today, 20+ companies trust us to train their teams. We stay one partner, from the first audit through to follow-up, and we measure one thing: can your people truly speak German at work.",
      "Heute vertrauen uns über 20 Unternehmen die Schulung ihrer Teams an. Wir bleiben ein Partner, von der ersten Analyse bis zur Nachbetreuung, und wir messen nur eines: Sprechen Ihre Mitarbeitenden wirklich Deutsch im Beruf.",
    ),
    v1H: tri("Parler avant tout", "Speaking first", "Sprechen zuerst"),
    v1B: tri("La langue se prouve à l'oral. Tout ce que nous faisons sert à faire parler vos équipes.", "A language is proven out loud. Everything we do serves to get your teams speaking.", "Eine Sprache zeigt sich beim Sprechen. Alles, was wir tun, dient dem Ziel, Ihre Teams zum Sprechen zu bringen."),
    v2H: tri("L'humain et l'IA", "Human and AI", "Mensch und KI"),
    v2B: tri("Un vrai professeur pour guider, l'IA pour accélérer. Jamais une simple application.", "A real teacher to guide, AI to accelerate. Never just an app.", "Eine echte Lehrkraft zum Anleiten, KI zum Beschleunigen. Niemals nur eine App."),
    v3H: tri("Un seul partenaire", "One partner", "Ein Partner"),
    v3B: tri("De l'audit au suivi, vous gardez le même interlocuteur, responsable de vos résultats.", "From audit to follow-up, you keep the same contact, accountable for your results.", "Von der Analyse bis zur Nachbetreuung behalten Sie denselben Ansprechpartner, verantwortlich für Ihre Ergebnisse."),
  },

  // ── /contact (enterprise lead-gen) ────────────────────────────────────────
  contact: {
    eyebrow: tri("Parlons de vos équipes", "Let's talk about your teams", "Sprechen wir über Ihre Teams"),
    title:   tri("Réservez votre audit des besoins", "Book your needs audit", "Buchen Sie Ihre Bedarfsanalyse"),
    sub:     tri(
      "Dites-nous où vos équipes ont besoin d'allemand. Nous revenons vers vous sous un jour ouvré avec une première proposition.",
      "Tell us where your teams need German. We get back to you within one business day with a first proposal.",
      "Sagen Sie uns, wo Ihre Teams Deutsch brauchen. Wir melden uns innerhalb eines Werktags mit einem ersten Vorschlag.",
    ),
    fName:    tri("Nom complet", "Full name", "Vollständiger Name"),
    fEmail:   tri("E-mail professionnel", "Work email", "Geschäftliche E-Mail"),
    fCompany: tri("Entreprise", "Company", "Unternehmen"),
    fRole:    tri("Fonction", "Job title", "Position"),
    fPhone:   tri("Téléphone (facultatif)", "Phone (optional)", "Telefon (optional)"),
    fHeadcount: tri("Personnes à former", "People to train", "Zu schulende Personen"),
    fSituations: tri("Où l'allemand est utilisé", "Where German is used", "Wo Deutsch genutzt wird"),
    fSituationsPh: tri("Réunions, clients, appels…", "Meetings, clients, calls…", "Meetings, Kunden, Anrufe…"),
    fMessage: tri("Votre message", "Your message", "Ihre Nachricht"),
    fMessagePh: tri("Ex. : préparer 15 commerciaux à parler allemand avec les clients d'ici septembre.", "E.g. get 15 salespeople ready to speak German with clients by September.", "Z. B. 15 Vertriebler bis September fit machen, mit Kunden auf Deutsch zu sprechen."),
    submit:   tri("Envoyer la demande", "Send request", "Anfrage senden"),
    sending:  tri("Envoi…", "Sending…", "Wird gesendet…"),
    okTitle:  tri("Demande reçue.", "Request received.", "Anfrage erhalten."),
    okBody:   tri("Merci. Nous revenons vers vous sous un jour ouvré.", "Thank you. We will get back to you within one business day.", "Danke. Wir melden uns innerhalb eines Werktags bei Ihnen."),
    errMsg:   tri("Échec de l'envoi. Réessayez ou écrivez-nous directement.", "Sending failed. Try again or email us directly.", "Senden fehlgeschlagen. Bitte erneut versuchen oder direkt schreiben."),
    errValidation: tri("Veuillez remplir le nom, l'e-mail professionnel, l'entreprise et le message.", "Please fill in name, work email, company and message.", "Bitte Name, geschäftliche E-Mail, Firma und Nachricht ausfüllen."),
  },
};
