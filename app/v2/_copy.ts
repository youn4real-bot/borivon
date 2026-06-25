/**
 * Trilingual copy for the /v2 marketing site (FR · EN · DE).
 *
 * Voice: premium, minimal, OUTCOME-only. No level jargon (A1/A2/B1/B2).
 * ENTERPRISE-FIRST — German for the German labour market, made operational.
 * The hybrid delivery model (En ligne · Vor Ort · Hybride) is the centerpiece;
 * it solves Germany's Fachkräftemangel + integration problem.
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

export const COPY = {
  // ── Chrome ──────────────────────────────────────────────────────────────
  nav: {
    business:    tri("Entreprises", "For business", "Für Unternehmen"),
    model:       tri("Le modèle", "The model", "Das Modell"),
    individuals: tri("Particuliers", "Individuals", "Privatpersonen"),
    about:       tri("À propos", "About", "Über uns"),
    contact:     tri("Parler à un expert", "Talk to an expert", "Beratung anfragen"),
    menu:        tri("Menu", "Menu", "Menü"),
  },
  footer: {
    tagline: tri(
      "L'allemand qui prépare vos talents au marché allemand.",
      "German that gets your talent ready for the German market.",
      "Deutsch, das Ihre Talente fit für den deutschen Markt macht.",
    ),
    colSite:    tri("Site", "Site", "Seite"),
    colCompany: tri("Entreprise", "Company", "Unternehmen"),
    login:      tri("Espace client", "Client portal", "Kundenbereich"),
    rights:     tri("Tous droits réservés.", "All rights reserved.", "Alle Rechte vorbehalten."),
    addr1:      tri("77 Boulevard Mohamed Smiha", "77 Boulevard Mohamed Smiha", "77 Boulevard Mohamed Smiha"),
    addr2:      tri("20080 Casablanca, Maroc", "20080 Casablanca, Morocco", "20080 Casablanca, Marokko"),
    institut:   tri("Institut de langue allemande", "German-language institute", "Institut für deutsche Sprache"),
  },

  // ── Home ────────────────────────────────────────────────────────────────
  home: {
    heroEyebrow: tri("L'allemand pour le marché du travail allemand", "German for the German labour market", "Deutsch für den deutschen Arbeitsmarkt"),
    // heroTitle is split for the word-by-word reveal; last word is the accent.
    heroTitle:   tri("Vos talents, opérationnels en", "Your talent, operational in", "Ihre Talente, einsatzbereit auf"),
    heroAccent:  tri("allemand.", "German.", "Deutsch."),
    heroSub:     tri(
      "Un modèle hybride — en ligne et vor Ort — qui prépare vos collaborateurs internationaux au marché allemand. Plus vite, et pour de bon.",
      "A hybrid model — online and vor Ort — that gets your international staff ready for the German market. Faster, and for good.",
      "Ein hybrides Modell — online und vor Ort — das Ihre internationalen Mitarbeitenden fit für den deutschen Markt macht. Schneller, und nachhaltig.",
    ),
    heroCta1:    tri("Parler à un expert", "Talk to an expert", "Beratung anfragen"),
    heroCta2:    tri("Découvrir le modèle", "See the model", "Das Modell ansehen"),
    chip1:       tri("En ligne & vor Ort", "Online & vor Ort", "Online & vor Ort"),
    chip2:       tri("Sans jargon ni niveaux", "No jargon, no levels", "Ohne Fachjargon, ohne Niveaustufen"),
    chip3:       tri("Orienté résultats", "Results-driven", "Ergebnisorientiert"),

    problemEyebrow: tri("Le défi allemand", "The German challenge", "Die deutsche Herausforderung"),
    problemTitle:   tri("L'Allemagne a besoin de talents.", "Germany needs talent.", "Deutschland braucht Talente."),
    problemAccent:  tri("Vos talents ont besoin d'allemand.", "Your talent needs German.", "Ihre Talente brauchen Deutsch."),
    problemSub:     tri(
      "La pénurie de main-d'œuvre freine les entreprises allemandes. Le vrai obstacle n'est pas de recruter — c'est la langue.",
      "The labour shortage is holding German companies back. The real bottleneck isn't hiring — it's the language.",
      "Der Fachkräftemangel bremst deutsche Unternehmen. Der eigentliche Engpass ist nicht das Einstellen — es ist die Sprache.",
    ),
    problem1Title: tri("Le talent n'est pas le frein.", "Talent isn't the blocker.", "Talent ist nicht das Problem."),
    problem1Body:  tri("La langue l'est. Sans allemand, même les meilleurs profils restent bloqués.", "Language is. Without German, even the best profiles stay stuck.", "Die Sprache ist es. Ohne Deutsch bleiben selbst die besten Profile blockiert."),
    problem2Title: tri("L'intégration qui traîne coûte cher.", "Slow integration is expensive.", "Schleppende Integration kostet."),
    problem2Body:  tri("Chaque mois sans allemand opérationnel, c'est de la productivité — et des talents — perdus.", "Every month without operational German is lost productivity — and lost talent.", "Jeder Monat ohne einsatzbereites Deutsch bedeutet verlorene Produktivität — und verlorene Talente."),
    problem3Title: tri("La reconnaissance exige l'allemand.", "Recognition requires German.", "Die Anerkennung verlangt Deutsch."),
    problem3Body:  tri("Pas d'Anerkennung, pas de poste qualifié. La langue est la clé du dossier.", "No Anerkennung, no qualified role. Language is the key to the file.", "Keine Anerkennung, keine Fachstelle. Die Sprache ist der Schlüssel zum Verfahren."),

    modelEyebrow: tri("Notre modèle", "Our model", "Unser Modell"),
    modelTitle:   tri("En ligne. Vor Ort.", "Online. Vor Ort.", "Online. Vor Ort."),
    modelAccent:  tri("Hybride.", "Hybrid.", "Hybrid."),
    modelSub:     tri(
      "Un seul objectif — l'allemand opérationnel — par le chemin qui convient à vos équipes. Choisissez. Ou combinez.",
      "One goal — operational German — via the path that fits your teams. Pick one. Or combine.",
      "Ein Ziel — einsatzbereites Deutsch — auf dem Weg, der zu Ihren Teams passt. Wählen Sie. Oder kombinieren Sie.",
    ),
    modeOnlineTag:  tri("En ligne", "Online", "Online"),
    modeOnlineH:    tri("Flexible, partout.", "Flexible, anywhere.", "Flexibel, überall."),
    modeOnlineB:    tri("Vos collaborateurs apprennent sans quitter leur poste, à leur rythme — avec un accompagnement humain, jamais une vidéo de plus.", "Your people learn without leaving their jobs, at their own pace — with real human guidance, never just another video.", "Ihre Mitarbeitenden lernen ohne ihren Arbeitsplatz zu verlassen, im eigenen Tempo — mit echter menschlicher Begleitung, nie nur ein weiteres Video."),
    modeHybridTag:  tri("Hybride", "Hybrid", "Hybrid"),
    modeHybridH:    tri("Le meilleur des deux.", "The best of both.", "Das Beste aus beidem."),
    modeHybridB:    tri("La flexibilité de l'en ligne, l'ancrage du présentiel. Le modèle qui fait tenir l'allemand dans la durée — et passer à l'action.", "The flexibility of online, the staying power of in-person. The model that makes German stick — and turns it into action.", "Die Flexibilität von Online, die Verankerung des Präsenzunterrichts. Das Modell, das Deutsch nachhaltig sitzen lässt — und ins Handeln bringt."),
    modeVorOrtTag:  tri("Vor Ort", "Vor Ort", "Vor Ort"),
    modeVorOrtH:    tri("L'immersion qui ancre.", "Immersion that sticks.", "Immersion, die verankert."),
    modeVorOrtB:    tri("En présentiel, sur place. L'allemand qui s'installe par la pratique, le contact réel et le terrain — pas par cœur.", "In person, on location. German that settles in through practice, real contact and the field — not rote learning.", "In Präsenz, vor Ort. Deutsch, das sich durch Praxis, echten Kontakt und Alltag festigt — nicht durch Auswendiglernen."),
    modelGloss:     tri(
      "Vor Ort = sur place, en présentiel. Le mot que les Allemands emploient pour « là où ça se passe vraiment ».",
      "Vor Ort = on location, in person. The word Germans use for “where it actually happens.”",
      "Vor Ort = in Präsenz, am Geschehen. Genau dort, wo es wirklich passiert.",
    ),

    journeyEyebrow: tri("La progression", "The journey", "Der Weg"),
    journeyTitle:   tri("De zéro à", "From zero to", "Von null auf"),
    journeyAccent:  tri("opérationnel.", "operational.", "einsatzbereit."),
    journeySub:     tri("Sans jargon, sans niveaux qui font peur — juste des étapes claires vers un objectif clair.", "No jargon, no scary levels — just clear steps toward a clear goal.", "Ohne Fachjargon, ohne abschreckende Niveaustufen — nur klare Schritte zu einem klaren Ziel."),
    step1: tri("Les premiers mots, en confiance", "First words, with confidence", "Erste Worte, mit Sicherheit"),
    step2: tri("Une vraie conversation, au travail", "A real conversation, at work", "Ein echtes Gespräch, bei der Arbeit"),
    step3: tri("Le métier géré en allemand", "The job handled in German", "Der Beruf auf Deutsch gemeistert"),
    step4: tri("Opérationnel sur le marché allemand", "Operational on the German market", "Einsatzbereit auf dem deutschen Markt"),

    trustA_h: tri("Institut dédié", "A dedicated institute", "Ein eigenes Institut"),
    trustA_b: tri("Une école d'allemand à Casablanca, tournée vers l'Allemagne.", "A German-language school in Casablanca, built toward Germany.", "Eine Deutschsprachschule in Casablanca, ausgerichtet auf Deutschland."),
    trustB_h: tri("Méthode orientée résultats", "Results-driven method", "Ergebnisorientierte Methode"),
    trustB_b: tri("On vise l'allemand qui travaille, pas les diplômes pour la vitrine.", "We aim for German that works, not certificates for show.", "Wir zielen auf Deutsch, das funktioniert — nicht auf Zertifikate fürs Schaufenster."),
    trustC_h: tri("Accompagnement de bout en bout", "End-to-end support", "Begleitung von A bis Z"),
    trustC_b: tri("De la langue jusqu'à l'intégration — un humain à chaque étape.", "From the language to integration — a human at every step.", "Von der Sprache bis zur Integration — ein Mensch bei jedem Schritt."),

    finalTitle:  tri("Préparez vos talents au", "Get your talent ready for the", "Machen Sie Ihre Talente fit für den"),
    finalAccent: tri("marché allemand.", "German market.", "deutschen Markt."),
    finalSub:    tri("Parlons de vos équipes. On construit le parcours — en ligne, vor Ort, ou les deux.", "Let's talk about your teams. We'll build the path — online, vor Ort, or both.", "Sprechen wir über Ihre Teams. Wir bauen den Weg — online, vor Ort, oder beides."),
  },

  // ── Audience point lists (shared on home + dedicated pages) ───────────────
  ent: {
    eyebrow: tri("Pour les entreprises", "For business", "Für Unternehmen"),
    title:   tri("L'allemand qui fait avancer", "German that moves", "Deutsch, das voranbringt:"),
    accent:  tri("vos équipes.", "your teams.", "Ihre Teams."),
    body:    tri(
      "Vos collaborateurs internationaux opérationnels en allemand — plus vite. Une intégration qui ne traîne plus, des dossiers de reconnaissance qui avancent, des équipes qui restent.",
      "Your international staff operational in German — faster. Integration that no longer drags, recognition files that move forward, teams that stay.",
      "Ihre internationalen Mitarbeitenden einsatzbereit auf Deutsch — schneller. Integration, die nicht mehr stockt, Anerkennungsverfahren, die vorankommen, Teams, die bleiben.",
    ),
    cta:  tri("Parler à un expert", "Talk to an expert", "Beratung anfragen"),
    p1:   tri("Des collaborateurs opérationnels, plus vite", "Staff operational, faster", "Mitarbeitende schneller einsatzbereit"),
    p2:   tri("Une intégration qui ne traîne plus", "Integration that no longer drags", "Integration, die nicht mehr stockt"),
    p3:   tri("La reconnaissance des diplômes débloquée (Anerkennung)", "Qualification recognition unblocked (Anerkennung)", "Anerkennung der Abschlüsse freigeschaltet"),
    p4:   tri("Des équipes qui restent — et montent en compétence", "Teams that stay — and grow", "Teams, die bleiben — und sich weiterentwickeln"),
  },
  ind: {
    eyebrow: tri("Pour les particuliers", "For individuals", "Für Privatpersonen"),
    title:   tri("L'allemand simplifié pour", "German made simple for", "Deutsch, einfach gemacht für"),
    accent:  tri("votre carrière.", "your career.", "Ihre Karriere."),
    body:    tri(
      "Décrochez le poste, l'Ausbildung ou les études que vous visez en Allemagne. Une méthode claire qui vous fait progresser vite — sans vous noyer, sans jargon.",
      "Land the job, Ausbildung or studies you're aiming for in Germany. A clear method that moves you forward fast — without drowning you, without jargon.",
      "Sichern Sie sich den Job, die Ausbildung oder das Studium, das Sie in Deutschland anstreben. Eine klare Methode, die Sie schnell voranbringt — ohne Überforderung, ohne Fachjargon.",
    ),
    cta:  tri("Booster ma carrière", "Boost my career", "Karriere starten"),
    p1:   tri("Décrochez un emploi qualifié en Allemagne", "Land a qualified job in Germany", "Sichern Sie sich einen Fachjob in Deutschland"),
    p2:   tri("Accédez à l'Ausbildung ou aux études", "Access an Ausbildung or studies", "Zugang zu Ausbildung oder Studium"),
    p3:   tri("Parlez avec confiance, plus vite que prévu", "Speak with confidence, sooner than you think", "Sprechen Sie sicher, schneller als gedacht"),
    p4:   tri("Accompagné jusqu'à votre objectif", "Supported all the way to your goal", "Begleitet bis zu Ihrem Ziel"),
  },

  // ── /solutions (enterprise deep-dive) ─────────────────────────────────────
  solutions: {
    eyebrow:  tri("Solutions entreprise", "Business solutions", "Lösungen für Unternehmen"),
    title:    tri("Une seule barrière entre vos talents et le terrain :", "One barrier stands between your talent and the floor:", "Eine Hürde steht zwischen Ihren Talenten und dem Einsatz:"),
    accent:   tri("la langue.", "language.", "die Sprache."),
    sub:      tri("On la lève — avec un modèle hybride conçu pour le marché du travail allemand.", "We remove it — with a hybrid model built for the German labour market.", "Wir nehmen sie weg — mit einem hybriden Modell für den deutschen Arbeitsmarkt."),
    cta:      tri("Parler à un expert", "Talk to an expert", "Beratung anfragen"),

    forEyebrow: tri("Pour qui", "Who it's for", "Für wen"),
    forTitle:   tri("Conçu pour ceux qui amènent des talents en Allemagne.", "Built for those who bring talent to Germany.", "Gemacht für alle, die Talente nach Deutschland bringen."),
    seg1H: tri("Employeurs directs", "Direct employers", "Direkte Arbeitgeber"),
    seg1B: tri("Cliniques, services de soins (Pflege), entreprises qui recrutent à l'international et veulent des équipes opérationnelles vite.", "Clinics, care services (Pflege), companies that hire internationally and want teams operational fast.", "Kliniken, Pflegedienste, Unternehmen, die international rekrutieren und schnell einsatzbereite Teams wollen."),
    seg2H: tri("Agences & recruteurs", "Agencies & recruiters", "Agenturen & Vermittler"),
    seg2B: tri("Vous placez des talents en Allemagne. On garantit la langue — votre pipeline avance sans blocage linguistique.", "You place talent in Germany. We secure the language — your pipeline moves without a language bottleneck.", "Sie vermitteln Talente nach Deutschland. Wir sichern die Sprache — Ihre Pipeline läuft ohne Sprachbarriere."),
    seg3H: tri("Équipes en place", "Existing teams", "Bestehende Teams"),
    seg3B: tri("Vos collaborateurs internationaux déjà en poste montent en allemand — sans quitter le terrain.", "Your international staff already on the job level up their German — without leaving the floor.", "Ihre bereits beschäftigten internationalen Mitarbeitenden verbessern ihr Deutsch — ohne den Arbeitsplatz zu verlassen."),

    outEyebrow: tri("Ce que vous y gagnez", "What you gain", "Ihr Gewinn"),
    outTitle:   tri("Des résultats que vous mesurez.", "Results you can measure.", "Ergebnisse, die Sie messen."),
    out1H: tri("Opérationnels plus vite", "Operational faster", "Schneller einsatzbereit"),
    out1B: tri("Vos talents passent à l'action en allemand au lieu d'attendre.", "Your talent gets into action in German instead of waiting.", "Ihre Talente kommen auf Deutsch ins Tun, statt zu warten."),
    out2H: tri("Anerkennung débloquée", "Anerkennung unblocked", "Anerkennung freigeschaltet"),
    out2B: tri("La langue requise pour la reconnaissance des diplômes, sécurisée.", "The German required for qualification recognition, secured.", "Das für die Anerkennung nötige Deutsch — gesichert."),
    out3H: tri("Rétention en hausse", "Higher retention", "Höhere Bindung"),
    out3B: tri("Des équipes qui s'intègrent restent. La langue, c'est l'appartenance.", "Teams that integrate stay. Language is belonging.", "Teams, die sich integrieren, bleiben. Sprache schafft Zugehörigkeit."),
    out4H: tri("Un seul interlocuteur", "One single partner", "Ein einziger Ansprechpartner"),
    out4B: tri("De la langue à l'intégration — un parcours, un partenaire.", "From language to integration — one path, one partner.", "Von der Sprache bis zur Integration — ein Weg, ein Partner."),
  },

  // ── /methode (the hybrid model) ───────────────────────────────────────────
  methode: {
    eyebrow: tri("Le modèle", "The model", "Das Modell"),
    title:   tri("Hybride par conception.", "Hybrid by design.", "Hybrid by Design."),
    accent:  tri("Efficace par nature.", "Effective by nature.", "Wirksam von Natur aus."),
    sub:     tri("En ligne pour la flexibilité. Vor Ort pour l'ancrage. Ensemble, l'allemand qui tient.", "Online for flexibility. Vor Ort to make it stick. Together, German that lasts.", "Online für Flexibilität. Vor Ort für Verankerung. Zusammen: Deutsch, das bleibt."),
    cta:     tri("Parler à un expert", "Talk to an expert", "Beratung anfragen"),

    pEyebrow: tri("Les principes", "The principles", "Die Prinzipien"),
    pTitle:   tri("Ce qui rend l'allemand opérationnel.", "What makes German operational.", "Was Deutsch einsatzbereit macht."),
    pr1H: tri("L'objectif, pas le niveau", "The goal, not the level", "Das Ziel, nicht die Stufe"),
    pr1B: tri("On part de votre objectif réel — pas d'une échelle abstraite de niveaux.", "We start from your real goal — not an abstract scale of levels.", "Wir starten von Ihrem echten Ziel — nicht von einer abstrakten Niveauskala."),
    pr2H: tri("La pratique d'abord", "Practice first", "Praxis zuerst"),
    pr2B: tri("L'allemand du métier, du quotidien, du terrain — pas la grammaire pour la grammaire.", "The German of the job, daily life, the field — not grammar for grammar's sake.", "Das Deutsch des Berufs, des Alltags, der Praxis — nicht Grammatik um der Grammatik willen."),
    pr3H: tri("Un humain à chaque étape", "A human at every step", "Ein Mensch bei jedem Schritt"),
    pr3B: tri("Des formateurs qui suivent, corrigent, encouragent — jamais une plateforme seule.", "Trainers who follow, correct, encourage — never a platform alone.", "Trainer, die begleiten, korrigieren, motivieren — nie nur eine Plattform."),
    pr4H: tri("La langue jusqu'à l'intégration", "Language through to integration", "Sprache bis zur Integration"),
    pr4B: tri("On ne s'arrête pas au cours : on accompagne jusqu'au terrain allemand.", "We don't stop at the course: we support all the way to the German floor.", "Wir hören nicht beim Kurs auf: Wir begleiten bis in den deutschen Arbeitsalltag."),
  },

  // ── /a-propos (about) ─────────────────────────────────────────────────────
  about: {
    eyebrow: tri("À propos", "About", "Über uns"),
    title:   tri("Une mission simple :", "A simple mission:", "Eine einfache Mission:"),
    accent:  tri("l'allemand qui ouvre l'Allemagne.", "German that opens Germany.", "Deutsch, das Deutschland öffnet."),
    sub:     tri("Borivon est un institut de langue allemande à Casablanca, tourné vers le marché du travail allemand.", "Borivon is a German-language institute in Casablanca, focused on the German labour market.", "Borivon ist ein Institut für deutsche Sprache in Casablanca, ausgerichtet auf den deutschen Arbeitsmarkt."),

    storyEyebrow: tri("Pourquoi Borivon", "Why Borivon", "Warum Borivon"),
    storyTitle:   tri("Né d'un constat, construit pour le résoudre.", "Born from a problem, built to solve it.", "Aus einem Problem entstanden, gebaut, um es zu lösen."),
    storyP1: tri(
      "D'un côté, l'Allemagne manque de talents. De l'autre, des talents prêts à partir — bloqués par une seule chose : la langue.",
      "On one side, Germany lacks talent. On the other, talent ready to go — blocked by one thing: the language.",
      "Auf der einen Seite fehlen Deutschland Talente. Auf der anderen Seite stehen einsatzbereite Talente — gestoppt von nur einer Sache: der Sprache.",
    ),
    storyP2: tri(
      "Nous avons construit un modèle qui lève cette barrière — hybride, humain, orienté résultats. Pas des niveaux pour la vitrine, mais l'allemand qui fait travailler, intégrer, réussir.",
      "We built a model that removes that barrier — hybrid, human, results-driven. Not levels for show, but German that lets you work, integrate, succeed.",
      "Wir haben ein Modell gebaut, das diese Hürde beseitigt — hybrid, menschlich, ergebnisorientiert. Keine Niveaustufen fürs Schaufenster, sondern Deutsch, das arbeiten, integrieren, gelingen lässt.",
    ),
    v1H: tri("Le résultat avant tout", "Results above all", "Ergebnis über allem"),
    v1B: tri("On mesure le succès à votre réussite, pas à un certificat.", "We measure success by your outcome, not a certificate.", "Wir messen Erfolg an Ihrem Ergebnis, nicht an einem Zertifikat."),
    v2H: tri("L'humain au centre", "People at the center", "Der Mensch im Mittelpunkt"),
    v2B: tri("Une langue s'apprend avec des gens, pas seulement des écrans.", "A language is learned with people, not just screens.", "Eine Sprache lernt man mit Menschen, nicht nur mit Bildschirmen."),
    v3H: tri("Clair, sans jargon", "Clear, no jargon", "Klar, ohne Fachjargon"),
    v3B: tri("Pas de niveaux qui font peur. Des étapes que tout le monde comprend.", "No scary levels. Steps everyone understands.", "Keine abschreckenden Niveaustufen. Schritte, die jeder versteht."),
  },

  // ── /contact ──────────────────────────────────────────────────────────────
  contact: {
    eyebrow: tri("Parler à un expert", "Talk to an expert", "Beratung anfragen"),
    title:   tri("Parlons de vos talents.", "Let's talk about your talent.", "Sprechen wir über Ihre Talente."),
    sub:     tri(
      "Dites-nous où vous en êtes — on revient vers vous avec un parcours concret : en ligne, vor Ort, ou les deux.",
      "Tell us where you stand — we'll come back with a concrete path: online, vor Ort, or both.",
      "Sagen Sie uns, wo Sie stehen — wir melden uns mit einem konkreten Weg: online, vor Ort, oder beides.",
    ),
    fName:    tri("Nom complet", "Full name", "Vollständiger Name"),
    fCompany: tri("Entreprise (optionnel)", "Company (optional)", "Unternehmen (optional)"),
    fEmail:   tri("E-mail professionnel", "Work email", "Geschäftliche E-Mail"),
    fPhone:   tri("Téléphone (optionnel)", "Phone (optional)", "Telefon (optional)"),
    fMessage: tri("Votre besoin", "What you need", "Ihr Anliegen"),
    fMessagePh: tri("Ex. : 12 infirmiers à préparer pour l'Allemagne d'ici l'été.", "E.g. 12 nurses to prepare for Germany by summer.", "Z. B. 12 Pflegekräfte bis zum Sommer für Deutschland vorbereiten."),
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
