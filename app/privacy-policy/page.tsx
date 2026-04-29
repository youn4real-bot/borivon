"use client";

import { useRouter } from "next/navigation";
import { useLang } from "@/components/LangContext";

const LAST_UPDATED = "28 April 2026";

const content = {
  fr: {
    title: "Politique de Confidentialité",
    subtitle: "Borivon.com",
    updated: `Dernière mise à jour : ${LAST_UPDATED}`,
    intro: "La présente Politique de Confidentialité décrit comment Borivon.com collecte, utilise, conserve et protège vos données personnelles conformément au Règlement Général sur la Protection des Données (RGPD — UE 2016/679) et aux lois applicables.",
    sections: [
      {
        heading: "1. Responsable du traitement",
        body: `Borivon est une plateforme internationale exploitée par Germeds LLC, société à responsabilité limitée enregistrée aux États-Unis d'Amérique. Germeds LLC est l'unique responsable du traitement de toutes les données personnelles traitées via cette plateforme.\nE-mail : contact@borivon.com\nTéléphone : +49 157 315 047 59`,
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
    ],
  },
  en: {
    title: "Privacy Policy",
    subtitle: "Borivon.com",
    updated: `Last updated: ${LAST_UPDATED}`,
    intro: "This Privacy Policy describes how Borivon.com collects, uses, stores, and protects your personal data in compliance with the General Data Protection Regulation (GDPR — EU 2016/679) and applicable laws.",
    sections: [
      {
        heading: "1. Data Controller",
        body: `Borivon is an international platform operated by Germeds LLC, a limited liability company registered in the United States of America. Germeds LLC is the sole data controller for all personal data processed through this platform.\nEmail: contact@borivon.com\nPhone: +49 157 315 047 59`,
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
    ],
  },
  de: {
    title: "Datenschutzerklärung",
    subtitle: "Borivon.com",
    updated: `Zuletzt aktualisiert: ${LAST_UPDATED}`,
    intro: "Diese Datenschutzerklärung beschreibt, wie Borivon.com Ihre personenbezogenen Daten gemäß der Datenschutz-Grundverordnung (DSGVO — EU 2016/679) und den anwendbaren Gesetzen erhebt, verwendet, speichert und schützt.",
    sections: [
      {
        heading: "1. Verantwortlicher",
        body: `Borivon ist eine internationale Plattform, betrieben von Germeds LLC, einer in den Vereinigten Staaten von Amerika eingetragenen Gesellschaft mit beschränkter Haftung. Germeds LLC ist der alleinige Verantwortliche für alle über diese Plattform verarbeiteten personenbezogenen Daten.\nE-Mail: contact@borivon.com\nTelefon: +49 157 315 047 59`,
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
    ],
  },
};

export default function PrivacyPolicyPage() {
  const router = useRouter();
  const { lang } = useLang();
  const c = content[lang] ?? content.en;

  return (
    <main className="bv-page-bottom min-h-screen" style={{ background: "var(--bg)", paddingTop: "calc(61px + 2rem)" }}>
      <div className="max-w-[760px] mx-auto px-4 pt-8 pb-16">

        {/* Header */}
        <div className="flex items-start gap-3 mb-10">
          <button
            onClick={() => router.back()}
            className="w-9 h-9 rounded-xl flex items-center justify-center transition-opacity hover:opacity-70 flex-shrink-0 mt-0.5"
            style={{ background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)" }}
          >
            ←
          </button>
          <div>
            <h1 className="text-lg font-semibold leading-snug" style={{ color: "var(--w)" }}>{c.title}</h1>
            <p className="text-xs mt-1" style={{ color: "var(--w3)" }}>{c.subtitle} · {c.updated}</p>
          </div>
        </div>

        {/* Intro banner */}
        <div className="rounded-2xl px-5 py-4 mb-8"
          style={{ background: "var(--gdim)", border: "1px solid var(--border-gold)" }}>
          <p className="text-xs leading-relaxed" style={{ color: "var(--gold)" }}>{c.intro}</p>
        </div>

        {/* Sections */}
        <div className="space-y-6">
          {c.sections.map((s, i) => (
            <div key={i} className="rounded-2xl p-5"
              style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--w)" }}>{s.heading}</h2>
              <div className="space-y-2">
                {s.body.split("\n\n").map((para, pi) => (
                  <p key={pi} className="text-xs leading-relaxed whitespace-pre-line" style={{ color: "var(--w2)" }}>
                    {para}
                  </p>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="mt-10 text-center">
          <p className="text-[11px]" style={{ color: "var(--w3)" }}>
            © {new Date().getFullYear()} Borivon.com.{" "}
            {lang === "fr" ? "Tous droits réservés." : lang === "de" ? "Alle Rechte vorbehalten." : "All rights reserved."}
          </p>
        </div>

      </div>
    </main>
  );
}
