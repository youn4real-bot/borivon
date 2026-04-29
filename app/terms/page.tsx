"use client";

import { useRouter } from "next/navigation";
import { useLang } from "@/components/LangContext";

const LAST_UPDATED = "28 April 2026";

const content = {
  fr: {
    title: "Conditions Générales d'Utilisation",
    subtitle: "Borivon.com",
    updated: `Dernière mise à jour : ${LAST_UPDATED}`,
    intro: "En accédant au site Borivon.com et en utilisant nos services, vous acceptez pleinement et sans réserve les présentes Conditions Générales d'Utilisation. Si vous n'acceptez pas ces conditions, veuillez ne pas utiliser nos services.",
    sections: [
      {
        heading: "1. Présentation de la société",
        body: `Borivon est une plateforme internationale exploitée par Germeds LLC, société à responsabilité limitée enregistrée aux États-Unis d'Amérique. Germeds LLC est l'unique responsable du traitement de toutes les données personnelles traitées via cette plateforme.\nE-mail : contact@borivon.com`,
      },
      {
        heading: "2. Services proposés",
        body: `Borivon propose des services de formation linguistique, de coaching, de conseil et de mobilité professionnelle à des particuliers et des organisations dans le monde entier, incluant notamment des programmes linguistiques en entreprise, un accompagnement de carrière, du conseil documentaire et un soutien à l'accompagnement de candidats.`,
      },
      {
        heading: "3. Conditions d'accès et d'utilisation",
        body: `L'accès au site Borivon.com est gratuit et ouvert à toute personne. L'utilisation du Portail Candidat nécessite la création d'un compte.\n\nVous vous engagez à :\n\n• Fournir des informations exactes, complètes et à jour lors de la création de votre compte et du dépôt de documents.\n• Ne pas utiliser le site à des fins illégales, frauduleuses ou contraires aux présentes conditions.\n• Ne pas tenter d'accéder à des parties du site pour lesquelles vous n'avez pas d'autorisation.\n• Ne pas transmettre de contenu nuisible, diffamatoire, obscène ou portant atteinte aux droits de tiers.\n• Maintenir la confidentialité de vos identifiants de connexion.`,
      },
      {
        heading: "4. Propriété intellectuelle",
        body: `L'ensemble des contenus du site Borivon.com — y compris, sans s'y limiter, les textes, images, logos, interfaces, designs, fonctionnalités, logiciels et base de données — est la propriété exclusive de Borivon.com et est protégé par les lois en vigueur sur la propriété intellectuelle.\n\nToute reproduction, représentation, modification, publication ou adaptation, totale ou partielle, de l'un quelconque de ces éléments sans autorisation préalable et écrite de Borivon.com est strictement interdite et constitue une contrefaçon.`,
      },
      {
        heading: "5. Prix et paiement",
        body: `Les tarifs de nos services sont communiqués sur demande ou affichés sur le site. Les prix sont généralement exprimés en Euros (EUR) ou en Dollars américains (USD). D'autres devises peuvent être acceptées sur demande.\n\nLe paiement s'effectue selon les modalités convenues lors de la commande. Tout acompte versé est ferme et définitif, sauf disposition contraire mentionnée dans la politique de remboursement.`,
      },
      {
        heading: "6. Limitation de responsabilité",
        body: `Dans les limites permises par la loi :\n\n• Borivon.com s'efforce d'assurer l'exactitude des informations publiées sur le site, mais ne peut garantir leur exhaustivité ou leur actualité.\n• Borivon.com ne saurait être tenu responsable des dommages directs ou indirects résultant de l'utilisation ou de l'impossibilité d'utiliser le site.\n• Borivon.com n'est pas responsable des interruptions de service dues à des causes indépendantes de sa volonté (force majeure, pannes techniques, attaques informatiques).\n• Les résultats des cours de langue et des processus de candidature dépendent d'un grand nombre de facteurs. Borivon.com ne garantit pas l'obtention d'un certificat, d'un visa, d'un permis de travail ou d'un emploi.`,
      },
      {
        heading: "7. Liens hypertextes",
        body: `Le site peut contenir des liens vers des sites tiers. Ces liens sont fournis à titre informatif. Borivon.com ne contrôle pas le contenu de ces sites et décline toute responsabilité quant aux dommages pouvant résulter de leur consultation.`,
      },
      {
        heading: "8. Données personnelles",
        body: `Le traitement de vos données personnelles est régi par notre Politique de Confidentialité, accessible à l'adresse /privacy-policy. Cette politique fait partie intégrante des présentes conditions.`,
      },
      {
        heading: "9. Cookies",
        body: `L'utilisation des cookies sur Borivon.com est régie par notre politique de cookies, accessible et modifiable via le lien « Paramètres des cookies » au bas de chaque page.`,
      },
      {
        heading: "10. Modification des conditions",
        body: `Borivon.com se réserve le droit de modifier les présentes conditions à tout moment. Toute modification entre en vigueur dès sa publication sur le site. Votre utilisation continue du site après la publication de modifications vaut acceptation des nouvelles conditions.`,
      },
      {
        heading: "11. Résiliation",
        body: `Borivon.com se réserve le droit de suspendre ou de résilier l'accès au site ou au Portail pour tout utilisateur qui ne respecterait pas les présentes conditions, et ce sans préavis ni indemnité.`,
      },
      {
        heading: "12. Droit applicable et juridiction",
        body: `Les présentes conditions sont régies par le droit applicable. En cas de litige, les parties s'efforceront de parvenir à un règlement amiable. À défaut, le litige sera soumis aux juridictions compétentes.`,
      },
      {
        heading: "13. Contact",
        body: `Pour toute question relative aux présentes conditions :\nE-mail : contact@borivon.com`,
      },
    ],
  },
  en: {
    title: "Terms & Conditions",
    subtitle: "Borivon.com",
    updated: `Last updated: ${LAST_UPDATED}`,
    intro: "By accessing Borivon.com and using our services, you fully and unconditionally accept these Terms & Conditions. If you do not agree, please do not use our services.",
    sections: [
      {
        heading: "1. Company Overview",
        body: `Borivon is an international platform operated by Germeds LLC, a limited liability company registered in the United States of America. Germeds LLC is the sole data controller for all personal data processed through this platform.\nEmail: contact@borivon.com`,
      },
      {
        heading: "2. Services Offered",
        body: `Borivon provides language training, coaching, consulting, and professional mobility services to individuals and organisations globally, including but not limited to corporate language programs, career guidance, document consulting, and candidate placement support.`,
      },
      {
        heading: "3. Access and Use Conditions",
        body: `Access to Borivon.com is free and open to all. Use of the Candidate Portal requires account creation.\n\nYou agree to:\n\n• Provide accurate, complete and up-to-date information when creating your account and submitting documents.\n• Not use the site for illegal, fraudulent, or improper purposes.\n• Not attempt to access parts of the site for which you are not authorised.\n• Not transmit harmful, defamatory, obscene, or rights-infringing content.\n• Keep your login credentials confidential.`,
      },
      {
        heading: "4. Intellectual Property",
        body: `All content on Borivon.com — including but not limited to texts, images, logos, interfaces, designs, features, software, and databases — is the exclusive property of Borivon.com and is protected by applicable intellectual property laws.\n\nAny reproduction, representation, modification, publication, or adaptation, in whole or in part, of any such elements without the prior written consent of Borivon.com is strictly prohibited and constitutes an infringement.`,
      },
      {
        heading: "5. Pricing and Payment",
        body: `Service prices are communicated on request or displayed on the site. Prices are generally expressed in Euros (EUR) or US Dollars (USD). Other currencies may be accepted on request.\n\nPayment is made according to the terms agreed at the time of purchase. Any deposit paid is firm and non-refundable except as stated in the Refund Policy.`,
      },
      {
        heading: "6. Limitation of Liability",
        body: `To the extent permitted by law:\n\n• Borivon.com endeavours to ensure the accuracy of information published on the site but cannot guarantee its completeness or currency.\n• Borivon.com shall not be liable for direct or indirect damages resulting from the use or inability to use the site.\n• Borivon.com is not responsible for service interruptions caused by circumstances beyond its control (force majeure, technical failures, cyberattacks).\n• The outcomes of language courses and application processes depend on many factors. Borivon.com does not guarantee the award of a certificate, visa, work permit, or employment.`,
      },
      {
        heading: "7. Hyperlinks",
        body: `The site may contain links to third-party sites. These links are provided for information purposes only. Borivon.com does not control the content of these sites and accepts no liability for any damage resulting from their use.`,
      },
      {
        heading: "8. Personal Data",
        body: `The processing of your personal data is governed by our Privacy Policy, available at /privacy-policy. This policy forms an integral part of these Terms & Conditions.`,
      },
      {
        heading: "9. Cookies",
        body: `The use of cookies on Borivon.com is governed by our cookie policy, accessible and adjustable via the "Cookie Settings" link at the bottom of each page.`,
      },
      {
        heading: "10. Changes to Terms",
        body: `Borivon.com reserves the right to modify these terms at any time. Changes take effect upon publication on the site. Your continued use of the site after publication of changes constitutes acceptance of the new terms.`,
      },
      {
        heading: "11. Termination",
        body: `Borivon.com reserves the right to suspend or terminate access to the site or Portal for any user who fails to comply with these terms, without notice or compensation.`,
      },
      {
        heading: "12. Governing Law and Jurisdiction",
        body: `These terms are governed by applicable law. In case of dispute, the parties will endeavour to reach an amicable resolution. Failing that, the dispute will be submitted to the competent courts.`,
      },
      {
        heading: "13. Contact",
        body: `For any questions regarding these terms:\nEmail: contact@borivon.com`,
      },
    ],
  },
  de: {
    title: "Allgemeine Geschäftsbedingungen",
    subtitle: "Borivon.com",
    updated: `Zuletzt aktualisiert: ${LAST_UPDATED}`,
    intro: "Durch den Zugriff auf Borivon.com und die Nutzung unserer Dienste akzeptieren Sie diese Allgemeinen Geschäftsbedingungen vollständig und vorbehaltlos. Wenn Sie nicht einverstanden sind, nutzen Sie bitte unsere Dienste nicht.",
    sections: [
      {
        heading: "1. Unternehmensübersicht",
        body: `Borivon ist eine internationale Plattform, betrieben von Germeds LLC, einer in den Vereinigten Staaten von Amerika eingetragenen Gesellschaft mit beschränkter Haftung. Germeds LLC ist der alleinige Verantwortliche für alle über diese Plattform verarbeiteten personenbezogenen Daten.\nE-Mail: contact@borivon.com`,
      },
      {
        heading: "2. Angebotene Dienste",
        body: `Borivon bietet Sprachtraining, Coaching, Beratung und professionelle Mobilitätsdienstleistungen für Privatpersonen und Organisationen weltweit an, einschließlich, aber nicht beschränkt auf Unternehmenssprachprogramme, Karrierebegleitung, Dokumentenberatung und Kandidatenbegleitung.`,
      },
      {
        heading: "3. Zugangs- und Nutzungsbedingungen",
        body: `Der Zugang zu Borivon.com ist kostenlos und für alle offen. Die Nutzung des Bewerberportals erfordert die Erstellung eines Kontos.\n\nSie verpflichten sich:\n\n• Bei der Kontoerstellung und Einreichung von Dokumenten genaue, vollständige und aktuelle Angaben zu machen.\n• Die Website nicht für illegale, betrügerische oder unsachgemäße Zwecke zu nutzen.\n• Nicht zu versuchen, auf Teile der Website zuzugreifen, für die Sie keine Berechtigung haben.\n• Keine schädlichen, diffamierenden, obszönen oder rechtsverletzenden Inhalte zu übermitteln.\n• Ihre Zugangsdaten vertraulich zu behandeln.`,
      },
      {
        heading: "4. Geistiges Eigentum",
        body: `Alle Inhalte auf Borivon.com — einschließlich, aber nicht beschränkt auf Texte, Bilder, Logos, Benutzeroberflächen, Designs, Funktionen, Software und Datenbanken — sind ausschließliches Eigentum von Borivon.com und durch anwendbare Gesetze zum Schutz des geistigen Eigentums geschützt.\n\nJede Vervielfältigung, Darstellung, Änderung, Veröffentlichung oder Anpassung, ganz oder teilweise, dieser Elemente ohne vorherige schriftliche Genehmigung von Borivon.com ist strengstens untersagt und stellt eine Rechtsverletzung dar.`,
      },
      {
        heading: "5. Preise und Zahlung",
        body: `Servicepreise werden auf Anfrage mitgeteilt oder auf der Website angezeigt. Preise werden in der Regel in Euro (EUR) oder US-Dollar (USD) angegeben. Andere Währungen können auf Anfrage akzeptiert werden.\n\nDie Zahlung erfolgt gemäß den zum Zeitpunkt der Bestellung vereinbarten Bedingungen. Geleistete Anzahlungen sind verbindlich und nicht erstattungsfähig, sofern in der Rückerstattungsrichtlinie nichts anderes angegeben ist.`,
      },
      {
        heading: "6. Haftungsbeschränkung",
        body: `Soweit gesetzlich zulässig:\n\n• Borivon.com ist bestrebt, die Richtigkeit der auf der Website veröffentlichten Informationen zu gewährleisten, kann jedoch deren Vollständigkeit oder Aktualität nicht garantieren.\n• Borivon.com haftet nicht für direkte oder indirekte Schäden, die aus der Nutzung oder Nichtnutzbarkeit der Website entstehen.\n• Borivon.com ist nicht verantwortlich für Dienstunterbrechungen aufgrund von Umständen außerhalb ihrer Kontrolle (höhere Gewalt, technische Ausfälle, Cyberangriffe).\n• Die Ergebnisse von Sprachkursen und Bewerbungsverfahren hängen von vielen Faktoren ab. Borivon.com garantiert nicht die Erlangung eines Zertifikats, Visums, einer Arbeitserlaubnis oder einer Beschäftigung.`,
      },
      {
        heading: "7. Hyperlinks",
        body: `Die Website kann Links zu Drittanbieter-Websites enthalten. Diese Links dienen nur zu Informationszwecken. Borivon.com kontrolliert den Inhalt dieser Websites nicht und übernimmt keine Haftung für Schäden, die aus ihrer Nutzung entstehen.`,
      },
      {
        heading: "8. Personenbezogene Daten",
        body: `Die Verarbeitung Ihrer personenbezogenen Daten unterliegt unserer Datenschutzerklärung, die unter /privacy-policy abrufbar ist. Diese Richtlinie ist integraler Bestandteil dieser AGB.`,
      },
      {
        heading: "9. Cookies",
        body: `Die Verwendung von Cookies auf Borivon.com unterliegt unserer Cookie-Richtlinie, die über den Link „Cookie-Einstellungen" am Ende jeder Seite aufgerufen und angepasst werden kann.`,
      },
      {
        heading: "10. Änderung der Bedingungen",
        body: `Borivon.com behält sich das Recht vor, diese Bedingungen jederzeit zu ändern. Änderungen treten mit ihrer Veröffentlichung auf der Website in Kraft. Ihre weitere Nutzung der Website nach Veröffentlichung von Änderungen gilt als Akzeptanz der neuen Bedingungen.`,
      },
      {
        heading: "11. Kündigung",
        body: `Borivon.com behält sich das Recht vor, den Zugang zur Website oder zum Portal für jeden Nutzer, der diese Bedingungen nicht einhält, ohne Vorankündigung oder Entschädigung auszusetzen oder zu beenden.`,
      },
      {
        heading: "12. Anwendbares Recht und Gerichtsstand",
        body: `Diese Bedingungen unterliegen dem anwendbaren Recht. Bei Streitigkeiten werden die Parteien eine einvernehmliche Lösung anstreben. Gelingt dies nicht, wird der Streit den zuständigen Gerichten vorgelegt.`,
      },
      {
        heading: "13. Kontakt",
        body: `Bei Fragen zu diesen Bedingungen:\nE-Mail: contact@borivon.com`,
      },
    ],
  },
};

export default function TermsPage() {
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
