/**
 * Trilingual copy for the /v2 marketing site (FR · EN · DE).
 *
 * Voice: premium, minimal, OUTCOME-only. No level jargon (A1/A2/B1/B2).
 * POSITIONING: B2B / corporate German training. The FRONT speaks ONLY to
 * companies — German as a business advantage so teams win German-speaking
 * clients, partners and markets (DACH), wherever they already are.
 * HARD RULE: NOTHING about migrating to Germany — no relocation, no visa, no
 * Anerkennung, no Ausbildung/Studium-in-Germany, no nurse pipeline.
 * The consumer space (/particuliers) is kept but secondary: German as a
 * career skill, still no migration.
 * The hybrid delivery model (En ligne · Vor Ort · Hybride) is the "how".
 * Motto: "Ambitions without Borders" (constant, never translated).
 * No fabricated stats, numbers, logos or testimonials.
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

/** Brand motto — constant, shown across the site, never translated. */
export const MOTTO = "Ambitions without Borders";

export const COPY = {
  // ── Chrome ──────────────────────────────────────────────────────────────
  nav: {
    business:    tri("Solutions", "Solutions", "Lösungen"),
    model:       tri("Le modèle", "The model", "Das Modell"),
    individuals: tri("Particuliers", "Individuals", "Privatpersonen"),
    about:       tri("À propos", "About", "Über uns"),
    contact:     tri("Parler à un expert", "Talk to an expert", "Beratung anfragen"),
    menu:        tri("Menu", "Menu", "Menü"),
  },
  footer: {
    tagline: tri(
      "L'allemand professionnel qui fait gagner vos équipes.",
      "Professional German that helps your teams win.",
      "Professionelles Deutsch, mit dem Ihre Teams gewinnen.",
    ),
    colSite:    tri("Site", "Site", "Seite"),
    colCompany: tri("Entreprise", "Company", "Unternehmen"),
    login:      tri("Espace client", "Client portal", "Kundenbereich"),
    rights:     tri("Tous droits réservés.", "All rights reserved.", "Alle Rechte vorbehalten."),
    company:    tri("Borivon LLC", "Borivon LLC", "Borivon LLC"),
    country:    tri("États-Unis", "United States", "Vereinigte Staaten"),
    email:      tri("contact@borivon.com", "contact@borivon.com", "contact@borivon.com"),
    institut:   tri("Allemand professionnel — particuliers & entreprises", "Professional German — individuals & business", "Professionelles Deutsch — Privat & Unternehmen"),
  },

  // ── Home (B2B only) ───────────────────────────────────────────────────────
  home: {
    heroEyebrow: tri("Ambitions without Borders", "Ambitions without Borders", "Ambitions without Borders"),
    // heroTitle is split for the word-by-word reveal; last word is the accent.
    heroTitle:   tri("Nous enseignons l'allemand", "We teach professional", "Wir unterrichten professionelles"),
    heroAccent:  tri("professionnel.", "German.", "Deutsch."),
    heroSub:     tri(
      "En ligne, en direct, avec un vrai formateur. Pour votre carrière ou pour vos équipes — c'est le même allemand, adapté à votre objectif.",
      "Online, live, with a real teacher. For your career or for your teams — it's the same German, fit to your goal.",
      "Online, live, mit einer echten Lehrkraft. Für Ihre Karriere oder Ihre Teams — dasselbe Deutsch, auf Ihr Ziel zugeschnitten.",
    ),
    heroCta1:    tri("Parler à un expert", "Talk to an expert", "Beratung anfragen"),
    heroCta2:    tri("Voir comment ça marche", "See how it works", "So funktioniert's"),
    chip1:       tri("Allemand professionnel", "Professional German", "Professionelles Deutsch"),
    chip2:       tri("En ligne & en direct", "Online & live", "Online & live"),
    chip3:       tri("Particuliers & entreprises", "Individuals & business", "Privat & Unternehmen"),

    problemEyebrow: tri("L'enjeu", "What's at stake", "Worum es geht"),
    problemTitle:   tri("Le marché germanophone est le plus grand d'Europe.", "The German-speaking market is Europe's largest.", "Der deutschsprachige Markt ist der größte Europas."),
    problemAccent:  tri("Il se gagne en allemand.", "You win it in German.", "Gewonnen wird er auf Deutsch."),
    problemSub:     tri(
      "Sans l'allemand, vos équipes le subissent au lieu de le conquérir.",
      "Without German, your teams endure it instead of winning it.",
      "Ohne Deutsch erleiden Ihre Teams ihn, statt ihn zu gewinnen.",
    ),
    problem1Title: tri("Des affaires qui vous échappent.", "Deals that slip away.", "Aufträge, die Ihnen entgehen."),
    problem1Body:  tri("Vos clients et partenaires germanophones préfèrent traiter en allemand. En anglais, vous passez après.", "Your German-speaking clients and partners prefer to deal in German. In English, you come second.", "Ihre deutschsprachigen Kunden und Partner verhandeln am liebsten auf Deutsch. Auf Englisch kommen Sie erst danach."),
    problem2Title: tri("L'anglais ne suffit pas.", "English isn't enough.", "Englisch reicht nicht."),
    problem2Body:  tri("La relation, la confiance et les détails se jouent en allemand — pas dans une langue de secours.", "The relationship, the trust and the details happen in German — not in a fallback language.", "Beziehung, Vertrauen und Details entscheiden sich auf Deutsch — nicht in einer Ausweichsprache."),
    problem3Title: tri("L'allemand scolaire ne tient pas.", "School German doesn't hold up.", "Schuldeutsch hält nicht."),
    problem3Body:  tri("Les cours génériques laissent vos équipes bloquées — elles calent face à un vrai client, au mauvais moment.", "Generic courses leave your teams stuck — they freeze in front of a real client, at the worst moment.", "Generische Kurse lassen Ihre Teams blockiert zurück — sie versagen vor echten Kunden, im falschen Moment."),

    modelEyebrow: tri("Pourquoi en ligne", "Why online", "Warum online"),
    modelTitle:   tri("Des cours en ligne,", "Online classes,", "Online-Unterricht,"),
    modelAccent:  tri("en direct.", "live.", "live."),
    modelSub:     tri(
      "Pas de vidéos préenregistrées : un vrai formateur, en direct, à l'heure qui vous arrange. Voici pourquoi c'est plus efficace.",
      "No pre-recorded videos: a real teacher, live, at a time that suits you. Here's why it works better.",
      "Keine vorgefertigten Videos: eine echte Lehrkraft, live, zur passenden Uhrzeit. Darum funktioniert es besser.",
    ),
    modeOnlineTag:  tri("À l'échelle", "At scale", "Skalierbar"),
    modeOnlineH:    tri("5 ou 500 personnes.", "5 or 500 people.", "5 oder 500 Personen."),
    modeOnlineB:    tri("La même qualité de cours pour toute l'équipe, où qu'elle soit. Aucun déplacement, aucune salle à réserver.", "The same quality of class for the whole team, wherever they are. No travel, no room to book.", "Dieselbe Unterrichtsqualität für das ganze Team, egal wo. Keine Anreise, keine Raumbuchung."),
    modeHybridTag:  tri("Flexibilité", "Flexibility", "Flexibilität"),
    modeHybridH:    tri("Quand ça vous arrange.", "When it suits you.", "Wann es Ihnen passt."),
    modeHybridB:    tri("Les cours s'adaptent à votre emploi du temps. Vous apprenez sans arrêter de travailler.", "Classes fit around your schedule. You learn without stopping work.", "Der Unterricht passt sich Ihrem Zeitplan an. Sie lernen, ohne die Arbeit zu unterbrechen."),
    modeVorOrtTag:  tri("Régularité", "Consistency", "Regelmäßigkeit"),
    modeVorOrtH:    tri("Un peu, souvent.", "A little, often.", "Ein wenig, oft."),
    modeVorOrtB:    tri("Des cours réguliers font progresser plus qu'un stage intensif ponctuel. En ligne, c'est simple à tenir chaque semaine.", "Regular classes make you progress more than a one-off intensive. Online, it's easy to keep up every week.", "Regelmäßiger Unterricht bringt mehr als ein einmaliger Intensivkurs. Online lässt er sich jede Woche leicht einhalten."),
    modelGloss:     tri(
      "En ligne ne veut pas dire seul : vous parlez en direct avec un formateur qui vous corrige et vous fait pratiquer.",
      "Online doesn't mean alone: you speak live with a teacher who corrects you and gets you practising.",
      "Online heißt nicht allein: Sie sprechen live mit einer Lehrkraft, die Sie korrigiert und üben lässt.",
    ),

    journeyEyebrow: tri("La progression", "The journey", "Der Weg"),
    journeyTitle:   tri("De zéro à", "From zero to", "Von null auf"),
    journeyAccent:  tri("opérationnel.", "operational.", "einsatzbereit."),
    journeySub:     tri("Sans jargon, sans niveaux qui font peur — juste des étapes claires vers un objectif clair.", "No jargon, no scary levels — just clear steps toward a clear goal.", "Ohne Fachjargon, ohne abschreckende Niveaustufen — nur klare Schritte zu einem klaren Ziel."),
    step1: tri("Les premiers mots, en confiance", "First words, with confidence", "Erste Worte, mit Sicherheit"),
    step2: tri("Une vraie conversation, au travail", "A real conversation, at work", "Ein echtes Gespräch, bei der Arbeit"),
    step3: tri("Le métier géré en allemand", "The job handled in German", "Der Beruf auf Deutsch gemeistert"),
    step4: tri("À l'aise avec vos clients allemands", "At ease with your German clients", "Sicher mit Ihren deutschen Kunden"),

    trustA_h: tri("Spécialiste de l'allemand pro", "Business-German specialist", "Spezialist für Business-Deutsch"),
    trustA_b: tri("Un institut entièrement dédié à l'allemand professionnel.", "An institute fully dedicated to professional German.", "Ein Institut, ganz auf professionelles Deutsch ausgerichtet."),
    trustB_h: tri("Méthode orientée résultats", "Results-driven method", "Ergebnisorientierte Methode"),
    trustB_b: tri("On vise l'allemand qui performe en réunion, pas les certificats pour la vitrine.", "We aim for German that performs in meetings, not certificates for show.", "Wir zielen auf Deutsch, das in Meetings überzeugt — nicht auf Zertifikate fürs Schaufenster."),
    trustC_h: tri("Un partenaire, pas un fournisseur", "A partner, not a vendor", "Ein Partner, kein Lieferant"),
    trustC_b: tri("De l'audit des besoins au suivi sur le terrain — un seul interlocuteur.", "From a needs audit to follow-up on the ground — one single contact.", "Von der Bedarfsanalyse bis zur Begleitung im Alltag — ein Ansprechpartner."),

    finalTitle:  tri("Parlons de votre", "Let's talk about your", "Sprechen wir über Ihr"),
    finalAccent: tri("projet.", "plan.", "Vorhaben."),
    finalSub:    tri("Carrière ou équipes, en ligne ou Vor Ort — dites-nous votre objectif et nous construisons le cours.", "Career or teams, online or Vor Ort — tell us your goal and we'll build the course.", "Karriere oder Teams, online oder Vor Ort — sagen Sie uns Ihr Ziel und wir bauen den Kurs."),
  },

  // ── Enterprise value (home audience block + reused) ───────────────────────
  ent: {
    eyebrow: tri("Pour les entreprises", "For business", "Für Unternehmen"),
    title:   tri("L'allemand qui fait avancer", "German that moves", "Deutsch, das voranbringt:"),
    accent:  tri("vos équipes.", "your teams.", "Ihre Teams."),
    body:    tri(
      "Des collaborateurs qui servent vos clients germanophones, négocient avec vos partenaires et portent vos projets dans la langue du marché — sans interprète, sans friction.",
      "People who serve your German-speaking clients, negotiate with your partners and carry your projects in the market's language — no interpreter, no friction.",
      "Mitarbeitende, die Ihre deutschsprachigen Kunden betreuen, mit Partnern verhandeln und Ihre Projekte in der Sprache des Marktes tragen — ohne Dolmetscher, ohne Reibung.",
    ),
    cta:  tri("Parler à un expert", "Talk to an expert", "Beratung anfragen"),
    p1:   tri("Servez vos clients germanophones avec aisance", "Serve your German-speaking clients with ease", "Betreuen Sie deutschsprachige Kunden mit Leichtigkeit"),
    p2:   tri("Négociez avec vos partenaires, sans interprète", "Negotiate with your partners, no interpreter", "Verhandeln Sie mit Partnern, ohne Dolmetscher"),
    p3:   tri("Des équipes confiantes — en réunion, au téléphone, par écrit", "Confident teams — in meetings, on calls, in writing", "Sichere Teams — im Meeting, am Telefon, schriftlich"),
    p4:   tri("Une méthode mesurable, des résultats visibles", "A measurable method, visible results", "Eine messbare Methode, sichtbare Ergebnisse"),
  },

  // ── Home: same German, two framings (B2C + B2B) ───────────────────────────
  who: {
    eyebrow: tri("Pour qui", "Who it's for", "Für wen"),
    title:   tri("Le même allemand.", "The same German.", "Dasselbe Deutsch."),
    accent:  tri("Deux objectifs.", "Two goals.", "Zwei Ziele."),
    sub:     tri(
      "Particulier ou entreprise, vous apprenez le même allemand professionnel. On l'adapte simplement à votre objectif.",
      "Individual or company, you learn the same professional German. We simply fit it to your goal.",
      "Ob Privatperson oder Unternehmen — Sie lernen dasselbe professionelle Deutsch. Wir passen es einfach an Ihr Ziel an.",
    ),
    indH:  tri("Pour les particuliers", "For individuals", "Für Privatpersonen"),
    indB:  tri("Pour votre carrière : une compétence rare et la confiance pour parler allemand au travail.", "For your career: a rare skill and the confidence to speak German at work.", "Für Ihre Karriere: eine seltene Fähigkeit und die Sicherheit, bei der Arbeit Deutsch zu sprechen."),
    entH:  tri("Pour les entreprises", "For business", "Für Unternehmen"),
    entB:  tri("Pour vos équipes : servir vos clients allemands et travailler avec vos partenaires germanophones.", "For your teams: serve your German clients and work with your German-speaking partners.", "Für Ihre Teams: deutsche Kunden betreuen und mit deutschsprachigen Partnern arbeiten."),
    more:  tri("En savoir plus", "Learn more", "Mehr erfahren"),
  },

  // ── Home: Vor Ort (in-person) — on request only, behind the form ──────────
  vorort: {
    eyebrow: tri("En présentiel", "In person", "In Präsenz"),
    title:   tri("Vous préférez le présentiel ?", "Prefer in person?", "Lieber in Präsenz?"),
    body:    tri(
      "Nous proposons aussi des cours Vor Ort, en présentiel, sur demande. Dites-nous votre besoin dans le formulaire et nous organisons.",
      "We also offer Vor Ort classes, in person, on request. Tell us what you need in the form and we'll arrange it.",
      "Wir bieten auch Vor-Ort-Unterricht in Präsenz an, auf Anfrage. Sagen Sie uns im Formular, was Sie brauchen, und wir organisieren es.",
    ),
    cta:     tri("Demander un cours Vor Ort", "Request a Vor Ort class", "Vor-Ort-Unterricht anfragen"),
  },

  // ── /particuliers (consumer space — kept, NO migration) ───────────────────
  ind: {
    eyebrow: tri("Pour les particuliers", "For individuals", "Für Privatpersonen"),
    title:   tri("L'allemand qui fait avancer", "German that moves", "Deutsch, das voranbringt:"),
    accent:  tri("votre carrière.", "your career.", "Ihre Karriere."),
    body:    tri(
      "Ajoutez à votre profil une langue qui compte. Parlez allemand avec confiance — pour votre métier, vos opportunités, vous-même.",
      "Add a language that matters to your profile. Speak German with confidence — for your work, your opportunities, yourself.",
      "Fügen Sie Ihrem Profil eine Sprache hinzu, die zählt. Sprechen Sie sicher Deutsch — für Ihren Beruf, Ihre Chancen, sich selbst.",
    ),
    cta:  tri("Commencer", "Get started", "Loslegen"),
    p1:   tri("Une compétence rare qui vous distingue", "A rare skill that sets you apart", "Eine seltene Fähigkeit, die Sie hervorhebt"),
    p2:   tri("Parlez avec confiance, plus vite que prévu", "Speak with confidence, sooner than you think", "Sprechen Sie sicher, schneller als gedacht"),
    p3:   tri("Un allemand utile, pas scolaire", "Useful German, not school German", "Nützliches Deutsch, kein Schuldeutsch"),
    p4:   tri("Accompagné jusqu'à votre objectif", "Supported all the way to your goal", "Begleitet bis zu Ihrem Ziel"),

    needsEyebrow: tri("Vos besoins, en profondeur", "Your needs, in depth", "Ihre Bedürfnisse, im Detail"),
    needsTitle:   tri("L'allemand qui sert votre carrière.", "German that serves your career.", "Deutsch, das Ihrer Karriere dient."),
    n1H: tri("Un atout sur votre CV", "An edge on your CV", "Ein Plus im Lebenslauf"),
    n1B: tri("L'allemand est rare et recherché — une compétence qui vous fait sortir du lot.", "German is rare and in demand — a skill that makes you stand out.", "Deutsch ist selten und gefragt — eine Fähigkeit, die Sie hervorhebt."),
    n2H: tri("Parler sans bloquer", "Speak without freezing", "Sprechen, ohne zu blockieren"),
    n2B: tri("De la confiance, vite. On vous fait parler dès le premier jour — pas après dix chapitres de grammaire.", "Confidence, fast. We get you speaking from day one — not after ten grammar chapters.", "Sicherheit, schnell. Wir bringen Sie ab dem ersten Tag zum Sprechen — nicht erst nach zehn Grammatikkapiteln."),
    n3H: tri("L'allemand de votre métier", "The German of your field", "Das Deutsch Ihres Fachs"),
    n3B: tri("On cible le vocabulaire et les situations de votre domaine — utile dès le lundi suivant.", "We target the vocabulary and situations of your field — useful the very next Monday.", "Wir zielen auf Wortschatz und Situationen Ihres Fachs — nützlich schon am nächsten Montag."),
    n4H: tri("À votre rythme", "At your pace", "In Ihrem Tempo"),
    n4B: tri("En ligne, flexible, autour de votre vie — sans sacrifier la qualité ni l'accompagnement.", "Online, flexible, around your life — without sacrificing quality or guidance.", "Online, flexibel, rund um Ihr Leben — ohne Abstriche bei Qualität und Begleitung."),
    n5H: tri("Des formateurs humains", "Human trainers", "Echte Lehrkräfte"),
    n5B: tri("Pas une plateforme seule : des formateurs qui vous suivent, corrigent et poussent.", "Not a platform alone: trainers who follow you, correct you and push you.", "Keine reine Plattform: Lehrkräfte, die Sie begleiten, korrigieren und antreiben."),
    n6H: tri("Jamais seul", "Never alone", "Nie allein"),
    n6B: tri("Un accompagnement de bout en bout, du premier mot à votre objectif.", "End-to-end support, from the first word to your goal.", "Begleitung von A bis Z, vom ersten Wort bis zu Ihrem Ziel."),
  },

  // ── /solutions (enterprise deep-dive, NO migration) ───────────────────────
  solutions: {
    eyebrow:  tri("Solutions entreprise", "Business solutions", "Lösungen für Unternehmen"),
    title:    tri("Une seule barrière entre vos équipes et le marché germanophone :", "One barrier stands between your teams and the German-speaking market:", "Eine Hürde steht zwischen Ihren Teams und dem deutschsprachigen Markt:"),
    accent:   tri("la langue.", "language.", "die Sprache."),
    sub:      tri("On la lève — 100% en ligne, conçu pour l'allemand professionnel.", "We remove it — 100% online, built for professional German.", "Wir nehmen sie weg — 100% online, für professionelles Deutsch gebaut."),
    cta:      tri("Parler à un expert", "Talk to an expert", "Beratung anfragen"),

    forEyebrow: tri("Pour qui", "Who it's for", "Für wen"),
    forTitle:   tri("Conçu pour les entreprises qui visent le marché germanophone.", "Built for companies aiming at the German-speaking market.", "Gemacht für Unternehmen, die den deutschsprachigen Markt anvisieren."),
    seg1H: tri("Équipes commerciales & clients", "Sales & client teams", "Vertrieb & Kundenteams"),
    seg1B: tri("Vos commerciaux et chargés de compte traitent avec des clients germanophones — et veulent gagner, pas traduire.", "Your sales and account teams deal with German-speaking clients — and want to win, not translate.", "Ihr Vertrieb und Ihre Kundenbetreuung arbeiten mit deutschsprachigen Kunden — und wollen gewinnen, nicht übersetzen."),
    seg2H: tri("Partenaires & maisons mères", "Partners & HQs", "Partner & Mutterhäuser"),
    seg2B: tri("Vos équipes collaborent avec des partenaires, fournisseurs ou une maison mère allemande au quotidien.", "Your teams work with German partners, suppliers or a German HQ every day.", "Ihre Teams arbeiten täglich mit deutschen Partnern, Lieferanten oder einer deutschen Zentrale zusammen."),
    seg3H: tri("Expansion DACH", "DACH expansion", "DACH-Expansion"),
    seg3B: tri("Vous visez l'Allemagne, l'Autriche ou la Suisse — le marché s'ouvre en allemand, pas en anglais.", "You're targeting Germany, Austria or Switzerland — the market opens in German, not English.", "Sie zielen auf Deutschland, Österreich oder die Schweiz — der Markt öffnet sich auf Deutsch, nicht auf Englisch."),

    outEyebrow: tri("Ce que vous y gagnez", "What you gain", "Ihr Gewinn"),
    outTitle:   tri("Des résultats que vous mesurez.", "Results you can measure.", "Ergebnisse, die Sie messen."),
    out1H: tri("Plus d'affaires gagnées", "More deals won", "Mehr gewonnene Aufträge"),
    out1B: tri("Des équipes qui closent en allemand au lieu de perdre face à un concurrent qui le parle.", "Teams that close in German instead of losing to a competitor who speaks it.", "Teams, die auf Deutsch abschließen, statt gegen einen deutschsprachigen Wettbewerber zu verlieren."),
    out2H: tri("Des relations plus solides", "Stronger relationships", "Stärkere Beziehungen"),
    out2B: tri("La confiance se construit dans la langue du partenaire. La vôtre passe au niveau supérieur.", "Trust is built in the partner's language. Yours steps up a level.", "Vertrauen entsteht in der Sprache des Partners. Ihres steigt eine Stufe höher."),
    out3H: tri("Des équipes confiantes", "Confident teams", "Selbstsichere Teams"),
    out3B: tri("Plus de blocage au téléphone ou en réunion — vos collaborateurs prennent la parole.", "No more freezing on calls or in meetings — your people speak up.", "Kein Blockieren mehr am Telefon oder im Meeting — Ihre Leute ergreifen das Wort."),
    out4H: tri("Un seul interlocuteur", "One single partner", "Ein einziger Ansprechpartner"),
    out4B: tri("De l'audit des besoins au suivi — un parcours, un partenaire.", "From a needs audit to follow-up — one path, one partner.", "Von der Bedarfsanalyse bis zur Begleitung — ein Weg, ein Partner."),

    needsEyebrow: tri("Vos besoins, en profondeur", "Your needs, in depth", "Ihre Bedürfnisse, im Detail"),
    needsTitle:   tri("Pensé pour la performance, pas pour la salle de classe.", "Built for performance, not the classroom.", "Für Leistung gebaut, nicht fürs Klassenzimmer."),
    need1H: tri("Des cohortes à l'échelle", "Cohorts at scale", "Kohorten im großen Maßstab"),
    need1B: tri("Formez 5, 20 ou 100 collaborateurs avec une qualité constante et un calendrier qui tient.", "Train 5, 20 or 100 staff with consistent quality and a schedule that holds.", "Schulen Sie 5, 20 oder 100 Mitarbeitende — mit gleichbleibender Qualität und einem Plan, der hält."),
    need2H: tri("Sans les sortir du travail", "Without taking them off work", "Ohne sie von der Arbeit abzuziehen"),
    need2B: tri("100% en ligne : vos équipes apprennent autour du travail, sans déplacement ni production stoppée.", "100% online: your teams learn around the workday, no travel and no production stopped.", "100% online: Ihre Teams lernen rund um den Arbeitstag — ohne Anreise und ohne gestoppte Produktion."),
    need3H: tri("L'allemand de votre secteur", "The German of your industry", "Das Deutsch Ihrer Branche"),
    need3B: tri("Pas l'allemand scolaire : le vocabulaire de vos clients, vos réunions, vos contrats.", "Not school German: the vocabulary of your clients, your meetings, your contracts.", "Kein Schuldeutsch: der Wortschatz Ihrer Kunden, Ihrer Meetings, Ihrer Verträge."),
    need4H: tri("Une visibilité réelle", "Real visibility", "Echte Transparenz"),
    need4B: tri("Vous savez où en est chaque collaborateur — progression, présence, prêt-à-l'emploi.", "You know where every employee stands — progress, attendance, readiness.", "Sie wissen, wo jede/r Mitarbeitende steht — Fortschritt, Anwesenheit, Einsatzreife."),
    need5H: tri("Un partenaire, pas un fournisseur", "A partner, not a vendor", "Ein Partner, kein Lieferant"),
    need5B: tri("Un interlocuteur unique qui comprend vos enjeux business, du premier audit au suivi.", "A single contact who understands your business stakes, from the first audit to follow-up.", "Ein Ansprechpartner, der Ihre Geschäftsziele versteht — von der ersten Analyse bis zur Begleitung."),
  },

  // ── /methode (the hybrid model) ───────────────────────────────────────────
  methode: {
    eyebrow: tri("Le modèle", "The model", "Das Modell"),
    title:   tri("En ligne par conception.", "Online by design.", "Online by Design."),
    accent:  tri("Efficace par nature.", "Effective by nature.", "Wirksam von Natur aus."),
    sub:     tri("Flexible, régulier, à l'échelle — l'allemand qui entre vraiment dans vos équipes, sans jamais les sortir du travail.", "Flexible, consistent, scalable — German that truly lands in your teams, without ever taking them off work.", "Flexibel, regelmäßig, skalierbar — Deutsch, das wirklich in Ihre Teams kommt, ohne sie je von der Arbeit abzuziehen."),
    cta:     tri("Parler à un expert", "Talk to an expert", "Beratung anfragen"),

    pEyebrow: tri("Les principes", "The principles", "Die Prinzipien"),
    pTitle:   tri("Ce qui rend l'allemand performant.", "What makes German perform.", "Was Deutsch leistungsfähig macht."),
    pr1H: tri("L'objectif, pas le niveau", "The goal, not the level", "Das Ziel, nicht die Stufe"),
    pr1B: tri("On part de votre objectif business réel — pas d'une échelle abstraite de niveaux.", "We start from your real business goal — not an abstract scale of levels.", "Wir starten von Ihrem echten Geschäftsziel — nicht von einer abstrakten Niveauskala."),
    pr2H: tri("La pratique d'abord", "Practice first", "Praxis zuerst"),
    pr2B: tri("L'allemand des clients, des réunions, des contrats — pas la grammaire pour la grammaire.", "The German of clients, meetings, contracts — not grammar for grammar's sake.", "Das Deutsch von Kunden, Meetings, Verträgen — nicht Grammatik um der Grammatik willen."),
    pr3H: tri("Un humain à chaque étape", "A human at every step", "Ein Mensch bei jedem Schritt"),
    pr3B: tri("Des formateurs qui suivent, corrigent, encouragent — jamais une plateforme seule.", "Trainers who follow, correct, encourage — never a platform alone.", "Trainer, die begleiten, korrigieren, motivieren — nie nur eine Plattform."),
    pr4H: tri("La langue jusqu'à la performance", "Language through to performance", "Sprache bis zur Leistung"),
    pr4B: tri("On ne s'arrête pas au cours : on accompagne jusqu'à la performance sur le terrain.", "We don't stop at the course: we support all the way to performance on the ground.", "Wir hören nicht beim Kurs auf: Wir begleiten bis zur Leistung im Alltag."),
  },

  // ── /a-propos (about, NO migration) ───────────────────────────────────────
  about: {
    eyebrow: tri("À propos", "About", "Über uns"),
    title:   tri("Une mission simple :", "A simple mission:", "Eine einfache Mission:"),
    accent:  tri("l'allemand au service de votre business.", "German in the service of your business.", "Deutsch im Dienst Ihres Geschäfts."),
    sub:     tri("Borivon est un institut spécialisé dans l'allemand professionnel pour les entreprises.", "Borivon is an institute specialised in professional German for companies.", "Borivon ist ein Institut für professionelles Deutsch für Unternehmen."),

    storyEyebrow: tri("Pourquoi Borivon", "Why Borivon", "Warum Borivon"),
    storyTitle:   tri("Né d'un constat, construit pour le résoudre.", "Born from a problem, built to solve it.", "Aus einem Problem entstanden, gebaut, um es zu lösen."),
    storyP1: tri(
      "D'un côté, le marché germanophone — le plus grand d'Europe. De l'autre, des entreprises prêtes à le conquérir, freinées par une seule chose : la langue.",
      "On one side, the German-speaking market — Europe's largest. On the other, companies ready to win it, held back by one thing: the language.",
      "Auf der einen Seite der deutschsprachige Markt — der größte Europas. Auf der anderen Unternehmen, bereit ihn zu gewinnen, gebremst von nur einer Sache: der Sprache.",
    ),
    storyP2: tri(
      "Nous avons construit un modèle qui lève cette barrière — 100% en ligne, humain, orienté résultats. Pas des certificats pour la vitrine, mais l'allemand qui fait gagner des affaires.",
      "We built a model that removes that barrier — 100% online, human, results-driven. Not certificates for show, but German that wins business.",
      "Wir haben ein Modell gebaut, das diese Hürde beseitigt — 100% online, menschlich, ergebnisorientiert. Keine Zertifikate fürs Schaufenster, sondern Deutsch, das Aufträge gewinnt.",
    ),
    v1H: tri("Le résultat avant tout", "Results above all", "Ergebnis über allem"),
    v1B: tri("On mesure le succès à votre performance, pas à un certificat.", "We measure success by your performance, not a certificate.", "Wir messen Erfolg an Ihrer Leistung, nicht an einem Zertifikat."),
    v2H: tri("L'humain au centre", "People at the center", "Der Mensch im Mittelpunkt"),
    v2B: tri("Une langue s'apprend avec des gens, pas seulement des écrans.", "A language is learned with people, not just screens.", "Eine Sprache lernt man mit Menschen, nicht nur mit Bildschirmen."),
    v3H: tri("Clair, sans jargon", "Clear, no jargon", "Klar, ohne Fachjargon"),
    v3B: tri("Pas de niveaux qui font peur. Des étapes que tout le monde comprend.", "No scary levels. Steps everyone understands.", "Keine abschreckenden Niveaustufen. Schritte, die jeder versteht."),
  },

  // ── /contact ──────────────────────────────────────────────────────────────
  contact: {
    eyebrow: tri("Parler à un expert", "Talk to an expert", "Beratung anfragen"),
    title:   tri("Parlons de vos équipes.", "Let's talk about your teams.", "Sprechen wir über Ihre Teams."),
    sub:     tri(
      "Dites-nous où vous en êtes — on revient vers vous avec un parcours concret, 100% en ligne.",
      "Tell us where you stand — we'll come back with a concrete path, 100% online.",
      "Sagen Sie uns, wo Sie stehen — wir melden uns mit einem konkreten Weg, 100% online.",
    ),
    fName:    tri("Nom complet", "Full name", "Vollständiger Name"),
    fCompany: tri("Entreprise (optionnel)", "Company (optional)", "Unternehmen (optional)"),
    fEmail:   tri("E-mail professionnel", "Work email", "Geschäftliche E-Mail"),
    fPhone:   tri("Téléphone (optionnel)", "Phone (optional)", "Telefon (optional)"),
    fMessage: tri("Votre besoin", "What you need", "Ihr Anliegen"),
    fMessagePh: tri("Ex. : préparer 15 commerciaux à traiter en allemand d'ici septembre.", "E.g. get 15 salespeople ready to deal in German by September.", "Z. B. 15 Vertriebler bis September fit für Deutsch im Kundengespräch machen."),
    audienceLabel: tri("Vous êtes", "You are", "Sie sind"),
    audBusiness:   tri("Une entreprise", "A business", "Ein Unternehmen"),
    audIndividual: tri("Un particulier", "An individual", "Eine Privatperson"),
    submit:   tri("Envoyer", "Send", "Senden"),
    sending:  tri("Envoi…", "Sending…", "Wird gesendet…"),
    okTitle:  tri("Message reçu.", "Message received.", "Nachricht erhalten."),
    okBody:   tri("Merci — on revient vers vous très vite.", "Thank you — we'll get back to you very soon.", "Danke — wir melden uns sehr bald bei Ihnen."),
    errMsg:   tri("Échec de l'envoi. Réessayez ou écrivez-nous directement.", "Sending failed. Try again or email us directly.", "Senden fehlgeschlagen. Bitte erneut versuchen oder direkt schreiben."),
    errValidation: tri("Veuillez remplir le nom, l'e-mail et le message.", "Please fill in name, email and message.", "Bitte Name, E-Mail und Nachricht ausfüllen."),
  },
};
