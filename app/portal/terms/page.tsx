"use client";

import { useRouter } from "next/navigation";
import { useLang } from "@/components/LangContext";

const LAST_UPDATED = "25 April 2026";

const content = {
  fr: {
    title: "Conditions Générales d'Utilisation & Politique de Confidentialité",
    subtitle: "Borivon.com — Portail Candidat",
    updated: `Dernière mise à jour : ${LAST_UPDATED}`,
    sections: [
      {
        heading: "1. Acceptation des conditions",
        body: `En créant un compte et en utilisant le Portail Candidat de Borivon.com (ci-après « le Portail »), vous acceptez pleinement et sans réserve les présentes Conditions Générales d'Utilisation. Si vous n'acceptez pas ces conditions, vous ne devez pas utiliser le Portail.`,
      },
      {
        heading: "2. Qui sommes-nous",
        body: `Borivon.com est une plateforme spécialisée dans l'accompagnement de professionnels de santé dans leur processus de candidature. Le Portail est un outil sécurisé permettant aux candidats de soumettre et de suivre leurs documents de candidature.`,
      },
      {
        heading: "3. Données collectées",
        body: `Dans le cadre de votre utilisation du Portail, nous collectons les données suivantes :\n\n• Informations d'identification : nom, prénom, adresse e-mail, mot de passe (haché et non lisible).\n• Documents de candidature : CV, diplômes, certificats de langue, relevés de notes, documents professionnels et tout autre document que vous choisissez de télécharger.\n• Données de connexion : adresse IP, type de navigateur, date et heure de connexion, à des fins de sécurité et d'audit.`,
      },
      {
        heading: "4. Finalité du traitement des données",
        body: `Vos données personnelles et documents sont collectés et traités exclusivement aux fins suivantes :\n\n• Évaluation de votre dossier de candidature par l'équipe Borivon.com et les agents partenaires autorisés.\n• Communication avec vous concernant l'avancement de votre candidature.\n• Respect des obligations légales et réglementaires applicables.\n\nVos données ne seront en aucun cas utilisées à des fins publicitaires, de profilage commercial ou toute autre finalité non mentionnée dans le présent document.`,
      },
      {
        heading: "5. Partage des données avec des tiers",
        body: `Borivon.com ne vend, ne loue et ne cède jamais vos données personnelles à des tiers à des fins commerciales.\n\nVos données peuvent être partagées uniquement dans les cas suivants :\n\n• Agents partenaires recruteurs expressément mandatés par Borivon.com et liés par des obligations de confidentialité strictes, uniquement dans le cadre de l'évaluation de votre candidature.\n• Prestataires techniques (hébergement, stockage sécurisé) opérant sous contrat de sous-traitance conforme au RGPD.\n• Autorités compétentes, si la loi l'exige expressément.\n\nTout accès tiers à vos données est strictement limité à ce qui est nécessaire à la finalité déclarée.`,
      },
      {
        heading: "6. Sécurité des données",
        body: `Borivon.com met en œuvre des mesures de sécurité techniques et organisationnelles raisonnables pour protéger vos données contre tout accès non autorisé, perte, altération ou divulgation, notamment :\n\n• Chiffrement des communications (HTTPS/TLS).\n• Stockage sécurisé des mots de passe par hachage cryptographique.\n• Contrôle d'accès strict aux données des candidats.\n• Hébergement sur des infrastructures sécurisées (Supabase, Vercel).\n\nToutefois, aucun système de sécurité n'est infaillible. En cas de violation de données indépendante de la volonté raisonnable de Borivon.com, notre responsabilité sera limitée dans les conditions précisées à l'article 9.`,
      },
      {
        heading: "7. Conservation des données",
        body: `Vos données sont conservées pendant la durée nécessaire à l'évaluation de votre candidature et, au-delà, pendant une durée maximale de 24 mois à compter de la date de votre dernière activité sur le Portail, sauf obligation légale de conservation plus longue.\n\nÀ l'expiration de cette période, vos données seront supprimées ou anonymisées de manière sécurisée.`,
      },
      {
        heading: "8. Vos droits (RGPD)",
        body: `Conformément au Règlement Général sur la Protection des Données (RGPD — UE 2016/679), vous disposez des droits suivants :\n\n• Droit d'accès : obtenir une copie des données vous concernant.\n• Droit de rectification : corriger les données inexactes ou incomplètes.\n• Droit à l'effacement : demander la suppression de vos données (sous réserve des obligations légales).\n• Droit à la portabilité : recevoir vos données dans un format structuré et lisible par machine.\n• Droit d'opposition : vous opposer au traitement de vos données.\n• Droit à la limitation du traitement : demander la suspension du traitement.\n\nPour exercer vos droits, contactez-nous à l'adresse indiquée à l'article 11. Nous répondrons dans un délai maximum de 30 jours.`,
      },
      {
        heading: "9. Limitation de responsabilité",
        body: `Dans les limites permises par la loi applicable, Borivon.com ne saurait être tenue responsable :\n\n• Des pertes ou dommages indirects, consécutifs ou immatériels résultant de l'utilisation ou de l'impossibilité d'utiliser le Portail.\n• Des interruptions de service dues à des causes indépendantes de notre volonté (force majeure, pannes des prestataires techniques, attaques informatiques, etc.).\n• Des violations de données résultant d'actions malveillantes de tiers malgré les mesures de sécurité mises en place.\n• Des inexactitudes dans les documents fournis par le candidat lui-même.\n\nLa responsabilité totale de Borivon.com, quelle qu'en soit la cause, est limitée au montant effectivement payé par l'utilisateur pour les services en question au cours des 12 mois précédant l'événement générateur de responsabilité, ou à 100 € si aucun paiement n'a été effectué.`,
      },
      {
        heading: "10. Propriété intellectuelle",
        body: `Tous les contenus, interfaces, designs, logos, textes et fonctionnalités du Portail sont la propriété exclusive de Borivon.com et sont protégés par les lois sur la propriété intellectuelle. Toute reproduction, modification ou utilisation non autorisée est strictement interdite.`,
      },
      {
        heading: "11. Disponibilité du service",
        body: `Borivon.com s'efforce d'assurer la disponibilité continue du Portail mais ne garantit pas une disponibilité ininterrompue. Des maintenances peuvent être effectuées avec ou sans préavis. En cas d'indisponibilité prolongée, nous ferons notre maximum pour vous en informer.`,
      },
      {
        heading: "12. Modifications des conditions",
        body: `Borivon.com se réserve le droit de modifier les présentes conditions à tout moment. Les modifications entrent en vigueur dès leur publication sur le Portail. Votre utilisation continue du Portail après notification des modifications constitue votre acceptation des nouvelles conditions. Il vous appartient de consulter régulièrement cette page.`,
      },
      {
        heading: "13. Droit applicable et juridiction",
        body: `Les présentes conditions sont régies par le droit applicable dans le pays d'établissement de Borivon.com. En cas de litige, les parties s'efforceront de trouver une solution amiable. À défaut, le litige sera soumis aux juridictions compétentes.`,
      },
      {
        heading: "14. Contact",
        body: `Pour toute question relative aux présentes conditions, à vos données personnelles ou pour exercer vos droits, vous pouvez nous contacter via le site Borivon.com ou directement par e-mail à l'adresse de contact officielle indiquée sur le site.`,
      },
    ],
  },
  en: {
    title: "Terms & Conditions and Privacy Policy",
    subtitle: "Borivon.com — Candidate Portal",
    updated: `Last updated: ${LAST_UPDATED}`,
    sections: [
      {
        heading: "1. Acceptance of Terms",
        body: `By creating an account and using the Borivon.com Candidate Portal (hereinafter "the Portal"), you fully and unconditionally accept these Terms & Conditions. If you do not agree to these terms, you must not use the Portal.`,
      },
      {
        heading: "2. Who We Are",
        body: `Borivon.com is a platform specializing in supporting healthcare professionals through their application process. The Portal is a secure tool enabling candidates to submit and track their application documents.`,
      },
      {
        heading: "3. Data We Collect",
        body: `In the course of your use of the Portal, we collect the following data:\n\n• Identity information: first name, last name, email address, password (hashed and unreadable).\n• Application documents: CV, diplomas, language certificates, transcripts, professional documents, and any other document you choose to upload.\n• Connection data: IP address, browser type, date and time of access, for security and audit purposes.`,
      },
      {
        heading: "4. Purpose of Data Processing",
        body: `Your personal data and documents are collected and processed exclusively for the following purposes:\n\n• Evaluation of your application by the Borivon.com team and authorized partner agents.\n• Communication with you regarding the progress of your application.\n• Compliance with applicable legal and regulatory obligations.\n\nYour data will under no circumstances be used for advertising, commercial profiling, or any other purpose not stated in this document.`,
      },
      {
        heading: "5. Data Sharing with Third Parties",
        body: `Borivon.com never sells, rents, or transfers your personal data to third parties for commercial purposes.\n\nYour data may be shared only in the following cases:\n\n• Partner recruitment agents expressly mandated by Borivon.com and bound by strict confidentiality obligations, solely for the purpose of evaluating your application.\n• Technical service providers (hosting, secure storage) operating under GDPR-compliant data processing agreements.\n• Competent authorities, where expressly required by law.\n\nAny third-party access to your data is strictly limited to what is necessary for the stated purpose.`,
      },
      {
        heading: "6. Data Security",
        body: `Borivon.com implements reasonable technical and organizational security measures to protect your data against unauthorized access, loss, alteration, or disclosure, including:\n\n• Encrypted communications (HTTPS/TLS).\n• Secure password storage using cryptographic hashing.\n• Strict access control to candidate data.\n• Hosting on secure infrastructures (Supabase, Vercel).\n\nHowever, no security system is infallible. In the event of a data breach beyond Borivon.com's reasonable control, our liability will be limited as set out in Article 9.`,
      },
      {
        heading: "7. Data Retention",
        body: `Your data is retained for the duration necessary to evaluate your application and, beyond that, for a maximum period of 24 months from the date of your last activity on the Portal, unless a longer retention period is required by law.\n\nUpon expiry of this period, your data will be securely deleted or anonymized.`,
      },
      {
        heading: "8. Your Rights (GDPR)",
        body: `Under the General Data Protection Regulation (GDPR — EU 2016/679), you have the following rights:\n\n• Right of access: obtain a copy of the data we hold about you.\n• Right to rectification: correct inaccurate or incomplete data.\n• Right to erasure: request deletion of your data (subject to legal obligations).\n• Right to data portability: receive your data in a structured, machine-readable format.\n• Right to object: object to the processing of your data.\n• Right to restriction: request suspension of processing.\n\nTo exercise your rights, contact us at the address provided in Article 14. We will respond within 30 days.`,
      },
      {
        heading: "9. Limitation of Liability",
        body: `To the extent permitted by applicable law, Borivon.com shall not be liable for:\n\n• Indirect, consequential, or intangible losses or damages resulting from the use or inability to use the Portal.\n• Service interruptions caused by circumstances beyond our control (force majeure, technical provider outages, cyberattacks, etc.).\n• Data breaches resulting from malicious third-party actions despite implemented security measures.\n• Inaccuracies in documents provided by the candidate themselves.\n\nBorivon.com's total liability, regardless of cause, is limited to the amount actually paid by the user for the relevant services in the 12 months preceding the event giving rise to liability, or €100 if no payment was made.`,
      },
      {
        heading: "10. Intellectual Property",
        body: `All content, interfaces, designs, logos, text, and features of the Portal are the exclusive property of Borivon.com and are protected by intellectual property laws. Any unauthorized reproduction, modification, or use is strictly prohibited.`,
      },
      {
        heading: "11. Service Availability",
        body: `Borivon.com endeavors to ensure continuous availability of the Portal but does not guarantee uninterrupted access. Maintenance may be carried out with or without prior notice. In the event of prolonged unavailability, we will make every effort to inform you.`,
      },
      {
        heading: "12. Changes to These Terms",
        body: `Borivon.com reserves the right to modify these terms at any time. Changes take effect upon publication on the Portal. Your continued use of the Portal after notification of changes constitutes your acceptance of the new terms. You are responsible for reviewing this page regularly.`,
      },
      {
        heading: "13. Governing Law and Jurisdiction",
        body: `These terms are governed by the law applicable in the country where Borivon.com is established. In the event of a dispute, the parties will endeavor to find an amicable resolution. Failing that, the dispute will be submitted to the competent courts.`,
      },
      {
        heading: "14. Contact",
        body: `For any questions regarding these terms, your personal data, or to exercise your rights, you may contact us through the Borivon.com website or directly by email at the official contact address indicated on the site.`,
      },
    ],
  },
  de: {
    title: "Allgemeine Geschäftsbedingungen & Datenschutzerklärung",
    subtitle: "Borivon.com — Bewerberportal",
    updated: `Zuletzt aktualisiert: ${LAST_UPDATED}`,
    sections: [
      {
        heading: "1. Akzeptanz der Bedingungen",
        body: `Durch die Erstellung eines Kontos und die Nutzung des Bewerberportals von Borivon.com (nachfolgend „das Portal") akzeptieren Sie diese Allgemeinen Geschäftsbedingungen vollständig und vorbehaltlos. Wenn Sie diesen Bedingungen nicht zustimmen, dürfen Sie das Portal nicht nutzen.`,
      },
      {
        heading: "2. Wer wir sind",
        body: `Borivon.com ist eine Plattform, die auf die Unterstützung von Gesundheitsfachkräften im Bewerbungsprozess spezialisiert ist. Das Portal ist ein sicheres Werkzeug, das es Bewerbern ermöglicht, ihre Bewerbungsunterlagen einzureichen und zu verfolgen.`,
      },
      {
        heading: "3. Erhobene Daten",
        body: `Im Rahmen Ihrer Nutzung des Portals erheben wir folgende Daten:\n\n• Identifikationsdaten: Vorname, Nachname, E-Mail-Adresse, Passwort (gehasht und nicht lesbar).\n• Bewerbungsunterlagen: Lebenslauf, Diplome, Sprachzertifikate, Zeugnisse, Berufsdokumente und alle anderen Dokumente, die Sie hochladen.\n• Verbindungsdaten: IP-Adresse, Browser-Typ, Datum und Uhrzeit des Zugriffs, zu Sicherheits- und Prüfzwecken.`,
      },
      {
        heading: "4. Zweck der Datenverarbeitung",
        body: `Ihre persönlichen Daten und Dokumente werden ausschließlich zu folgenden Zwecken erhoben und verarbeitet:\n\n• Bewertung Ihrer Bewerbung durch das Borivon.com-Team und autorisierte Partneragenten.\n• Kommunikation mit Ihnen über den Stand Ihrer Bewerbung.\n• Einhaltung geltender gesetzlicher und behördlicher Verpflichtungen.\n\nIhre Daten werden unter keinen Umständen für Werbung, kommerzielles Profiling oder andere in diesem Dokument nicht genannte Zwecke verwendet.`,
      },
      {
        heading: "5. Weitergabe von Daten an Dritte",
        body: `Borivon.com verkauft, vermietet oder überträgt Ihre persönlichen Daten niemals zu kommerziellen Zwecken an Dritte.\n\nIhre Daten können nur in folgenden Fällen weitergegeben werden:\n\n• Partnerrekrutierungsagenten, die ausdrücklich von Borivon.com beauftragt wurden und strengen Vertraulichkeitspflichten unterliegen, ausschließlich zum Zweck der Bewertung Ihrer Bewerbung.\n• Technische Dienstleister (Hosting, sichere Speicherung), die unter DSGVO-konformen Auftragsverarbeitungsverträgen tätig sind.\n• Zuständige Behörden, sofern dies gesetzlich ausdrücklich vorgeschrieben ist.\n\nJeder Zugang Dritter zu Ihren Daten ist streng auf das für den erklärten Zweck Notwendige beschränkt.`,
      },
      {
        heading: "6. Datensicherheit",
        body: `Borivon.com setzt angemessene technische und organisatorische Sicherheitsmaßnahmen um, um Ihre Daten vor unbefugtem Zugriff, Verlust, Veränderung oder Offenlegung zu schützen, darunter:\n\n• Verschlüsselte Kommunikation (HTTPS/TLS).\n• Sichere Passwortspeicherung durch kryptografisches Hashing.\n• Strenge Zugangskontrolle zu Bewerberdaten.\n• Hosting auf sicheren Infrastrukturen (Supabase, Vercel).\n\nKein Sicherheitssystem ist jedoch unfehlbar. Im Falle einer Datenpanne, die außerhalb der angemessenen Kontrolle von Borivon.com liegt, ist unsere Haftung gemäß Artikel 9 beschränkt.`,
      },
      {
        heading: "7. Datenspeicherung",
        body: `Ihre Daten werden für die zur Bewertung Ihrer Bewerbung erforderliche Dauer und darüber hinaus für maximal 24 Monate ab dem Datum Ihrer letzten Aktivität im Portal aufbewahrt, sofern keine gesetzlich längere Aufbewahrungspflicht besteht.\n\nNach Ablauf dieser Frist werden Ihre Daten sicher gelöscht oder anonymisiert.`,
      },
      {
        heading: "8. Ihre Rechte (DSGVO)",
        body: `Gemäß der Datenschutz-Grundverordnung (DSGVO — EU 2016/679) haben Sie folgende Rechte:\n\n• Auskunftsrecht: Erhalt einer Kopie der über Sie gespeicherten Daten.\n• Berichtigungsrecht: Korrektur unrichtiger oder unvollständiger Daten.\n• Löschungsrecht: Beantragung der Löschung Ihrer Daten (vorbehaltlich gesetzlicher Verpflichtungen).\n• Recht auf Datenübertragbarkeit: Empfang Ihrer Daten in einem strukturierten, maschinenlesbaren Format.\n• Widerspruchsrecht: Widerspruch gegen die Verarbeitung Ihrer Daten.\n• Recht auf Einschränkung der Verarbeitung: Beantragung der Aussetzung der Verarbeitung.\n\nZur Ausübung Ihrer Rechte kontaktieren Sie uns unter der in Artikel 14 angegebenen Adresse. Wir werden innerhalb von 30 Tagen antworten.`,
      },
      {
        heading: "9. Haftungsbeschränkung",
        body: `Soweit nach geltendem Recht zulässig, haftet Borivon.com nicht für:\n\n• Mittelbare, Folge- oder immaterielle Schäden, die aus der Nutzung oder Nichtnutzbarkeit des Portals resultieren.\n• Dienstunterbrechungen aufgrund von Umständen außerhalb unserer Kontrolle (höhere Gewalt, Ausfälle technischer Dienstleister, Cyberangriffe usw.).\n• Datenpannen, die auf böswillige Handlungen Dritter trotz implementierter Sicherheitsmaßnahmen zurückzuführen sind.\n• Unrichtigkeiten in den vom Bewerber selbst bereitgestellten Dokumenten.\n\nDie Gesamthaftung von Borivon.com ist unabhängig von der Ursache auf den vom Nutzer für die betreffenden Dienste in den 12 Monaten vor dem haftungsauslösenden Ereignis tatsächlich gezahlten Betrag oder auf 100 € beschränkt, falls kein Zahlungsvorgang stattgefunden hat.`,
      },
      {
        heading: "10. Geistiges Eigentum",
        body: `Alle Inhalte, Benutzeroberflächen, Designs, Logos, Texte und Funktionen des Portals sind ausschließliches Eigentum von Borivon.com und durch Gesetze zum Schutz des geistigen Eigentums geschützt. Jede unbefugte Vervielfältigung, Änderung oder Nutzung ist strengstens untersagt.`,
      },
      {
        heading: "11. Serviceverfügbarkeit",
        body: `Borivon.com ist bestrebt, eine kontinuierliche Verfügbarkeit des Portals sicherzustellen, garantiert jedoch keinen ununterbrochenen Zugang. Wartungsarbeiten können mit oder ohne vorherige Ankündigung durchgeführt werden. Im Falle einer längeren Nichtverfügbarkeit werden wir uns nach besten Kräften bemühen, Sie zu informieren.`,
      },
      {
        heading: "12. Änderungen dieser Bedingungen",
        body: `Borivon.com behält sich das Recht vor, diese Bedingungen jederzeit zu ändern. Änderungen treten mit ihrer Veröffentlichung im Portal in Kraft. Ihre weitere Nutzung des Portals nach Bekanntgabe von Änderungen gilt als Akzeptanz der neuen Bedingungen. Sie sind dafür verantwortlich, diese Seite regelmäßig zu überprüfen.`,
      },
      {
        heading: "13. Anwendbares Recht und Gerichtsstand",
        body: `Diese Bedingungen unterliegen dem in dem Land, in dem Borivon.com ansässig ist, geltenden Recht. Bei Streitigkeiten werden die Parteien versuchen, eine einvernehmliche Lösung zu finden. Gelingt dies nicht, wird der Streit den zuständigen Gerichten vorgelegt.`,
      },
      {
        heading: "14. Kontakt",
        body: `Bei Fragen zu diesen Bedingungen, Ihren persönlichen Daten oder zur Ausübung Ihrer Rechte können Sie uns über die Borivon.com-Website oder direkt per E-Mail unter der auf der Website angegebenen offiziellen Kontaktadresse erreichen.`,
      },
    ],
  },
};

export default function TermsPage() {
  const router = useRouter();
  const { lang } = useLang();
  const c = content[lang];

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
          <p className="text-xs leading-relaxed" style={{ color: "var(--gold)" }}>
            {lang === "fr" && "Ce document régit votre utilisation du Portail Candidat Borivon.com et décrit comment vos données personnelles sont collectées, utilisées et protégées. Lisez-le attentivement avant d'utiliser nos services."}
            {lang === "en" && "This document governs your use of the Borivon.com Candidate Portal and describes how your personal data is collected, used, and protected. Please read it carefully before using our services."}
            {lang === "de" && "Dieses Dokument regelt Ihre Nutzung des Borivon.com Bewerberportals und beschreibt, wie Ihre persönlichen Daten erhoben, verwendet und geschützt werden. Bitte lesen Sie es sorgfältig, bevor Sie unsere Dienste nutzen."}
          </p>
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
            © {new Date().getFullYear()} Borivon.com — {lang === "fr" ? "Tous droits réservés." : lang === "de" ? "Alle Rechte vorbehalten." : "All rights reserved."}
          </p>
        </div>

      </div>
    </main>
  );
}
