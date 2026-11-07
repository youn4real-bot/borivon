/**
 * The privacy policy text, shared by /privacy-policy (all languages, follows the
 * site language) and /datenschutz (always German; founder 2026-11-07: German
 * visitors and every link from /fahrplan go there). One source, so the two
 * pages can never say different things.
 */
export type PrivacyLang = "fr" | "en" | "de";

const UPDATED: Record<PrivacyLang, string> = { fr: "7 novembre 2026", en: "7 November 2026", de: "7. November 2026" };

export const PRIVACY: Record<PrivacyLang, { title: string; subtitle: string; updated: string; intro: string; sections: { heading: string; body: string }[] }> = {
  fr: {
    title: "Politique de Confidentialité",
    subtitle: "Borivon.com",
    updated: `Dernière mise à jour : ${UPDATED.fr}`,
    intro: "La présente Politique de Confidentialité décrit comment Borivon.com collecte, utilise, conserve et protège vos données personnelles conformément au Règlement Général sur la Protection des Données (RGPD — UE 2016/679) et aux lois applicables.",
    sections: [
      {
        heading: "1. Responsable du traitement",
        body: `Borivon est une plateforme internationale exploitée par Borivon LLC, société à responsabilité limitée enregistrée dans l'État du Wyoming, États-Unis d'Amérique. Borivon LLC est l'unique responsable du traitement de toutes les données personnelles traitées via cette plateforme.\nAdresse : Borivon LLC, 30 N Gould St Ste R, Sheridan, WY 82801, États-Unis\nE-mail : contact@borivon.com\nTéléphone : +49 157 315 047 59`,
      },
      {
        heading: "2. Données collectées",
        body: `Nous collectons des données personnelles et professionnelles auprès de tous les utilisateurs, incluant notamment : nom complet, date de naissance, nationalité, adresse e-mail, numéro de téléphone et documents d'identité délivrés par les autorités compétentes. Les candidats peuvent également soumettre des CV, diplômes et documents liés à leur visa. Des informations de paiement peuvent être collectées pour le traitement des transactions. Nous collectons également automatiquement des données telles que : adresse IP, type d'appareil, navigateur et pages visitées.`,
      },
      {
        heading: "3. Finalités et bases légales du traitement",
        body: `Vos données sont traitées pour les finalités et sur les bases légales suivantes :\n\n• Fourniture et gestion des services (exécution du contrat) : traitement de vos demandes de cours, gestion de votre compte Portail, suivi de votre candidature.\n• Amélioration de nos services (intérêt légitime) : analyse anonymisée du trafic et comportement sur le site.\n• Communication (intérêt légitime / consentement) : réponse à vos demandes, envoi d'informations relatives à votre dossier.\n• Conformité légale (obligation légale) : conservation des données requises par la réglementation applicable.\n• Marketing et publicité (consentement) : uniquement si vous y avez expressément consenti via notre outil de gestion des cookies.`,
      },
      {
        heading: "4. Partage des données",
        body: `Borivon.com ne vend ni ne loue vos données personnelles à des tiers.\n\nVos données peuvent être partagées uniquement avec :\n\n• Prestataires techniques mandatés (hébergement : Vercel, base de données : Supabase, stockage : Google Drive) opérant sous des contrats conformes au RGPD.\n• Agents partenaires recruteurs expressément autorisés par Borivon.com, dans le strict cadre de l'évaluation de votre candidature, et liés par des obligations de confidentialité.\n• Autorités compétentes, lorsque la loi l'exige expressément.\n\nTout transfert de données hors de l'Espace Économique Européen est encadré par des garanties appropriées (clauses contractuelles types, décisions d'adéquation).`,
      },
      {
        heading: "5. Durée de conservation",
        body: `• Données de compte et dossiers candidats : conservées pendant la durée active de votre compte, puis pendant 24 mois à compter de votre dernière activité, sauf obligation légale contraire.\n• Données de contact (formulaire) : conservées pendant 12 mois.\n• Données analytiques : conservées sous forme agrégée et anonymisée sans limite de durée.\n• Logs de sécurité : conservés pendant 12 mois.\n\nÀ l'expiration de ces durées, vos données sont supprimées ou anonymisées de manière sécurisée.`,
      },
      {
        heading: "6. Sécurité des données",
        body: `Nous mettons en œuvre des mesures techniques et organisationnelles appropriées pour protéger vos données :\n\n• Chiffrement des transmissions (HTTPS/TLS).\n• Stockage des mots de passe par hachage cryptographique (bcrypt).\n• Contrôle d'accès strict avec authentification forte.\n• Hébergement sur des infrastructures certifiées (Vercel, Supabase).\n• Revues de sécurité régulières.\n\nEn cas de violation de données susceptible d'engendrer un risque pour vos droits et libertés, nous vous notifierons dans les délais légaux requis.`,
      },
      {
        heading: "7. Vos droits",
        body: `En vertu du RGPD et des lois applicables, vous disposez des droits suivants :\n\n• Droit d'accès : obtenir une copie de vos données personnelles.\n• Droit de rectification : faire corriger des données inexactes ou incomplètes.\n• Droit à l'effacement : demander la suppression de vos données (« droit à l'oubli »).\n• Droit à la portabilité : recevoir vos données dans un format structuré, couramment utilisé et lisible par machine.\n• Droit d'opposition : vous opposer au traitement fondé sur notre intérêt légitime.\n• Droit à la limitation : demander la suspension temporaire du traitement.\n• Droit de retrait du consentement : retirer à tout moment votre consentement aux traitements fondés sur celui-ci (sans remettre en cause la licéité des traitements antérieurs).\n\nPour exercer vos droits : contact@borivon.com. Nous répondons dans un délai de 30 jours.`,
      },
      {
        heading: "8. Cookies et traceurs",
        body: `Nous utilisons différentes catégories de cookies :\n\n• Cookies essentiels : nécessaires au fonctionnement du site, toujours actifs.\n• Cookies analytiques : collectent des données agrégées sur l'utilisation du site (avec votre consentement).\n• Cookies publicitaires : permettent de personnaliser les annonces et de mesurer leur efficacité, notamment via le Meta Pixel (avec votre consentement).\n\nVous pouvez gérer vos préférences à tout moment via le lien « Paramètres des cookies » en bas de page.`,
      },
      {
        heading: "9. Modifications de la politique",
        body: `Nous nous réservons le droit de modifier cette politique à tout moment. La version mise à jour est publiée sur cette page avec une nouvelle date de révision. En cas de modifications substantielles, nous vous en informerons par e-mail ou par un avis visible sur le site.`,
      },
      {
        heading: "10. Contact et réclamations",
        body: `Pour toute question ou pour exercer vos droits :\nE-mail : contact@borivon.com\n\nSi vous estimez que vos droits ne sont pas respectés, vous avez le droit d'introduire une réclamation auprès de l'autorité de protection des données compétente dans votre pays de résidence.`,
      },
      {
        heading: "11. Plan infirmier gratuit (borivon.com/fahrplan)",
        body: `Lorsque vous demandez le plan infirmier gratuit pour votre établissement, nous traitons : civilité, nom, nom de l'établissement, adresse e-mail professionnelle et vos réponses dans le formulaire (personnel, postes vacants, départs, intérim, intégration et comment vous nous avez connus).\n\nFinalité : nous créons votre plan personnel en PDF et vous l'envoyons par e-mail. Nous vous envoyons aussi par e-mail des conseils et des offres de Borivon.\n\nBase légale : votre consentement (art. 6, par. 1, point a du RGPD), donné en cochant la case du formulaire. Nous utilisons le double opt-in : après l'envoi du formulaire, vous recevez un e-mail avec un lien de confirmation. Ce n'est qu'après votre clic que nous envoyons le plan et d'autres e-mails. Pour prouver votre consentement, nous enregistrons la date et l'heure, le texte de la case et votre adresse IP lors de l'envoi et de la confirmation (art. 6, par. 1, point c du RGPD en lien avec l'art. 7, par. 1 du RGPD). Sans ces données et sans la case cochée, nous ne pouvons pas vous envoyer le plan.\n\nDésinscription : chaque e-mail contient un lien de désinscription. Vous pouvez retirer votre consentement à tout moment, par ce lien ou à contact@borivon.com. Le retrait vaut pour l'avenir.\n\nDestinataires : Cloudflare (hébergement et base de données) et Resend (envoi des e-mails et liste de contacts). Tous deux traitent les données pour notre compte (art. 28 du RGPD). Pour les transferts hors de l'EEE, voir la section 4.\n\nDurée de conservation : si vous ne cliquez pas sur le lien de confirmation, nous supprimons vos données après 30 jours. Sinon, nous les conservons 12 mois après votre dernière activité (comme les données de contact, section 5). Après une désinscription, nous ne vous écrivons plus ; la preuve de votre consentement et de votre désinscription est conservée jusqu'à la fin de ce délai. Vous pouvez demander l'effacement à tout moment à contact@borivon.com. Ensuite, seuls des chiffres anonymes restent pour nos statistiques.`,
      },
    ],
  },
  en: {
    title: "Privacy Policy",
    subtitle: "Borivon.com",
    updated: `Last updated: ${UPDATED.en}`,
    intro: "This Privacy Policy describes how Borivon.com collects, uses, stores, and protects your personal data in compliance with the General Data Protection Regulation (GDPR — EU 2016/679) and applicable laws.",
    sections: [
      {
        heading: "1. Data Controller",
        body: `Borivon is an international platform operated by Borivon LLC, a limited liability company registered in the State of Wyoming, United States of America. Borivon LLC is the sole data controller for all personal data processed through this platform.\nAddress: Borivon LLC, 30 N Gould St Ste R, Sheridan, WY 82801, USA\nEmail: contact@borivon.com\nPhone: +49 157 315 047 59`,
      },
      {
        heading: "2. Data We Collect",
        body: `We collect personal and professional data from all users, including but not limited to: full name, date of birth, nationality, email address, phone number, and government-issued identification documents. Candidates may also submit CVs, educational certificates, and visa-related documents. Payment information may be collected to process transactions. We also collect data automatically including but not limited to IP address, device type, browser, and pages visited.`,
      },
      {
        heading: "3. Purposes and Legal Bases for Processing",
        body: `Your data is processed for the following purposes and on the following legal bases:\n\n• Service provision and management (contract performance): processing your course enquiries, managing your Portal account, tracking your application.\n• Service improvement (legitimate interest): anonymised analysis of site traffic and behaviour.\n• Communication (legitimate interest / consent): responding to enquiries, sending information about your application.\n• Legal compliance (legal obligation): retaining data as required by applicable regulations.\n• Marketing and advertising (consent): only if you have expressly consented via our cookie management tool.`,
      },
      {
        heading: "4. Data Sharing",
        body: `Borivon.com does not sell or rent your personal data to third parties.\n\nYour data may only be shared with:\n\n• Mandated technical providers (hosting: Vercel, database: Supabase, storage: Google Drive) operating under GDPR-compliant contracts.\n• Partner recruitment agents expressly authorised by Borivon.com, strictly for the purpose of evaluating your application, and bound by confidentiality obligations.\n• Competent authorities, where expressly required by law.\n\nAny transfer of data outside the European Economic Area is governed by appropriate safeguards (standard contractual clauses, adequacy decisions).`,
      },
      {
        heading: "5. Retention Periods",
        body: `• Account data and candidate files: retained for the active lifetime of your account, then for 24 months from your last activity, unless a legal obligation requires otherwise.\n• Contact form data: retained for 12 months.\n• Analytics data: retained in aggregated, anonymised form indefinitely.\n• Security logs: retained for 12 months.\n\nUpon expiry of these periods, your data is securely deleted or anonymised.`,
      },
      {
        heading: "6. Data Security",
        body: `We implement appropriate technical and organisational measures to protect your data:\n\n• Encrypted transmissions (HTTPS/TLS).\n• Password storage via cryptographic hashing (bcrypt).\n• Strict access controls with strong authentication.\n• Hosting on certified infrastructures (Vercel, Supabase).\n• Regular security reviews.\n\nIn the event of a data breach likely to result in a risk to your rights and freedoms, we will notify you within the legally required timeframe.`,
      },
      {
        heading: "7. Your Rights",
        body: `Under the GDPR and applicable laws, you have the following rights:\n\n• Right of access: obtain a copy of your personal data.\n• Right to rectification: have inaccurate or incomplete data corrected.\n• Right to erasure: request deletion of your data ("right to be forgotten").\n• Right to portability: receive your data in a structured, commonly used, machine-readable format.\n• Right to object: object to processing based on our legitimate interest.\n• Right to restriction: request temporary suspension of processing.\n• Right to withdraw consent: withdraw your consent at any time for consent-based processing (without affecting the lawfulness of prior processing).\n\nTo exercise your rights: contact@borivon.com. We respond within 30 days.`,
      },
      {
        heading: "8. Cookies and Trackers",
        body: `We use different categories of cookies:\n\n• Essential cookies: required for the site to function, always active.\n• Analytics cookies: collect aggregated data on site usage (with your consent).\n• Advertising cookies: allow personalisation of ads and measurement of their effectiveness, including via the Meta Pixel (with your consent).\n\nYou can manage your preferences at any time via the "Cookie Settings" link at the bottom of the page.`,
      },
      {
        heading: "9. Policy Changes",
        body: `We reserve the right to modify this policy at any time. The updated version is published on this page with a new revision date. In case of significant changes, we will inform you by email or through a visible notice on the site.`,
      },
      {
        heading: "10. Contact and Complaints",
        body: `For any questions or to exercise your rights:\nEmail: contact@borivon.com\n\nIf you believe your rights are not being respected, you have the right to lodge a complaint with the data protection authority in your country of residence.`,
      },
      {
        heading: "11. Free nurse staffing roadmap (borivon.com/fahrplan)",
        body: `When you request the free roadmap for your facility, we process: title, last name, name of the facility, business email address and your answers in the form (staff, open posts, resignations, agency staff, onboarding and how you heard about us).\n\nPurpose: we create your personal roadmap as a PDF and send it to you by email. We also send you tips and offers from Borivon by email.\n\nLegal basis: your consent (Art. 6(1)(a) GDPR), which you give by ticking the box in the form. We use double opt-in: after you send the form, you get an email with a confirmation link. Only after your click do we send the roadmap and further emails. As proof of your consent, we store the time, the text of the box and your IP address when you send the form and when you confirm (Art. 6(1)(c) in conjunction with Art. 7(1) GDPR). Without these details and the ticked box, we cannot send you the roadmap.\n\nUnsubscribe: every email contains an unsubscribe link. You can withdraw your consent at any time, by that link or at contact@borivon.com. The withdrawal applies to the future.\n\nRecipients: Cloudflare (hosting and database) and Resend (email delivery and contact list). Both process the data on our behalf (Art. 28 GDPR). For transfers outside the EEA, see section 4.\n\nRetention: if you do not click the confirmation link, we delete your details after 30 days. Otherwise we keep them for 12 months after your last activity (like contact form data, section 5). After you unsubscribe, we no longer write to you; the proof of your consent and of your unsubscribe is kept until the end of that period. You can ask us to delete your data at any time at contact@borivon.com. After that, only anonymous numbers remain for our statistics.`,
      },
    ],
  },
  de: {
    title: "Datenschutzerklärung",
    subtitle: "Borivon.com",
    updated: `Zuletzt aktualisiert: ${UPDATED.de}`,
    intro: "Diese Datenschutzerklärung beschreibt, wie Borivon.com Ihre personenbezogenen Daten gemäß der Datenschutz-Grundverordnung (DSGVO — EU 2016/679) und den anwendbaren Gesetzen erhebt, verwendet, speichert und schützt.",
    sections: [
      {
        heading: "1. Verantwortlicher",
        body: `Borivon ist eine internationale Plattform, betrieben von Borivon LLC, einer im Bundesstaat Wyoming, Vereinigte Staaten von Amerika, eingetragenen Gesellschaft mit beschränkter Haftung. Borivon LLC ist der alleinige Verantwortliche für alle über diese Plattform verarbeiteten personenbezogenen Daten.\nAnschrift: Borivon LLC, 30 N Gould St Ste R, Sheridan, WY 82801, USA\nE-Mail: contact@borivon.com\nTelefon: +49 157 315 047 59`,
      },
      {
        heading: "2. Erhobene Daten",
        body: `Wir erheben personenbezogene und berufliche Daten von allen Nutzern, einschließlich, aber nicht beschränkt auf: vollständiger Name, Geburtsdatum, Staatsangehörigkeit, E-Mail-Adresse, Telefonnummer und amtliche Ausweisdokumente. Kandidaten können außerdem Lebensläufe, Bildungsnachweise und visabezogene Dokumente einreichen. Zahlungsinformationen können zur Abwicklung von Transaktionen erhoben werden. Wir erheben auch automatisch Daten wie IP-Adresse, Gerätetyp, Browser und besuchte Seiten.`,
      },
      {
        heading: "3. Zwecke und Rechtsgrundlagen der Verarbeitung",
        body: `Ihre Daten werden für folgende Zwecke und auf folgenden Rechtsgrundlagen verarbeitet:\n\n• Erbringung und Verwaltung von Diensten (Vertragserfüllung): Bearbeitung Ihrer Kursanfragen, Verwaltung Ihres Portalkontos, Verfolgung Ihrer Bewerbung.\n• Serviceverbesserung (berechtigtes Interesse): anonymisierte Analyse des Website-Traffics und -Verhaltens.\n• Kommunikation (berechtigtes Interesse / Einwilligung): Beantwortung von Anfragen, Versand von Informationen zu Ihrem Dossier.\n• Rechtliche Compliance (gesetzliche Verpflichtung): Aufbewahrung von Daten gemäß geltenden Vorschriften.\n• Marketing und Werbung (Einwilligung): nur wenn Sie ausdrücklich über unser Cookie-Management-Tool eingewilligt haben.`,
      },
      {
        heading: "4. Datenweitergabe",
        body: `Borivon.com verkauft oder vermietet Ihre personenbezogenen Daten nicht an Dritte.\n\nIhre Daten können nur weitergegeben werden an:\n\n• Beauftragte technische Anbieter (Hosting: Vercel, Datenbank: Supabase, Speicher: Google Drive), die unter DSGVO-konformen Verträgen tätig sind.\n• Partnerrekrutierungsagenten, die ausdrücklich von Borivon.com autorisiert wurden, ausschließlich zum Zweck der Bewertung Ihrer Bewerbung, und die Vertraulichkeitspflichten unterliegen.\n• Zuständige Behörden, sofern dies gesetzlich ausdrücklich vorgeschrieben ist.\n\nJede Übermittlung von Daten außerhalb des Europäischen Wirtschaftsraums unterliegt angemessenen Garantien (Standardvertragsklauseln, Angemessenheitsbeschlüsse).`,
      },
      {
        heading: "5. Speicherfristen",
        body: `• Kontodaten und Bewerberdossiers: für die Laufzeit des Kontos, danach 24 Monate ab Ihrer letzten Aktivität, sofern keine gesetzliche Aufbewahrungspflicht anderes vorschreibt.\n• Kontaktformulardaten: 12 Monate.\n• Analysedaten: in aggregierter, anonymisierter Form ohne zeitliche Begrenzung.\n• Sicherheitslogs: 12 Monate.\n\nNach Ablauf dieser Fristen werden Ihre Daten sicher gelöscht oder anonymisiert.`,
      },
      {
        heading: "6. Datensicherheit",
        body: `Wir implementieren geeignete technische und organisatorische Maßnahmen zum Schutz Ihrer Daten:\n\n• Verschlüsselte Übertragungen (HTTPS/TLS).\n• Passwortspeicherung durch kryptografisches Hashing (bcrypt).\n• Strenge Zugangskontrolle mit starker Authentifizierung.\n• Hosting auf zertifizierten Infrastrukturen (Vercel, Supabase).\n• Regelmäßige Sicherheitsüberprüfungen.\n\nIm Falle einer Datenpanne, die voraussichtlich zu einem Risiko für Ihre Rechte und Freiheiten führt, werden wir Sie innerhalb der gesetzlich vorgeschriebenen Fristen benachrichtigen.`,
      },
      {
        heading: "7. Ihre Rechte",
        body: `Gemäß DSGVO und anwendbarem Recht haben Sie folgende Rechte:\n\n• Auskunftsrecht: Erhalt einer Kopie Ihrer personenbezogenen Daten.\n• Berichtigungsrecht: Korrektur unrichtiger oder unvollständiger Daten.\n• Löschungsrecht: Beantragung der Löschung Ihrer Daten (\"Recht auf Vergessenwerden\").\n• Recht auf Datenübertragbarkeit: Erhalt Ihrer Daten in einem strukturierten, gängigen, maschinenlesbaren Format.\n• Widerspruchsrecht: Widerspruch gegen eine auf unserem berechtigten Interesse beruhende Verarbeitung.\n• Recht auf Einschränkung: Beantragung der vorübergehenden Aussetzung der Verarbeitung.\n• Widerrufsrecht: jederzeitiger Widerruf Ihrer Einwilligung (ohne Beeinträchtigung der Rechtmäßigkeit vorheriger Verarbeitungen).\n\nZur Ausübung Ihrer Rechte: contact@borivon.com. Wir antworten innerhalb von 30 Tagen.`,
      },
      {
        heading: "8. Cookies und Tracker",
        body: `Wir verwenden verschiedene Cookie-Kategorien:\n\n• Notwendige Cookies: für den Betrieb der Website erforderlich, immer aktiv.\n• Analyse-Cookies: erheben aggregierte Daten zur Website-Nutzung (mit Ihrer Einwilligung).\n• Werbe-Cookies: ermöglichen die Personalisierung von Anzeigen und die Messung ihrer Wirksamkeit, u. a. über den Meta Pixel (mit Ihrer Einwilligung).\n\nSie können Ihre Einstellungen jederzeit über den Link „Cookie-Einstellungen" am Ende der Seite verwalten.`,
      },
      {
        heading: "9. Änderungen der Richtlinie",
        body: `Wir behalten uns das Recht vor, diese Richtlinie jederzeit zu ändern. Die aktualisierte Version wird auf dieser Seite mit einem neuen Überarbeitungsdatum veröffentlicht. Bei wesentlichen Änderungen werden wir Sie per E-Mail oder durch einen sichtbaren Hinweis auf der Website informieren.`,
      },
      {
        heading: "10. Kontakt und Beschwerden",
        body: `Für Fragen oder zur Ausübung Ihrer Rechte:\nE-Mail: contact@borivon.com\n\nWenn Sie der Meinung sind, dass Ihre Rechte nicht gewahrt werden, haben Sie das Recht, eine Beschwerde bei der für Sie zuständigen Datenschutzbehörde einzureichen.`,
      },
      {
        heading: "11. Kostenloser Pflege-Fahrplan (borivon.com/fahrplan)",
        body: `Wenn Sie den kostenlosen Pflege-Fahrplan für Ihre Einrichtung anfordern, verarbeiten wir: Anrede, Nachname, Name der Einrichtung, geschäftliche E-Mail-Adresse und Ihre Antworten im Formular (zu Personal, offenen Stellen, Kündigungen, Leihkräften, Einarbeitung und woher Sie uns kennen).\n\nZweck: Wir erstellen Ihren persönlichen Fahrplan als PDF und senden ihn Ihnen per E-Mail. Außerdem senden wir Ihnen per E-Mail Tipps und Angebote von Borivon.\n\nRechtsgrundlage: Ihre Einwilligung (Art. 6 Abs. 1 lit. a DSGVO), die Sie mit dem Häkchen im Formular geben. Wir nutzen das Double-Opt-in-Verfahren: Nach dem Absenden bekommen Sie eine E-Mail mit einem Bestätigungslink. Erst nach Ihrem Klick senden wir den Fahrplan und weitere E-Mails. Als Nachweis Ihrer Einwilligung speichern wir Zeitpunkt, den Text des Häkchens und Ihre IP-Adresse beim Absenden und beim Bestätigen (Art. 6 Abs. 1 lit. c i. V. m. Art. 7 Abs. 1 DSGVO). Ohne diese Angaben und das Häkchen können wir Ihnen den Fahrplan nicht senden.\n\nAbmeldung: Jede E-Mail enthält einen Abmeldelink. Sie können Ihre Einwilligung jederzeit widerrufen, über diesen Link oder an contact@borivon.com. Der Widerruf gilt für die Zukunft.\n\nEmpfänger: Cloudflare (Hosting und Datenbank) und Resend (E-Mail-Versand und Kontaktliste). Beide verarbeiten die Daten in unserem Auftrag (Art. 28 DSGVO). Zu Übermittlungen außerhalb des EWR siehe Abschnitt 4.\n\nSpeicherdauer: Klicken Sie den Bestätigungslink nicht, löschen wir Ihre Angaben nach 30 Tagen. Sonst speichern wir sie 12 Monate nach Ihrer letzten Aktivität (wie Kontaktformulardaten, Abschnitt 5). Nach einer Abmeldung schreiben wir Ihnen nicht mehr; den Nachweis Ihrer Einwilligung und Ihrer Abmeldung bewahren wir bis zum Ende dieser Frist auf. Die Löschung können Sie jederzeit unter contact@borivon.com verlangen. Danach bleiben nur anonyme Zahlen für unsere Statistik.`,
      },
    ],
  },
};