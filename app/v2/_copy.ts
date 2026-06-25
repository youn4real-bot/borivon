/**
 * Trilingual copy for the /v2 marketing site (FR · EN · DE).
 *
 * Voice: premium, but PLAIN. Every line must read like a 5th-grader could read
 * it: short sentences, common words, no jargon, no vague terms, no em-dashes.
 * We teach professional German, for companies AND individuals, the same German
 * framed for each goal.
 * HARD RULES:
 *   - NOTHING about migrating to Germany (no relocation, visa, Anerkennung,
 *     Ausbildung/Studium, nurse pipeline).
 *   - NEVER write "DACH". Say "German-speaking" or name the countries
 *     (Germany, Austria, Switzerland). Most readers do not know "DACH".
 *   - No fabricated stats, numbers, logos or testimonials.
 *
 * Usage in a page:
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
    business:    tri("Entreprises", "Companies", "Firmen"),
    model:       tri("Comment ça marche", "How it works", "So geht's"),
    individuals: tri("Particuliers", "Individuals", "Privat"),
    about:       tri("À propos", "About", "Über uns"),
    contact:     tri("Parler à un expert", "Talk to an expert", "Beratung anfragen"),
    menu:        tri("Menu", "Menu", "Menü"),
  },
  footer: {
    tagline: tri(
      "L'allemand qui fait gagner vos équipes.",
      "German that helps your team win.",
      "Deutsch, mit dem Ihr Team gewinnt.",
    ),
    colSite:    tri("Site", "Site", "Seite"),
    colCompany: tri("Entreprise", "Company", "Firma"),
    login:      tri("Espace client", "Client portal", "Kundenbereich"),
    rights:     tri("Tous droits réservés.", "All rights reserved.", "Alle Rechte vorbehalten."),
    company:    tri("Borivon LLC", "Borivon LLC", "Borivon LLC"),
    country:    tri("États-Unis", "United States", "Vereinigte Staaten"),
    email:      tri("contact@borivon.com", "contact@borivon.com", "contact@borivon.com"),
    institut:   tri("Allemand pro, pour vous et vos équipes", "Professional German, for you and your team", "Profi-Deutsch, für Sie und Ihr Team"),
  },

  // ── Home ──────────────────────────────────────────────────────────────────
  home: {
    heroEyebrow: tri("Ambitions without Borders", "Ambitions without Borders", "Ambitions without Borders"),
    // heroTitle is split for the word-by-word reveal; last word is the accent.
    heroTitle:   tri("Parlez l'allemand de", "Speak the German of", "Sprechen Sie das Deutsch"),
    heroAccent:  tri("votre travail.", "your work.", "Ihrer Arbeit."),
    heroSub:     tri(
      "Réunions, appels, clients, entretiens : parlez l'allemand dont votre travail a besoin, sans bloquer. Avec l'IA, en ligne, sans grammaire ennuyeuse.",
      "Meetings, calls, clients, interviews: speak the German your job needs, without freezing. With AI, online, no boring grammar.",
      "Meetings, Anrufe, Kunden, Vorstellungsgespräche: Sprechen Sie das Deutsch, das Ihr Job braucht, ohne zu stocken. Mit KI, online, ohne langweilige Grammatik.",
    ),
    heroCta1:    tri("Parler à un expert", "Talk to an expert", "Beratung anfragen"),
    heroCta2:    tri("Voir comment ça marche", "See how it works", "So funktioniert's"),
    chip1:       tri("Propulsé par l'IA", "Powered by AI", "Mit KI"),
    chip2:       tri("On parle d'abord", "Speaking first", "Sprechen zuerst"),
    chip3:       tri("Autour de votre travail", "Around your work", "Rund um Ihre Arbeit"),

    problemEyebrow: tri("Le problème", "The problem", "Das Problem"),
    problemTitle:   tri("L'allemand ouvre un très grand marché.", "German opens a huge market.", "Deutsch öffnet einen riesigen Markt."),
    problemAccent:  tri("Mais seulement si vous le parlez.", "But only if you speak it.", "Aber nur, wenn Sie es sprechen."),
    problemSub:     tri(
      "Sans allemand, vos équipes ratent des occasions chaque semaine.",
      "Without German, your team misses chances every week.",
      "Ohne Deutsch verpasst Ihr Team jede Woche Chancen.",
    ),
    problem1Title: tri("Vous perdez des clients.", "You lose clients.", "Sie verlieren Kunden."),
    problem1Body:  tri("Vos clients allemands préfèrent parler allemand. En anglais, ils choisissent souvent quelqu'un d'autre.", "Your German clients prefer German. In English, they often pick someone else.", "Ihre deutschen Kunden sprechen lieber Deutsch. Auf Englisch wählen sie oft jemand anderen."),
    problem2Title: tri("L'anglais ne suffit pas.", "English isn't enough.", "Englisch reicht nicht."),
    problem2Body:  tri("La confiance se gagne en allemand. C'est là que se concluent les affaires.", "Trust is built in German. That's where deals happen.", "Vertrauen entsteht auf Deutsch. Da fallen die Entscheidungen."),
    problem3Title: tri("L'allemand de l'école ne suffit pas.", "School German isn't enough.", "Schuldeutsch reicht nicht."),
    problem3Body:  tri("Les cours classiques laissent vos équipes bloquées devant un vrai client, au mauvais moment.", "Normal courses leave your team stuck in front of a real client, at the worst moment.", "Normale Kurse helfen nicht: Vor echten Kunden weiß Ihr Team plötzlich nicht weiter, genau im falschen Moment."),

    modelEyebrow: tri("Pourquoi ça marche", "Why it works", "Warum es funktioniert"),
    modelTitle:   tri("Fait pour parler,", "Built to speak,", "Zum Sprechen gemacht,"),
    modelAccent:  tri("pas pour réviser.", "not to study.", "nicht zum Pauken."),
    modelSub:     tri(
      "Pas de grammaire sans fin. On part de vos vraies situations et on vous fait parler dès le premier cours.",
      "No endless grammar. We start with your real situations and get you speaking on day one.",
      "Keine endlose Grammatik. Wir starten mit Ihren echten Situationen und bringen Sie ab dem ersten Tag zum Sprechen.",
    ),
    modeOnlineTag:  tri("On parle d'abord", "Speaking first", "Sprechen zuerst"),
    modeOnlineH:    tri("Parler, dès le 1er cours.", "Speak from day one.", "Sprechen ab Tag eins."),
    modeOnlineB:    tri("Pas de théorie. Vous parlez tout de suite, parce que c'est ce que votre travail demande.", "No theory. You speak right away, because that's what your work needs.", "Keine Theorie. Sie sprechen sofort, weil Ihre Arbeit genau das braucht."),
    modeHybridTag:  tri("Vos situations", "Your situations", "Ihre Situationen"),
    modeHybridH:    tri("Votre allemand, pas un manuel.", "Your German, not a textbook.", "Ihr Deutsch, kein Lehrbuch."),
    modeHybridB:    tri("On travaille vos vraies situations : vos réunions, vos appels, vos entretiens. Un problème clair, une solution claire.", "We work on your real situations: your meetings, calls and interviews. A clear problem, a clear answer.", "Wir arbeiten an Ihren echten Situationen: Meetings, Anrufe, Gespräche. Klares Problem, klare Lösung."),
    modeVorOrtTag:  tri("Sans perdre de temps", "No time lost", "Keine Zeit verlieren"),
    modeVorOrtH:    tri("Autour de votre travail.", "Around your work.", "Rund um Ihre Arbeit."),
    modeVorOrtB:    tri("En ligne, en direct, à l'heure qui vous arrange. Aucun temps de travail perdu.", "Online, live, at a time that works for you. No work time lost.", "Online, live, zur passenden Zeit. Keine verlorene Arbeitszeit."),
    modelGloss:     tri(
      "En direct avec un vrai prof qui vous fait parler et vous corrige. Jamais juste une vidéo.",
      "Live with a real teacher who gets you speaking and corrects you. Never just a video.",
      "Live mit einer echten Lehrkraft, die Sie zum Sprechen bringt und korrigiert. Nie nur ein Video.",
    ),

    journeyEyebrow: tri("La progression", "The journey", "Der Weg"),
    journeyTitle:   tri("Du blocage à", "From stuck to", "Vom Stocken zur"),
    journeyAccent:  tri("l'aisance.", "fluent.", "Sicherheit."),
    journeySub:     tri("Pas de niveaux qui font peur. Des étapes simples vers l'allemand que vous parlez au travail.", "No scary levels. Simple steps to the German you speak at work.", "Keine abschreckenden Stufen. Einfache Schritte zum Deutsch, das Sie bei der Arbeit sprechen."),
    step1: tri("Vos premiers mots, sans bloquer", "Your first words, without freezing", "Erste Worte, ohne zu stocken"),
    step2: tri("Vous menez une réunion en allemand", "You run a meeting in German", "Sie leiten ein Meeting auf Deutsch"),
    step3: tri("Vous gérez appels et clients", "You handle calls and clients", "Sie meistern Anrufe und Kunden"),
    step4: tri("À l'aise partout où l'on parle allemand", "At ease anywhere German is spoken", "Sicher überall, wo Deutsch gesprochen wird"),

    trustA_h: tri("Spécialistes de l'allemand pro", "Business-German experts", "Profis für Business-Deutsch"),
    trustA_b: tri("Une école 100% dédiée à l'allemand professionnel.", "A school fully focused on professional German.", "Eine Schule, ganz auf professionelles Deutsch fokussiert."),
    trustB_h: tri("Tournés vers les résultats", "Results first", "Ergebnisse zuerst"),
    trustB_b: tri("On vise l'allemand qui marche en réunion, pas les diplômes pour la vitrine.", "We aim for German that works in meetings, not diplomas for show.", "Wir wollen Deutsch, das im Meeting funktioniert, keine Diplome fürs Schaufenster."),
    trustC_h: tri("Un partenaire, pas un fournisseur", "A partner, not a vendor", "Ein Partner, kein Lieferant"),
    trustC_b: tri("Du premier besoin au suivi, une seule équipe avec vous.", "From the first need to follow-up, one team at your side.", "Vom ersten Bedarf bis zur Nachbetreuung, ein Team an Ihrer Seite."),

    finalTitle:  tri("Parlons de votre", "Let's talk about your", "Sprechen wir über Ihr"),
    finalAccent: tri("projet.", "plan.", "Vorhaben."),
    finalCta:    tri("Réserver un échange", "Book a call", "Beratung buchen"),
    finalSub:    tri("Pour vous ou vos équipes, en ligne ou sur place. Dites-nous votre but, on construit le cours.", "For you or your teams, online or in person. Tell us your goal, we build the course.", "Für Sie oder Ihre Teams, online oder vor Ort. Sagen Sie uns Ihr Ziel, wir bauen den Kurs."),
  },

  // ── AI — we teach WITH AI + teach you to USE AI to learn faster ───────────
  ai: {
    eyebrow: tri("Propulsé par l'IA", "Powered by AI", "Mit KI"),
    title:   tri("Tout le monde a l'IA.", "Everyone has AI.", "Jeder hat KI."),
    accent:  tri("Vous saurez vous en servir.", "You'll know how to use it.", "Sie lernen, sie zu nutzen."),
    sub:     tri(
      "On utilise l'IA pour vous faire avancer plus vite. Et surtout, on vous apprend à vous en servir pour apprendre l'allemand bien plus vite, seul ou en équipe.",
      "We use AI to help you progress faster. And above all, we teach you to use it to learn German much faster, on your own or as a team.",
      "Wir nutzen KI, damit Sie schneller vorankommen. Und vor allem zeigen wir Ihnen, wie Sie damit viel schneller Deutsch lernen, allein oder im Team.",
    ),
    c1H: tri("On enseigne avec l'IA", "We teach with AI", "Wir unterrichten mit KI"),
    c1B: tri("Exercices sur mesure, correction immédiate, on répète ce qui compte. Vous avancez plus vite, sans perdre de temps.", "Custom exercises, instant correction, we repeat what matters. You move faster, without wasting time.", "Übungen nach Maß, sofortige Korrektur, Wiederholung des Wichtigen. Sie kommen schneller voran, ohne Zeit zu verlieren."),
    c2H: tri("On vous apprend à l'utiliser", "We teach you to use it", "Wir zeigen Ihnen, wie"),
    c2B: tri("Presque personne ne sait utiliser l'IA pour apprendre une langue. Vous, oui. Et vous gardez cette compétence pour toujours.", "Almost no one knows how to use AI to learn a language. You will. And you keep that skill for good.", "Fast niemand weiß, wie man mit KI eine Sprache lernt. Sie schon. Und diese Fähigkeit bleibt."),
    c3H: tri("Beaucoup plus vite", "Much faster", "Viel schneller"),
    c3B: tri("Bien utilisée, l'IA réduit le temps pour parler. On vous montre exactement comment.", "Used well, AI cuts the time it takes to speak. We show you exactly how.", "Richtig genutzt, verkürzt KI die Zeit bis zum Sprechen. Wir zeigen Ihnen genau wie."),
  },

  // ── Home outcomes block (works for both you + your teams) ──────────────────
  ent: {
    eyebrow: tri("Ce que vous saurez faire", "What you'll be able to do", "Was Sie können werden"),
    title:   tri("L'allemand de vos", "The German of your", "Das Deutsch Ihres"),
    accent:  tri("vraies journées.", "real days.", "echten Alltags."),
    body:    tri(
      "Pour vos équipes ou pour votre carrière, c'est l'allemand qu'on parle vraiment : en réunion, au téléphone, en entretien. Sans interprète, sans stress.",
      "For your teams or your career, this is the German people really speak: in meetings, on calls, in interviews. No interpreter, no stress.",
      "Für Ihre Teams oder Ihre Karriere: das Deutsch, das man wirklich spricht, im Meeting, am Telefon, im Gespräch. Ohne Dolmetscher, ohne Stress.",
    ),
    cta:  tri("Parler à un expert", "Talk to an expert", "Beratung anfragen"),
    p1:   tri("Mener vos réunions en allemand", "Lead your meetings in German", "Meetings auf Deutsch führen"),
    p2:   tri("Gérer vos appels et vos clients allemands", "Handle your calls and German clients", "Anrufe und deutsche Kunden meistern"),
    p3:   tri("Réussir vos entretiens en allemand", "Pass your interviews in German", "Gespräche auf Deutsch bestehen"),
    p4:   tri("Négocier et présenter, sans interprète", "Negotiate and present, no interpreter", "Verhandeln und präsentieren, ohne Dolmetscher"),
  },

  // ── Home: full-bleed photo statement (text overlaid on the image) ─────────
  statement: {
    eyebrow: tri("En réunion", "In the meeting", "Im Meeting"),
    line1:   tri("Parlez en réunion", "Speak up in meetings", "Reden Sie im Meeting mit"),
    line2:   tri("sans hésiter.", "without hesitating.", "ohne zu zögern."),
    sub:     tri("Le moment qui compte, vous êtes prêt.", "The moment that matters, you're ready.", "Im wichtigen Moment sind Sie bereit."),
  },

  // ── Home: same German, two goals (B2C + B2B) ──────────────────────────────
  who: {
    eyebrow: tri("Pour qui", "Who it's for", "Für wen"),
    title:   tri("Le même allemand.", "The same German.", "Dasselbe Deutsch."),
    accent:  tri("Deux objectifs.", "Two goals.", "Zwei Ziele."),
    sub:     tri(
      "Particulier ou entreprise, vous apprenez le même allemand pro. On l'adapte juste à votre but.",
      "Individual or company, you learn the same professional German. We just fit it to your goal.",
      "Ob Privatperson oder Firma, Sie lernen dasselbe Profi-Deutsch. Wir passen es nur an Ihr Ziel an.",
    ),
    indH:  tri("Pour les particuliers", "For individuals", "Für Privatpersonen"),
    indB:  tri("Pour votre carrière : une compétence rare et la confiance pour parler allemand au travail.", "For your career: a rare skill and the confidence to speak German at work.", "Für Ihre Karriere: eine seltene Fähigkeit und die Sicherheit, bei der Arbeit Deutsch zu sprechen."),
    entH:  tri("Pour les entreprises", "For companies", "Für Firmen"),
    entB:  tri("Pour vos équipes : servir vos clients allemands et travailler avec vos partenaires allemands.", "For your teams: serve your German clients and work with your German partners.", "Für Ihre Teams: deutsche Kunden betreuen und mit deutschen Partnern arbeiten."),
    more:  tri("En savoir plus", "Learn more", "Mehr erfahren"),
  },

  // ── Home: in-person, on request only, behind the form ─────────────────────
  vorort: {
    eyebrow: tri("Sur place", "In person", "Vor Ort"),
    title:   tri("Vous préférez sur place ?", "Prefer in person?", "Lieber vor Ort?"),
    body:    tri(
      "On propose aussi des cours sur place, sur demande. Dites-nous votre besoin dans le formulaire et on organise.",
      "We also offer in-person classes, on request. Tell us what you need in the form and we'll set it up.",
      "Wir bieten auch Unterricht vor Ort an, auf Anfrage. Sagen Sie uns im Formular, was Sie brauchen, und wir organisieren es.",
    ),
    cta:     tri("Demander un cours sur place", "Request an in-person class", "Unterricht vor Ort anfragen"),
  },

  // ── /particuliers (consumer space, NO migration) ──────────────────────────
  ind: {
    eyebrow: tri("Pour les particuliers", "For individuals", "Für Privatpersonen"),
    title:   tri("L'allemand qui fait avancer", "German that grows", "Deutsch, das Ihre"),
    accent:  tri("votre carrière.", "your career.", "Karriere voranbringt."),
    body:    tri(
      "Ajoutez à votre profil une langue rare. Parlez allemand avec confiance, pour votre métier et vos chances.",
      "Add a rare language to your profile. Speak German with confidence, for your job and your chances.",
      "Geben Sie Ihrem Profil eine seltene Sprache. Sprechen Sie sicher Deutsch, für Ihren Job und Ihre Chancen.",
    ),
    cta:  tri("Commencer", "Get started", "Loslegen"),
    p1:   tri("Une compétence rare qui vous démarque", "A rare skill that sets you apart", "Eine seltene Fähigkeit, die auffällt"),
    p2:   tri("Parlez avec confiance, plus vite que vous ne le pensez", "Speak with confidence, faster than you expect", "Sprechen Sie sicher, schneller als gedacht"),
    p3:   tri("Un allemand utile, pas scolaire", "Useful German, not school German", "Nützliches Deutsch, kein Schuldeutsch"),
    p4:   tri("Accompagné jusqu'à votre but", "Supported all the way to your goal", "Begleitet bis zum Ziel"),

    needsEyebrow: tri("Vos besoins en détail", "Your needs in detail", "Ihre Bedürfnisse im Detail"),
    needsTitle:   tri("L'allemand qui sert votre carrière.", "German that serves your career.", "Deutsch, das Ihrer Karriere dient."),
    n1H: tri("Un plus sur votre CV", "A plus on your CV", "Ein Plus im Lebenslauf"),
    n1B: tri("L'allemand est rare et demandé. Une compétence qui vous fait sortir du lot.", "German is rare and wanted. A skill that makes you stand out.", "Deutsch ist selten und gefragt. Eine Fähigkeit, die heraussticht."),
    n2H: tri("Parler sans bloquer", "Speak without freezing", "Sprechen ohne Blockade"),
    n2B: tri("De la confiance, vite. On vous fait parler dès le premier jour, pas après dix chapitres de grammaire.", "Confidence, fast. We get you speaking on day one, not after ten grammar chapters.", "Sicherheit, schnell. Sie sprechen ab Tag eins, nicht nach zehn Grammatikkapiteln."),
    n3H: tri("L'allemand de votre métier", "The German of your job", "Das Deutsch Ihres Jobs"),
    n3B: tri("On cible les mots et les situations de votre domaine. Utile dès lundi.", "We focus on the words and situations of your field. Useful by Monday.", "Wir konzentrieren uns auf Wörter und Situationen Ihres Fachs. Nützlich ab Montag."),
    n4H: tri("À votre rythme", "At your pace", "In Ihrem Tempo"),
    n4B: tri("En ligne et flexible, autour de votre vie, sans perdre en qualité.", "Online and flexible, around your life, without losing quality.", "Online und flexibel, rund um Ihr Leben, ohne Qualitätsverlust."),
    n5H: tri("Des profs humains", "Human teachers", "Echte Lehrkräfte"),
    n5B: tri("Pas qu'une appli : des profs qui vous suivent, vous corrigent et vous poussent.", "Not just an app: teachers who follow you, correct you and push you.", "Nicht nur eine App: Lehrkräfte, die Sie begleiten, korrigieren und antreiben."),
    n6H: tri("Jamais seul", "Never alone", "Nie allein"),
    n6B: tri("Un accompagnement complet, du premier mot à votre but.", "Full support, from the first word to your goal.", "Volle Begleitung, vom ersten Wort bis zum Ziel."),
  },

  // ── /solutions (companies, NO migration) ──────────────────────────────────
  solutions: {
    eyebrow:  tri("Solutions entreprise", "Business solutions", "Lösungen für Firmen"),
    title:    tri("Une seule chose sépare vos équipes du marché allemand :", "One thing stands between your teams and the German market:", "Nur eine Sache steht zwischen Ihren Teams und dem deutschen Markt:"),
    accent:   tri("la langue.", "language.", "die Sprache."),
    sub:      tri("On l'enlève. 100% en ligne, fait pour l'allemand pro.", "We remove it. 100% online, built for professional German.", "Wir nehmen sie weg. 100% online, für Profi-Deutsch gebaut."),
    cta:      tri("Parler à un expert", "Talk to an expert", "Beratung anfragen"),

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
    out4B: tri("Du premier besoin au suivi : un parcours, un partenaire.", "From the first need to follow-up: one path, one partner.", "Vom ersten Bedarf bis zur Begleitung: ein Weg, ein Partner."),

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
    need5B: tri("Un seul contact qui comprend vos enjeux, du premier audit au suivi.", "One contact who gets your business, from the first check to follow-up.", "Ein Ansprechpartner, der Ihr Geschäft versteht, von der ersten Analyse bis zur Begleitung."),
  },

  // ── /methode (the model) ──────────────────────────────────────────────────
  methode: {
    eyebrow: tri("Comment ça marche", "How it works", "So geht's"),
    title:   tri("L'allemand, en ligne.", "German, online.", "Deutsch, online."),
    accent:  tri("Et ça marche mieux.", "And it works better.", "Und es klappt sogar besser."),
    sub:     tri("On parle d'abord, autour de votre travail. L'allemand que vous utilisez vraiment, sans grammaire ennuyeuse.", "We speak first, around your work. The German you really use, without boring grammar.", "Wir sprechen zuerst, rund um Ihre Arbeit. Das Deutsch, das Sie wirklich nutzen, ohne langweilige Grammatik."),
    cta:     tri("Parler à un expert", "Talk to an expert", "Beratung anfragen"),

    pEyebrow: tri("Les principes", "The principles", "Die Prinzipien"),
    pTitle:   tri("Ce qui rend l'allemand utile.", "What makes German useful.", "Was Deutsch nützlich macht."),
    pr1H: tri("Le but, pas le niveau", "The goal, not the level", "Das Ziel, nicht die Stufe"),
    pr1B: tri("On part de votre vrai but, pas d'une échelle de niveaux abstraite.", "We start from your real goal, not an abstract scale of levels.", "Wir starten von Ihrem echten Ziel, nicht von einer abstrakten Niveauskala."),
    pr2H: tri("La pratique d'abord", "Practice first", "Praxis zuerst"),
    pr2B: tri("L'allemand des clients, des réunions, des contrats. Pas la grammaire pour la grammaire.", "The German of clients, meetings and contracts. Not grammar for grammar's sake.", "Das Deutsch von Kunden, Meetings und Verträgen. Nicht Grammatik um der Grammatik willen."),
    pr3H: tri("Un humain à chaque étape", "A human at every step", "Ein Mensch bei jedem Schritt"),
    pr3B: tri("Des profs qui suivent, corrigent et encouragent. Jamais une appli toute seule.", "Teachers who follow, correct and encourage. Never an app alone.", "Lehrkräfte, die begleiten, korrigieren und motivieren. Nie nur eine App."),
    pr4H: tri("De la langue au résultat", "From language to results", "Von der Sprache zum Ergebnis"),
    pr4B: tri("On ne s'arrête pas au cours. On vous suit jusqu'au résultat sur le terrain.", "We don't stop at the course. We follow you to results on the ground.", "Wir hören nicht beim Kurs auf. Wir begleiten Sie bis zum Ergebnis im Alltag."),
  },

  // ── /a-propos (about, NO migration) ───────────────────────────────────────
  about: {
    eyebrow: tri("À propos", "About", "Über uns"),
    title:   tri("Fondé pour une seule chose :", "Founded for one thing:", "Gegründet für eine Sache:"),
    accent:  tri("résoudre l'allemand.", "solving German.", "Deutsch zu lösen."),
    sub:     tri(
      "Borivon a été créé dans un seul but : régler le problème de l'allemand pour les personnes et les entreprises qui travaillent avec l'Allemagne, l'Autriche et la Suisse.",
      "Borivon was founded for one goal: to fix the German problem for the people and companies who work with Germany, Austria and Switzerland.",
      "Borivon wurde mit einem Ziel gegründet: das Deutsch-Problem für Menschen und Firmen zu lösen, die mit Deutschland, Österreich und der Schweiz arbeiten.",
    ),

    // Social proof, founder-supplied, honest numbers (not fake-perfect).
    stat1N: tri("8+", "8+", "8+"),
    stat1L: tri("Années d'expérience", "Years of experience", "Jahre Erfahrung"),
    stat2N: tri("20+", "20+", "20+"),
    stat2L: tri("Entreprises aidées", "Companies helped", "Firmen geholfen"),
    stat3N: tri("100%", "100%", "100%"),
    stat3L: tri("En ligne", "Online", "Online"),

    storyEyebrow: tri("Pourquoi Borivon", "Why Borivon", "Warum Borivon"),
    storyTitle:   tri("Plus de 8 ans à régler l'allemand.", "8+ years fixing German.", "Über 8 Jahre, in denen wir Deutsch lösen."),
    storyP1: tri(
      "Depuis plus de 8 ans, on aide des entreprises et des particuliers face au même obstacle : l'allemand. Plus de 20 entreprises ont appris à le gérer au quotidien, et beaucoup de particuliers y ont trouvé de nouvelles chances.",
      "For over 8 years, we've helped companies and individuals face the same wall: German. More than 20 companies learned to handle it day to day, and many individuals found new chances through it.",
      "Seit über 8 Jahren helfen wir Firmen und Privatpersonen bei derselben Hürde: Deutsch. Über 20 Firmen haben gelernt, damit täglich umzugehen, und viele Privatpersonen haben neue Chancen gefunden.",
    ),
    storyP2: tri(
      "Notre méthode n'a pas changé : 100% en ligne, humaine, tournée vers les résultats. Pas des diplômes pour la vitrine, mais l'allemand qui sert vraiment, au travail comme dans la vie.",
      "Our method hasn't changed: 100% online, human, results-driven. Not diplomas for show, but German that really helps, at work and in life.",
      "Unsere Methode ist gleich geblieben: 100% online, menschlich, ergebnisorientiert. Keine Diplome fürs Schaufenster, sondern Deutsch, das wirklich hilft, im Beruf wie im Leben.",
    ),
    v1H: tri("Le résultat avant tout", "Results above all", "Ergebnis über allem"),
    v1B: tri("On mesure le succès à ce que vous savez faire, pas à un diplôme.", "We measure success by what you can do, not by a diploma.", "Wir messen Erfolg an dem, was Sie können, nicht an einem Diplom."),
    v2H: tri("L'humain au centre", "People first", "Der Mensch zuerst"),
    v2B: tri("Une langue s'apprend avec des gens, pas seulement des écrans.", "A language is learned with people, not just screens.", "Eine Sprache lernt man mit Menschen, nicht nur mit Bildschirmen."),
    v3H: tri("Clair, sans jargon", "Clear, no jargon", "Klar, ohne Fachwörter"),
    v3B: tri("Pas de niveaux qui font peur. Des étapes que tout le monde comprend.", "No scary levels. Steps everyone understands.", "Keine abschreckenden Stufen. Schritte, die jeder versteht."),
  },

  // ── /contact ──────────────────────────────────────────────────────────────
  contact: {
    eyebrow: tri("Parler à un expert", "Talk to an expert", "Beratung anfragen"),
    title:   tri("Parlons de votre but.", "Let's talk about your goal.", "Sprechen wir über Ihr Ziel."),
    sub:     tri(
      "Dites-nous où vous en êtes. On revient vers vous avec un plan clair, 100% en ligne.",
      "Tell us where you are. We'll come back with a clear plan, 100% online.",
      "Sagen Sie uns, wo Sie stehen. Wir melden uns mit einem klaren Plan, 100% online.",
    ),
    fName:    tri("Nom complet", "Full name", "Vollständiger Name"),
    fCompany: tri("Entreprise (optionnel)", "Company (optional)", "Firma (optional)"),
    fEmail:   tri("E-mail professionnel", "Work email", "Geschäftliche E-Mail"),
    fPhone:   tri("Téléphone (optionnel)", "Phone (optional)", "Telefon (optional)"),
    fMessage: tri("Votre besoin", "What you need", "Ihr Anliegen"),
    fMessagePh: tri("Ex. : préparer 15 commerciaux à parler allemand avec les clients d'ici septembre.", "E.g. get 15 salespeople ready to speak German with clients by September.", "Z. B. 15 Vertriebler bis September fit machen, mit Kunden auf Deutsch zu sprechen."),
    audienceLabel: tri("Vous êtes", "You are", "Sie sind"),
    audBusiness:   tri("Une entreprise", "A business", "Eine Firma"),
    audIndividual: tri("Un particulier", "An individual", "Eine Privatperson"),
    submit:   tri("Envoyer", "Send", "Senden"),
    sending:  tri("Envoi…", "Sending…", "Wird gesendet…"),
    okTitle:  tri("Message reçu.", "Message received.", "Nachricht erhalten."),
    okBody:   tri("Merci, on revient vers vous très vite.", "Thank you, we'll get back to you very soon.", "Danke, wir melden uns sehr bald bei Ihnen."),
    errMsg:   tri("Échec de l'envoi. Réessayez ou écrivez-nous directement.", "Sending failed. Try again or email us directly.", "Senden fehlgeschlagen. Bitte erneut versuchen oder direkt schreiben."),
    errValidation: tri("Veuillez remplir le nom, l'e-mail et le message.", "Please fill in name, email and message.", "Bitte Name, E-Mail und Nachricht ausfüllen."),
  },
};
