/**
 * The privacy policy text, shared by /privacy-policy (all languages, follows the
 * site language) and /datenschutz (always German; founder 2026-11-07: German
 * visitors and every link from /fahrplan go there). One source, so the two
 * pages can never say different things.
 */
export type PrivacyLang = "fr" | "en" | "de";

const UPDATED: Record<PrivacyLang, string> = { fr: "10 novembre 2026", en: "10 November 2026", de: "10. November 2026" };

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
        body: `Vos données sont traitées pour les finalités et sur les bases légales suivantes :\n\n• Fourniture et gestion des services (exécution du contrat) : traitement de vos demandes de cours, gestion de votre compte Portail, suivi de votre candidature.\n• Mesure d'audience (intérêt légitime ou consentement) : voir la section 12.\n• Communication (intérêt légitime / consentement) : réponse à vos demandes, envoi d'informations relatives à votre dossier.\n• Conformité légale (obligation légale) : conservation des données requises par la réglementation applicable.\n• E-mails marketing (consentement) : uniquement si vous y avez expressément consenti, par ex. pour le plan gratuit (section 11).`,
      },
      {
        heading: "4. Partage des données",
        body: `Borivon ne vend ni ne loue vos données personnelles à des tiers.\n\nVos données peuvent être partagées uniquement avec :\n\n• Prestataires techniques agissant pour notre compte (art. 28 du RGPD) : Cloudflare (site, base de données et fichiers ; base de données dans l'UE), Supabase (connexion au Portail), Resend (envoi des e-mails) et Google (invitation d'agenda et appel vidéo pour les rendez-vous réservés).\n• Agents partenaires recruteurs expressément autorisés par Borivon, dans le strict cadre de l'évaluation de votre candidature, et liés par des obligations de confidentialité.\n• Autorités compétentes, lorsque la loi l'exige expressément.\n\nCertains de ces prestataires sont établis aux États-Unis. Les transferts vers ce pays reposent sur le EU-US Data Privacy Framework ou sur des clauses contractuelles types.`,
      },
      {
        heading: "5. Durée de conservation",
        body: `• Données de compte et dossiers candidats : conservées pendant la durée active de votre compte, puis pendant 24 mois à compter de votre dernière activité, sauf obligation légale contraire.\n• Données de contact (formulaire) : conservées pendant 12 mois.\n• Données analytiques : conservées sous forme agrégée et anonymisée sans limite de durée.\n• Logs de sécurité : conservés pendant 12 mois.\n\nÀ l'expiration de ces durées, vos données sont supprimées ou anonymisées de manière sécurisée.`,
      },
      {
        heading: "6. Sécurité des données",
        body: `Nous mettons en œuvre des mesures techniques et organisationnelles appropriées pour protéger vos données :\n\n• Chiffrement des transmissions (HTTPS/TLS).\n• Stockage des mots de passe par hachage cryptographique (bcrypt).\n• Contrôle d'accès strict avec authentification forte.\n• Hébergement sur des infrastructures certifiées (Cloudflare, Supabase).\n• Revues de sécurité régulières.\n\nEn cas de violation de données susceptible d'engendrer un risque pour vos droits et libertés, nous vous notifierons dans les délais légaux requis.`,
      },
      {
        heading: "7. Vos droits",
        body: `En vertu du RGPD et des lois applicables, vous disposez des droits suivants :\n\n• Droit d'accès : obtenir une copie de vos données personnelles.\n• Droit de rectification : faire corriger des données inexactes ou incomplètes.\n• Droit à l'effacement : demander la suppression de vos données (« droit à l'oubli »).\n• Droit à la portabilité : recevoir vos données dans un format structuré, couramment utilisé et lisible par machine.\n• Droit d'opposition : vous opposer au traitement fondé sur notre intérêt légitime.\n• Droit à la limitation : demander la suspension temporaire du traitement.\n• Droit de retrait du consentement : retirer à tout moment votre consentement aux traitements fondés sur celui-ci (sans remettre en cause la licéité des traitements antérieurs).\n\nPour exercer vos droits : contact@borivon.com. Nous répondons dans un délai de 30 jours.`,
      },
      {
        heading: "8. Cookies et technologies similaires",
        body: `Nous n'utilisons aucun cookie ni pixel de fournisseurs de publicité ou d'analyse.\n\n• Nécessaires (sans consentement, § 25 al. 2 n° 2 TDDDG) : dans le Portail, votre navigateur conserve votre connexion. Nous enregistrons votre choix dans l'avis de confidentialité dans votre navigateur (bv_consent, 13 mois) afin de ne pas vous redemander à chaque visite.\n• Statistiques (uniquement avec votre consentement, § 25 al. 1 TDDDG) : notre propre mesure d'audience (section 12) avec un identifiant aléatoire dans votre navigateur (bv_vid, 13 mois).\n\nVous choisissez lors de votre première visite dans l'avis de confidentialité. Vous pouvez retirer votre consentement à tout moment pour l'avenir : via le lien « Datenschutz-Einstellungen » (paramètres de confidentialité) en bas de chaque page.`,
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
        body: `Lorsque vous demandez le plan infirmier gratuit pour votre établissement, nous traitons : civilité, prénom, nom, adresse e-mail professionnelle et vos réponses dans le formulaire : type d'établissement, votre poste, nombre de sites, Land, taille (résidents, lits, patients ou personnes), besoin en infirmières sur 12 mois, nombre d'intérimaires, expérience avec des infirmières de l'étranger (et ce qui n'a pas marché), date de démarrage souhaitée, ce qui est déjà prêt, et qui décide.\n\nFinalité : nous créons votre plan personnel en PDF et vous l'envoyons par e-mail. Nous vous envoyons aussi par e-mail des conseils et des offres de Borivon.\n\nBase légale : votre consentement (art. 6, par. 1, point a du RGPD), donné en cochant la case du formulaire. Nous utilisons le double opt-in : après l'envoi du formulaire, vous recevez un e-mail avec un lien de confirmation. Ce n'est qu'après votre clic que nous envoyons le plan et d'autres e-mails. Si vous avez déjà confirmé la même adresse lors d'une demande précédente et ne vous êtes pas désabonné(e), nous envoyons directement le nouveau plan ; le précédent reste valable. Pour prouver votre consentement, nous enregistrons la date et l'heure, le texte de la case et votre adresse IP lors de l'envoi et de la confirmation (art. 6, par. 1, point c du RGPD en lien avec l'art. 7, par. 1 du RGPD). Sans ces données et sans la case cochée, nous ne pouvons pas vous envoyer le plan.\n\nDésinscription : chaque e-mail contient un lien de désinscription. Vous pouvez retirer votre consentement à tout moment, par ce lien ou à contact@borivon.com. Le retrait vaut pour l'avenir.\n\nDestinataires : Cloudflare (hébergement et base de données) et Resend (envoi des e-mails et liste de contacts). Tous deux traitent les données pour notre compte (art. 28 du RGPD). Pour les transferts hors de l'EEE, voir la section 4.\n\nDurée de conservation : si vous ne cliquez pas sur le lien de confirmation, nous supprimons vos données après 30 jours. Sinon, nous les conservons 12 mois après votre dernière activité (comme les données de contact, section 5). Après une désinscription, nous ne vous écrivons plus ; la preuve de votre consentement et de votre désinscription est conservée jusqu'à la fin de ce délai. Vous pouvez demander l'effacement à tout moment à contact@borivon.com. Ensuite, seuls des chiffres anonymes restent pour nos statistiques.`,
      },
      {
        heading: "12. Mesure d'audience",
        body: `Nous mesurons nous-mêmes comment les visiteurs trouvent et utilisent nos pages, sans tiers et sans publicité. Les données sont conservées uniquement chez nous (Cloudflare pour notre compte ; base de données dans l'UE).\n\nSans consentement : notre serveur ne traite que ce que vous nous envoyez ou demandez vous-même : l'ouverture de l'un de nos liens (par ex. depuis une publication), l'envoi du formulaire du plan, la confirmation par e-mail, l'ouverture du plan et la réservation d'un rendez-vous. Nous enregistrons alors l'heure, la provenance (code du lien ou paramètre utm), le type d'appareil, le système et le navigateur (à partir de l'identification du navigateur), la localisation approximative (pays, région, ville) et le réseau ou fournisseur derrière l'adresse IP (données de Cloudflare). L'adresse IP n'est enregistrée que raccourcie. Pour compter les actions d'une même journée, nous calculons à partir de l'adresse IP et du navigateur une valeur qui change chaque jour. Base légale : notre intérêt légitime à améliorer notre publicité et notre offre (art. 6, par. 1, point f du RGPD). Vous pouvez vous y opposer à tout moment (art. 21 du RGPD), par simple message à contact@borivon.com.\n\nAvec votre consentement (statistiques) : en plus, nos pages enregistrent les pages consultées, jusqu'où vous lisez, ce que vous cliquez, quelles étapes et quels champs de formulaire vous atteignez (seulement si un champ a été rempli, jamais son contenu), la langue, la taille d'écran et le site d'origine, et vous reconnaissent grâce à l'identifiant aléatoire (bv_vid) lorsque vous revenez. Base légale : votre consentement (art. 6, par. 1, point a du RGPD, § 25 al. 1 TDDDG). Nous enregistrons votre consentement avec l'heure et un identifiant aléatoire comme preuve.\n\nLien avec votre demande : si vous demandez le plan ou réservez un rendez-vous, nous relions cette mesure à votre demande pour voir par quel chemin elle est arrivée.\n\nDurée de conservation : données de mesure 14 mois, identifiant dans votre navigateur 13 mois. Retrait : à tout moment via « Datenschutz-Einstellungen » en bas de chaque page.`,
      },
      {
        heading: "13. Plateforme Borivon pour les établissements (borivon.com/einrichtung)",
        body: `Un établissement qui ouvre son accès (via le lien personnel de son plan) reçoit son propre espace dans le portail Borivon. Nous traitons pour lui : l’adresse e-mail, la civilité et le nom de la personne qui ouvre l’accès, le nom de l’établissement, l’acceptation des conditions d’utilisation et du contrat de sous-traitance (date, version, adresse IP) et les données de connexion. Base légale : exécution du contrat (art. 6, al. 1, lit. b RGPD).

Les infirmières qui rejoignent cet espace par le lien de l’établissement y déposent elles-mêmes leurs données et documents. Pour ces données, Borivon agit pour le compte de l’établissement, qui en est le responsable (art. 28 RGPD, contrat sur borivon.com/einrichtung/avv). L’équipe de Borivon ne les voit que si l’établissement active « Travailler avec Borivon ». Les données sont supprimées 30 jours après la fin du contrat, sauf si l’infirmière continue d’utiliser son propre compte.`,
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
        body: `Your data is processed for the following purposes and on the following legal bases:\n\n• Service provision and management (contract performance): processing your course enquiries, managing your Portal account, tracking your application.\n• Visitor measurement (legitimate interest or consent): see section 12.\n• Communication (legitimate interest / consent): responding to enquiries, sending information about your application.\n• Legal compliance (legal obligation): retaining data as required by applicable regulations.\n• Marketing emails (consent): only if you have expressly consented, e.g. for the free roadmap (section 11).`,
      },
      {
        heading: "4. Data Sharing",
        body: `Borivon does not sell or rent your personal data to third parties.\n\nYour data may only be shared with:\n\n• Technical providers working on our behalf (Art. 28 GDPR): Cloudflare (website, database and files; database in the EU), Supabase (portal login), Resend (email delivery) and Google (calendar invitation and video call for booked appointments).\n• Partner recruitment agents expressly authorised by Borivon, strictly for the purpose of evaluating your application, and bound by confidentiality obligations.\n• Competent authorities, where expressly required by law.\n\nSome of these providers are based in the USA. We base transfers there on the EU-US Data Privacy Framework or on standard contractual clauses.`,
      },
      {
        heading: "5. Retention Periods",
        body: `• Account data and candidate files: retained for the active lifetime of your account, then for 24 months from your last activity, unless a legal obligation requires otherwise.\n• Contact form data: retained for 12 months.\n• Analytics data: retained in aggregated, anonymised form indefinitely.\n• Security logs: retained for 12 months.\n\nUpon expiry of these periods, your data is securely deleted or anonymised.`,
      },
      {
        heading: "6. Data Security",
        body: `We implement appropriate technical and organisational measures to protect your data:\n\n• Encrypted transmissions (HTTPS/TLS).\n• Password storage via cryptographic hashing (bcrypt).\n• Strict access controls with strong authentication.\n• Hosting on certified infrastructures (Cloudflare, Supabase).\n• Regular security reviews.\n\nIn the event of a data breach likely to result in a risk to your rights and freedoms, we will notify you within the legally required timeframe.`,
      },
      {
        heading: "7. Your Rights",
        body: `Under the GDPR and applicable laws, you have the following rights:\n\n• Right of access: obtain a copy of your personal data.\n• Right to rectification: have inaccurate or incomplete data corrected.\n• Right to erasure: request deletion of your data ("right to be forgotten").\n• Right to portability: receive your data in a structured, commonly used, machine-readable format.\n• Right to object: object to processing based on our legitimate interest.\n• Right to restriction: request temporary suspension of processing.\n• Right to withdraw consent: withdraw your consent at any time for consent-based processing (without affecting the lawfulness of prior processing).\n\nTo exercise your rights: contact@borivon.com. We respond within 30 days.`,
      },
      {
        heading: "8. Cookies and similar technologies",
        body: `We use no cookies or pixels from advertising or analytics providers.\n\n• Necessary (no consent needed, § 25(2) no. 2 TDDDG): in the portal your browser stores your login. We store your choice in the privacy notice in your browser (bv_consent, 13 months) so we do not ask again on every visit.\n• Statistics (only with your consent, § 25(1) TDDDG): our own visitor measurement (section 12) with a random identifier in your browser (bv_vid, 13 months).\n\nYou decide on your first visit in the privacy notice. You can withdraw your consent at any time with effect for the future: via the "Datenschutz-Einstellungen" (privacy settings) link at the bottom of every page.`,
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
        body: `When you request the free roadmap for your facility, we process: title, first name, last name, business email address and your answers in the form: type of facility, your position, number of sites, federal state, size (residents, beds, clients or people), need for nurses over 12 months, number of agency nurses, experience with nurses from abroad (and what went wrong), wanted start date, what is already in place, and who decides.\n\nPurpose: we create your personal roadmap as a PDF and send it to you by email. We also send you tips and offers from Borivon by email.\n\nLegal basis: your consent (Art. 6(1)(a) GDPR), which you give by ticking the box in the form. We use double opt-in: after you send the form, you get an email with a confirmation link. Only after your click do we send the roadmap and further emails. If you already confirmed the same email address in an earlier request and did not unsubscribe, we send the new roadmap directly; the earlier one stays valid. As proof of your consent, we store the time, the text of the box and your IP address when you send the form and when you confirm (Art. 6(1)(c) in conjunction with Art. 7(1) GDPR). Without these details and the ticked box, we cannot send you the roadmap.\n\nUnsubscribe: every email contains an unsubscribe link. You can withdraw your consent at any time, by that link or at contact@borivon.com. The withdrawal applies to the future.\n\nRecipients: Cloudflare (hosting and database) and Resend (email delivery and contact list). Both process the data on our behalf (Art. 28 GDPR). For transfers outside the EEA, see section 4.\n\nRetention: if you do not click the confirmation link, we delete your details after 30 days. Otherwise we keep them for 12 months after your last activity (like contact form data, section 5). After you unsubscribe, we no longer write to you; the proof of your consent and of your unsubscribe is kept until the end of that period. You can ask us to delete your data at any time at contact@borivon.com. After that, only anonymous numbers remain for our statistics.`,
      },
      {
        heading: "12. Visitor measurement",
        body: `We measure ourselves how visitors find and use our pages, without third parties and without advertising. Data is stored only with us (Cloudflare on our behalf; database in the EU).\n\nWithout consent: our server only processes what you send to or request from us yourself: opening one of our links (e.g. from a post), sending the roadmap form, confirming by email, opening the roadmap and booking an appointment. For these we record the time, the source (link code or utm parameter), device type, operating system and browser (from the browser identification), approximate location (country, region, city) and the network or provider behind the IP address (data from Cloudflare). We store the IP address only shortened. To count actions on the same day, we compute a value from the IP address and browser identification that changes every day. Legal basis: our legitimate interest in improving our advertising and our offer (Art. 6(1)(f) GDPR). You can object at any time (Art. 21 GDPR), simply by writing to contact@borivon.com.\n\nWith your consent (statistics): in addition, our pages record which pages you open, how far you read, what you click, which form steps and fields you reach (only whether a field was filled, never its content), language, screen size and the referring website, and recognise you via the random identifier (bv_vid) when you come back later. Legal basis: your consent (Art. 6(1)(a) GDPR, § 25(1) TDDDG). We log your consent with the time and a random identifier as proof.\n\nLinking: if you request the roadmap or book an appointment, we connect this measurement to your request so we can see which way it came.\n\nRetention: measurement data 14 months, the identifier in your browser 13 months. Withdrawal: at any time via "Datenschutz-Einstellungen" at the bottom of every page.`,
      },
      {
        heading: "13. Borivon platform for facilities (borivon.com/einrichtung)",
        body: `A facility that opens its access (via the personal link in its roadmap) gets its own space in the Borivon portal. For it we process: the email address, salutation and last name of the person opening the access, the facility's name, the acceptance of the terms of use and the data processing agreement (time, version, IP address) and sign-in data. Legal basis: performance of the contract (Art. 6(1)(b) GDPR).

Nurses who join this space through the facility's link upload their own data and documents there. For these data Borivon acts on behalf of the facility, which is the controller (Art. 28 GDPR, agreement at borivon.com/einrichtung/avv). Borivon's team only sees them if the facility switches on \"Work with Borivon\". The data are deleted 30 days after the contract ends, unless the nurse keeps using her own account.`,
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
        body: `Ihre Daten werden für folgende Zwecke und auf folgenden Rechtsgrundlagen verarbeitet:\n\n• Erbringung und Verwaltung von Diensten (Vertragserfüllung): Bearbeitung Ihrer Kursanfragen, Verwaltung Ihres Portalkontos, Verfolgung Ihrer Bewerbung.\n• Reichweitenmessung (berechtigtes Interesse bzw. Einwilligung): siehe Abschnitt 12.\n• Kommunikation (berechtigtes Interesse / Einwilligung): Beantwortung von Anfragen, Versand von Informationen zu Ihrem Dossier.\n• Rechtliche Compliance (gesetzliche Verpflichtung): Aufbewahrung von Daten gemäß geltenden Vorschriften.\n• Marketing-E-Mails (Einwilligung): nur wenn Sie ausdrücklich eingewilligt haben, etwa beim kostenlosen Fahrplan (Abschnitt 11).`,
      },
      {
        heading: "4. Datenweitergabe",
        body: `Borivon verkauft oder vermietet Ihre personenbezogenen Daten nicht an Dritte.\n\nIhre Daten können nur weitergegeben werden an:\n\n• Technische Dienstleister, die in unserem Auftrag arbeiten (Art. 28 DSGVO): Cloudflare (Website, Datenbank und Dateien; Datenbank in der EU), Supabase (Anmeldung im Portal), Resend (E-Mail-Versand) und Google (Kalendereinladung und Videogespräch bei gebuchten Terminen).\n• Partnerrekrutierungsagenten, die ausdrücklich von Borivon autorisiert wurden, ausschließlich zum Zweck der Bewertung Ihrer Bewerbung, und die Vertraulichkeitspflichten unterliegen.\n• Zuständige Behörden, sofern dies gesetzlich ausdrücklich vorgeschrieben ist.\n\nEinige dieser Dienstleister haben ihren Sitz in den USA. Übermittlungen dorthin stützen wir auf das EU-US Data Privacy Framework bzw. auf Standardvertragsklauseln.`,
      },
      {
        heading: "5. Speicherfristen",
        body: `• Kontodaten und Bewerberdossiers: für die Laufzeit des Kontos, danach 24 Monate ab Ihrer letzten Aktivität, sofern keine gesetzliche Aufbewahrungspflicht anderes vorschreibt.\n• Kontaktformulardaten: 12 Monate.\n• Analysedaten: in aggregierter, anonymisierter Form ohne zeitliche Begrenzung.\n• Sicherheitslogs: 12 Monate.\n\nNach Ablauf dieser Fristen werden Ihre Daten sicher gelöscht oder anonymisiert.`,
      },
      {
        heading: "6. Datensicherheit",
        body: `Wir implementieren geeignete technische und organisatorische Maßnahmen zum Schutz Ihrer Daten:\n\n• Verschlüsselte Übertragungen (HTTPS/TLS).\n• Passwortspeicherung durch kryptografisches Hashing (bcrypt).\n• Strenge Zugangskontrolle mit starker Authentifizierung.\n• Hosting auf zertifizierten Infrastrukturen (Cloudflare, Supabase).\n• Regelmäßige Sicherheitsüberprüfungen.\n\nIm Falle einer Datenpanne, die voraussichtlich zu einem Risiko für Ihre Rechte und Freiheiten führt, werden wir Sie innerhalb der gesetzlich vorgeschriebenen Fristen benachrichtigen.`,
      },
      {
        heading: "7. Ihre Rechte",
        body: `Gemäß DSGVO und anwendbarem Recht haben Sie folgende Rechte:\n\n• Auskunftsrecht: Erhalt einer Kopie Ihrer personenbezogenen Daten.\n• Berichtigungsrecht: Korrektur unrichtiger oder unvollständiger Daten.\n• Löschungsrecht: Beantragung der Löschung Ihrer Daten (\"Recht auf Vergessenwerden\").\n• Recht auf Datenübertragbarkeit: Erhalt Ihrer Daten in einem strukturierten, gängigen, maschinenlesbaren Format.\n• Widerspruchsrecht: Widerspruch gegen eine auf unserem berechtigten Interesse beruhende Verarbeitung.\n• Recht auf Einschränkung: Beantragung der vorübergehenden Aussetzung der Verarbeitung.\n• Widerrufsrecht: jederzeitiger Widerruf Ihrer Einwilligung (ohne Beeinträchtigung der Rechtmäßigkeit vorheriger Verarbeitungen).\n\nZur Ausübung Ihrer Rechte: contact@borivon.com. Wir antworten innerhalb von 30 Tagen.`,
      },
      {
        heading: "8. Cookies und ähnliche Technologien",
        body: `Wir verwenden keine Cookies oder Pixel von Werbe- oder Analyse-Anbietern.\n\n• Notwendig (ohne Einwilligung, § 25 Abs. 2 Nr. 2 TDDDG): Im Portal speichert Ihr Browser Ihre Anmeldung. Ihre Auswahl im Datenschutz-Hinweis speichern wir in Ihrem Browser (bv_consent, 13 Monate), damit wir nicht bei jedem Besuch erneut fragen.\n• Statistik (nur mit Ihrer Einwilligung, § 25 Abs. 1 TDDDG): unsere eigene Reichweitenmessung (Abschnitt 12) mit einer zufälligen Kennung in Ihrem Browser (bv_vid, 13 Monate).\n\nSie entscheiden beim ersten Besuch im Datenschutz-Hinweis. Ihre Einwilligung können Sie jederzeit mit Wirkung für die Zukunft widerrufen: über den Link „Datenschutz-Einstellungen“ unten auf jeder Seite.`,
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
        body: `Wenn Sie den kostenlosen Pflege-Fahrplan für Ihre Einrichtung anfordern, verarbeiten wir: Anrede, Vorname, Nachname, geschäftliche E-Mail-Adresse und Ihre Antworten im Formular: Art der Einrichtung, Ihre Position, Zahl der Standorte, Bundesland, Größe (Bewohner, Betten, Klienten oder Menschen), Bedarf an Fachkräften in 12 Monaten, Zahl der Leasingkräfte, Erfahrung mit Fachkräften aus dem Ausland (und was schiefgelaufen ist), gewünschter Starttermin, was schon vorbereitet ist und wer entscheidet.\n\nZweck: Wir erstellen Ihren persönlichen Fahrplan als PDF und senden ihn Ihnen per E-Mail. Außerdem senden wir Ihnen per E-Mail Tipps und Angebote von Borivon.\n\nRechtsgrundlage: Ihre Einwilligung (Art. 6 Abs. 1 lit. a DSGVO), die Sie mit dem Häkchen im Formular geben. Wir nutzen das Double-Opt-in-Verfahren: Nach dem Absenden bekommen Sie eine E-Mail mit einem Bestätigungslink. Erst nach Ihrem Klick senden wir den Fahrplan und weitere E-Mails. Haben Sie dieselbe E-Mail-Adresse schon bei einer früheren Anfrage bestätigt und sich nicht abgemeldet, senden wir den neuen Fahrplan direkt; der frühere bleibt gültig. Als Nachweis Ihrer Einwilligung speichern wir Zeitpunkt, den Text des Häkchens und Ihre IP-Adresse beim Absenden und beim Bestätigen (Art. 6 Abs. 1 lit. c i. V. m. Art. 7 Abs. 1 DSGVO). Ohne diese Angaben und das Häkchen können wir Ihnen den Fahrplan nicht senden.\n\nAbmeldung: Jede E-Mail enthält einen Abmeldelink. Sie können Ihre Einwilligung jederzeit widerrufen, über diesen Link oder an contact@borivon.com. Der Widerruf gilt für die Zukunft.\n\nEmpfänger: Cloudflare (Hosting und Datenbank) und Resend (E-Mail-Versand und Kontaktliste). Beide verarbeiten die Daten in unserem Auftrag (Art. 28 DSGVO). Zu Übermittlungen außerhalb des EWR siehe Abschnitt 4.\n\nSpeicherdauer: Klicken Sie den Bestätigungslink nicht, löschen wir Ihre Angaben nach 30 Tagen. Sonst speichern wir sie 12 Monate nach Ihrer letzten Aktivität (wie Kontaktformulardaten, Abschnitt 5). Nach einer Abmeldung schreiben wir Ihnen nicht mehr; den Nachweis Ihrer Einwilligung und Ihrer Abmeldung bewahren wir bis zum Ende dieser Frist auf. Die Löschung können Sie jederzeit unter contact@borivon.com verlangen. Danach bleiben nur anonyme Zahlen für unsere Statistik.`,
      },
      {
        heading: "12. Reichweitenmessung",
        body: `Wir messen selbst, wie Besucher unsere Seiten finden und nutzen, ohne Dritte und ohne Werbung. Gespeichert wird nur bei uns (Cloudflare in unserem Auftrag; Datenbank in der EU).\n\nOhne Einwilligung: Unser Server verarbeitet nur, was Sie selbst an uns senden oder bei uns anfordern: das Öffnen eines unserer Links (z. B. aus einem Beitrag), das Absenden des Fahrplan-Formulars, die Bestätigung per E-Mail, das Öffnen des Fahrplans und eine Terminbuchung. Dabei erfassen wir Zeitpunkt, Herkunft (Link-Kennung bzw. utm-Parameter), Gerätetyp, Betriebssystem und Browser (aus der Browserkennung), den ungefähren Ort (Land, Region, Stadt) und das Netzwerk bzw. den Anbieter hinter der IP-Adresse (Angaben von Cloudflare). Die IP-Adresse speichern wir nur gekürzt. Um Vorgänge desselben Tages zusammenzuzählen, bilden wir aus IP-Adresse und Browserkennung einen Wert, der sich täglich ändert. Rechtsgrundlage: unser berechtigtes Interesse, unsere Werbung und unser Angebot zu verbessern (Art. 6 Abs. 1 lit. f DSGVO). Sie können jederzeit widersprechen (Art. 21 DSGVO), formlos an contact@borivon.com.\n\nMit Ihrer Einwilligung (Statistik): Zusätzlich erfassen unsere Seiten, welche Seiten Sie öffnen, wie weit Sie lesen, was Sie anklicken, welche Formularschritte und -felder Sie erreichen (nur ob ein Feld ausgefüllt wurde, nie den Inhalt), Sprache, Bildschirmgröße und die verweisende Website, und erkennen über die zufällige Kennung (bv_vid) wieder, wenn Sie später zurückkommen. Rechtsgrundlage: Ihre Einwilligung (Art. 6 Abs. 1 lit. a DSGVO, § 25 Abs. 1 TDDDG). Ihre Einwilligung protokollieren wir als Nachweis mit Zeitpunkt und einer zufälligen Kennung.\n\nVerknüpfung: Fordern Sie den Fahrplan an oder buchen Sie einen Termin, verbinden wir diese Messung mit Ihrer Anfrage, damit wir sehen, über welchen Weg sie kam.\n\nSpeicherdauer: Messdaten 14 Monate, die Kennung in Ihrem Browser 13 Monate. Widerruf: jederzeit über „Datenschutz-Einstellungen“ unten auf jeder Seite.`,
      },
      {
        heading: "13. Borivon-Plattform für Einrichtungen (borivon.com/einrichtung)",
        body: `Eröffnet eine Einrichtung ihren Zugang (über den persönlichen Link aus ihrem Fahrplan), erhält sie einen eigenen Bereich im Borivon-Portal. Dafür verarbeiten wir: E-Mail-Adresse, Anrede und Nachname der Person, die den Zugang eröffnet, den Namen der Einrichtung, die Zustimmung zu den Nutzungsbedingungen und zum Vertrag zur Auftragsverarbeitung (Zeitpunkt, Version, IP-Adresse) sowie Anmeldedaten. Rechtsgrundlage: Vertragserfüllung (Art. 6 Abs. 1 lit. b DSGVO).

Pflegekräfte, die über den Link der Einrichtung in diesen Bereich kommen, laden ihre Angaben und Unterlagen dort selbst hoch. Für diese Daten handelt Borivon im Auftrag der Einrichtung; Verantwortliche ist die Einrichtung (Art. 28 DSGVO, Vertrag unter borivon.com/einrichtung/avv). Das Team von Borivon sieht sie nur, wenn die Einrichtung „Mit Borivon arbeiten“ einschaltet. Die Daten werden 30 Tage nach Vertragsende gelöscht, außer die Pflegekraft nutzt ihr eigenes Konto weiter.`,
      },
    ],
  },
};