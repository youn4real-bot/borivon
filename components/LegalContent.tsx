import type { Lang } from "@/lib/translations";

const H = ({ children, first }: { children: React.ReactNode; first?: boolean }) => (
  <h3 className={`legal-head text-[1.05rem] font-semibold tracking-[-0.01em] ${first ? "mt-0" : "mt-7"} mb-2`}>
    {children}
  </h3>
);

const A = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a href={href} className="bv-link">{children}</a>
);

export function PrivacyContent({ lang }: { lang: Lang }) {
  const l = lang;

  const content = {
    fr: (
      <div className="legal-body text-[0.875rem] leading-[1.85] space-y-0">
        <H first>1. Responsable du traitement</H>
        <p className="mb-4"><strong className="legal-head font-semibold">Borivon.com</strong> est une plateforme internationale exploitée par Germeds LLC, société à responsabilité limitée enregistrée aux États-Unis d&apos;Amérique. Germeds LLC est l&apos;unique responsable du traitement de toutes les données personnelles traitées via cette plateforme.</p>
        <p className="mb-4">E-mail : <A href="mailto:contact@borivon.com">contact@borivon.com</A></p>

        <H>2. Données collectées</H>
        <p className="mb-4">Nous collectons des données personnelles et professionnelles auprès de tous les utilisateurs, incluant notamment : nom complet, date de naissance, nationalité, adresse e-mail, numéro de téléphone et documents d&apos;identité délivrés par les autorités compétentes. Les candidats peuvent également soumettre des CV, diplômes et documents liés à leur visa. Des informations de paiement peuvent être collectées pour le traitement des transactions. Nous collectons également automatiquement des données telles que : adresse IP, type d&apos;appareil, navigateur et pages visitées.</p>

        <H>3. Finalités et bases légales du traitement</H>
        <ul className="mb-4 ml-[1.1rem] space-y-1 list-disc">
          <li><strong className="legal-head font-semibold">Fourniture des services</strong> (exécution du contrat) : traitement des demandes, gestion du compte Portail, suivi de candidature.</li>
          <li><strong className="legal-head font-semibold">Amélioration des services</strong> (intérêt légitime) : analyse anonymisée du trafic.</li>
          <li><strong className="legal-head font-semibold">Communication</strong> (intérêt légitime / consentement) : réponse aux demandes et informations dossier.</li>
          <li><strong className="legal-head font-semibold">Conformité légale</strong> (obligation légale) : conservation des données requises.</li>
          <li><strong className="legal-head font-semibold">Marketing</strong> (consentement) : uniquement si vous y avez expressément consenti.</li>
        </ul>

        <H>4. Partage des données</H>
        <p className="mb-2">Borivon.com ne vend ni ne loue vos données personnelles. Elles peuvent être partagées uniquement avec :</p>
        <ul className="mb-4 ml-[1.1rem] space-y-1 list-disc">
          <li>Prestataires techniques mandatés (Vercel, Supabase, Google Drive) sous contrats conformes au RGPD.</li>
          <li>Agents partenaires autorisés, dans le strict cadre de l&apos;évaluation de votre candidature, liés par des obligations de confidentialité.</li>
          <li>Autorités compétentes, lorsque la loi l&apos;exige.</li>
        </ul>
        <p className="mb-4">Tout transfert hors de l&apos;EEE est encadré par des garanties appropriées (clauses contractuelles types, décisions d&apos;adéquation).</p>

        <H>5. Durée de conservation</H>
        <p className="mb-4">Nous conservons les données personnelles aussi longtemps que nécessaire pour atteindre les finalités pour lesquelles elles ont été collectées, y compris pour satisfaire à toute obligation légale, comptable ou de déclaration. En l&apos;absence d&apos;exigence légale de conservation spécifique, nous appliquons le principe de limitation de la conservation fondé sur la nécessité légitime de l&apos;activité. Les données anonymisées et agrégées peuvent être conservées indéfiniment car elles ne constituent plus des données personnelles au sens du droit applicable. Vous pouvez demander la suppression de vos données personnelles à tout moment, sous réserve de nos obligations légales et de notre intérêt légitime à conserver certains enregistrements.</p>

        <H>6. Sécurité des données</H>
        <ul className="mb-4 ml-[1.1rem] space-y-1 list-disc">
          <li>Chiffrement des transmissions (HTTPS/TLS).</li>
          <li>Stockage des mots de passe par hachage cryptographique (bcrypt).</li>
          <li>Contrôle d&apos;accès strict avec authentification forte.</li>
          <li>Hébergement sur infrastructures certifiées (Vercel, Supabase).</li>
          <li>Revues de sécurité régulières.</li>
        </ul>

        <H>7. Vos droits (RGPD)</H>
        <ul className="mb-4 ml-[1.1rem] space-y-1 list-disc">
          <li>Droit d&apos;accès (Art. 15) — obtenir une copie de vos données.</li>
          <li>Droit de rectification (Art. 16) — corriger des données inexactes.</li>
          <li>Droit à l&apos;effacement (Art. 17) — « droit à l&apos;oubli ».</li>
          <li>Droit à la portabilité (Art. 20) — format structuré et lisible.</li>
          <li>Droit d&apos;opposition (Art. 21) — traitement fondé sur intérêt légitime.</li>
          <li>Droit à la limitation — suspension temporaire du traitement.</li>
          <li>Droit de retrait du consentement (Art. 7).</li>
        </ul>
        <p className="mb-4">Exercice des droits : <A href="mailto:contact@borivon.com">contact@borivon.com</A> — réponse sous 30 jours calendaires.</p>

        <H>8. Cookies et traceurs</H>
        <ul className="mb-4 ml-[1.1rem] space-y-1 list-disc">
          <li><strong className="legal-head font-semibold">Cookies essentiels</strong> : nécessaires au fonctionnement, toujours actifs.</li>
          <li><strong className="legal-head font-semibold">Cookies analytiques</strong> : données agrégées sur l&apos;utilisation (avec consentement).</li>
          <li><strong className="legal-head font-semibold">Cookies publicitaires</strong> : personnalisation des annonces, incl. Meta Pixel (avec consentement).</li>
        </ul>
        <p className="mb-4">Gérez vos préférences via le lien « Paramètres des cookies » en bas de page.</p>

        <H>9. Modifications de la politique</H>
        <p className="mb-4">Nous nous réservons le droit de modifier cette politique à tout moment. La version mise à jour est publiée sur cette page avec une nouvelle date de révision. En cas de modifications substantielles, vous serez informé par e-mail ou via un avis visible sur le site.</p>

        <H>10. Contact et réclamations</H>
        <p className="mb-4">Pour toute question ou pour exercer vos droits : <A href="mailto:contact@borivon.com">contact@borivon.com</A></p>
        <p className="legal-muted mt-6 text-[0.78rem] italic">Dernière mise à jour : 28 avril 2026</p>
      </div>
    ),
    en: (
      <div className="legal-body text-[0.875rem] leading-[1.85] space-y-0">
        <H first>1. Data Controller</H>
        <p className="mb-4"><strong className="legal-head font-semibold">Borivon.com</strong> is an international platform operated by Germeds LLC, a limited liability company registered in the United States of America. Germeds LLC is the sole data controller for all personal data processed through this platform.</p>
        <p className="mb-4">Email: <A href="mailto:contact@borivon.com">contact@borivon.com</A></p>

        <H>2. Data We Collect</H>
        <p className="mb-4">We collect personal and professional data from all users, including but not limited to: full name, date of birth, nationality, email address, phone number, and government-issued identification documents. Candidates may also submit CVs, educational certificates, and visa-related documents. Payment information may be collected to process transactions. We also automatically collect data such as IP address, device type, browser, and pages visited.</p>

        <H>3. Purposes and Legal Bases for Processing</H>
        <ul className="mb-4 ml-[1.1rem] space-y-1 list-disc">
          <li><strong className="legal-head font-semibold">Service provision</strong> (contract performance): processing enquiries, managing your Portal account, tracking your application.</li>
          <li><strong className="legal-head font-semibold">Service improvement</strong> (legitimate interest): anonymised analysis of site traffic and behaviour.</li>
          <li><strong className="legal-head font-semibold">Communication</strong> (legitimate interest / consent): responding to enquiries and sending application updates.</li>
          <li><strong className="legal-head font-semibold">Legal compliance</strong> (legal obligation): retaining data as required by applicable regulations.</li>
          <li><strong className="legal-head font-semibold">Marketing</strong> (consent): only if you have expressly consented via our cookie management tool.</li>
        </ul>

        <H>4. Data Sharing</H>
        <p className="mb-2">Borivon.com does not sell or rent your personal data. It may only be shared with:</p>
        <ul className="mb-4 ml-[1.1rem] space-y-1 list-disc">
          <li>Mandated technical providers (Vercel, Supabase, Google Drive) under GDPR-compliant contracts.</li>
          <li>Authorised partner agents, strictly for evaluating your application, bound by confidentiality obligations.</li>
          <li>Competent authorities, where expressly required by law.</li>
        </ul>
        <p className="mb-4">Any transfer outside the European Economic Area is governed by appropriate safeguards (standard contractual clauses, adequacy decisions).</p>

        <H>5. Retention Periods</H>
        <p className="mb-4">We retain personal data for as long as necessary to fulfill the purposes for which it was collected, including for the purposes of satisfying any legal, accounting, or reporting requirements. Where there is no specific legal retention requirement, we apply the principle of storage limitation based on legitimate business necessity. Anonymised and aggregated data may be retained indefinitely as it no longer constitutes personal data under applicable law. You may request deletion of your personal data at any time, subject to our legal obligations and legitimate interests in retaining certain records.</p>

        <H>6. Data Security</H>
        <ul className="mb-4 ml-[1.1rem] space-y-1 list-disc">
          <li>Encrypted transmissions (HTTPS/TLS).</li>
          <li>Password storage via cryptographic hashing (bcrypt).</li>
          <li>Strict access controls with strong authentication.</li>
          <li>Hosting on certified infrastructures (Vercel, Supabase).</li>
          <li>Regular security reviews.</li>
        </ul>

        <H>7. Your Rights (GDPR)</H>
        <ul className="mb-4 ml-[1.1rem] space-y-1 list-disc">
          <li>Right of access (Art. 15) — obtain a copy of your personal data.</li>
          <li>Right to rectification (Art. 16) — have inaccurate data corrected.</li>
          <li>Right to erasure (Art. 17) — &quot;right to be forgotten&quot;.</li>
          <li>Right to portability (Art. 20) — structured, machine-readable format.</li>
          <li>Right to object (Art. 21) — processing based on legitimate interest.</li>
          <li>Right to restriction — temporary suspension of processing.</li>
          <li>Right to withdraw consent (Art. 7).</li>
        </ul>
        <p className="mb-4">To exercise your rights: <A href="mailto:contact@borivon.com">contact@borivon.com</A> — response within 30 calendar days.</p>

        <H>8. Cookies and Trackers</H>
        <ul className="mb-4 ml-[1.1rem] space-y-1 list-disc">
          <li><strong className="legal-head font-semibold">Essential cookies</strong>: required for the site to function, always active.</li>
          <li><strong className="legal-head font-semibold">Analytics cookies</strong>: aggregated usage data (with your consent).</li>
          <li><strong className="legal-head font-semibold">Advertising cookies</strong>: ad personalisation incl. Meta Pixel (with your consent).</li>
        </ul>
        <p className="mb-4">Manage your preferences at any time via the &quot;Cookie Settings&quot; link at the bottom of the page.</p>

        <H>9. Policy Changes</H>
        <p className="mb-4">We reserve the right to modify this policy at any time. The updated version is published on this page with a new revision date. In case of significant changes, we will inform you by email or through a visible notice on the site.</p>

        <H>10. Contact and Complaints</H>
        <p className="mb-4">For any questions or to exercise your rights: <A href="mailto:contact@borivon.com">contact@borivon.com</A></p>
        <p className="legal-muted mt-6 text-[0.78rem] italic">Last updated: 28 April 2026</p>
      </div>
    ),
    de: (
      <div className="legal-body text-[0.875rem] leading-[1.85] space-y-0">
        <H first>1. Verantwortlicher</H>
        <p className="mb-4"><strong className="legal-head font-semibold">Borivon.com</strong> ist eine internationale Plattform, betrieben von Germeds LLC, einer in den Vereinigten Staaten von Amerika eingetragenen Gesellschaft mit beschränkter Haftung. Germeds LLC ist der alleinige Verantwortliche für alle über diese Plattform verarbeiteten personenbezogenen Daten.</p>
        <p className="mb-4">E-Mail: <A href="mailto:contact@borivon.com">contact@borivon.com</A></p>

        <H>2. Erhobene Daten</H>
        <p className="mb-4">Wir erheben personenbezogene und berufliche Daten von allen Nutzern, einschließlich, aber nicht beschränkt auf: vollständiger Name, Geburtsdatum, Staatsangehörigkeit, E-Mail-Adresse, Telefonnummer und amtliche Ausweisdokumente. Kandidaten können außerdem Lebensläufe, Bildungsnachweise und visabezogene Dokumente einreichen. Zahlungsinformationen können zur Abwicklung von Transaktionen erhoben werden. Wir erheben auch automatisch Daten wie IP-Adresse, Gerätetyp, Browser und besuchte Seiten.</p>

        <H>3. Zwecke und Rechtsgrundlagen der Verarbeitung</H>
        <ul className="mb-4 ml-[1.1rem] space-y-1 list-disc">
          <li><strong className="legal-head font-semibold">Diensterbringung</strong> (Vertragserfüllung): Bearbeitung von Anfragen, Verwaltung des Portalkontos, Bewerbungsverfolgung.</li>
          <li><strong className="legal-head font-semibold">Serviceverbesserung</strong> (berechtigtes Interesse): anonymisierte Analyse des Website-Traffics.</li>
          <li><strong className="legal-head font-semibold">Kommunikation</strong> (berechtigtes Interesse / Einwilligung): Beantwortung von Anfragen und Dossiernachrichten.</li>
          <li><strong className="legal-head font-semibold">Rechtliche Compliance</strong> (gesetzliche Verpflichtung): Aufbewahrung gemäß geltenden Vorschriften.</li>
          <li><strong className="legal-head font-semibold">Marketing</strong> (Einwilligung): nur bei ausdrücklicher Einwilligung über unser Cookie-Tool.</li>
        </ul>

        <H>4. Datenweitergabe</H>
        <p className="mb-2">Borivon.com verkauft oder vermietet Ihre Daten nicht. Sie können nur weitergegeben werden an:</p>
        <ul className="mb-4 ml-[1.1rem] space-y-1 list-disc">
          <li>Beauftragte technische Anbieter (Vercel, Supabase, Google Drive) unter DSGVO-konformen Verträgen.</li>
          <li>Autorisierte Partneragenten, ausschließlich zur Bewerbungsbewertung, mit Vertraulichkeitspflichten.</li>
          <li>Zuständige Behörden, sofern gesetzlich vorgeschrieben.</li>
        </ul>
        <p className="mb-4">Jede Übermittlung außerhalb des EWR unterliegt angemessenen Garantien (Standardvertragsklauseln, Angemessenheitsbeschlüsse).</p>

        <H>5. Speicherfristen</H>
        <p className="mb-4">Wir speichern personenbezogene Daten so lange, wie es zur Erfüllung der Zwecke, für die sie erhoben wurden, erforderlich ist, einschließlich der Erfüllung gesetzlicher, buchhalterischer oder meldepflichtiger Anforderungen. Soweit keine spezifische gesetzliche Aufbewahrungspflicht besteht, wenden wir den Grundsatz der Speicherbegrenzung auf Basis einer legitimen geschäftlichen Notwendigkeit an. Anonymisierte und aggregierte Daten können unbegrenzt aufbewahrt werden, da sie nach geltendem Recht keine personenbezogenen Daten mehr darstellen. Sie können die Löschung Ihrer personenbezogenen Daten jederzeit beantragen, vorbehaltlich unserer gesetzlichen Verpflichtungen und berechtigten Interessen an der Aufbewahrung bestimmter Aufzeichnungen.</p>

        <H>6. Datensicherheit</H>
        <ul className="mb-4 ml-[1.1rem] space-y-1 list-disc">
          <li>Verschlüsselte Übertragungen (HTTPS/TLS).</li>
          <li>Passwortspeicherung durch kryptografisches Hashing (bcrypt).</li>
          <li>Strenge Zugangskontrolle mit starker Authentifizierung.</li>
          <li>Hosting auf zertifizierten Infrastrukturen (Vercel, Supabase).</li>
          <li>Regelmäßige Sicherheitsüberprüfungen.</li>
        </ul>

        <H>7. Ihre Rechte (DSGVO)</H>
        <ul className="mb-4 ml-[1.1rem] space-y-1 list-disc">
          <li>Auskunftsrecht (Art. 15) — Kopie Ihrer personenbezogenen Daten.</li>
          <li>Berichtigungsrecht (Art. 16) — Korrektur unrichtiger Daten.</li>
          <li>Löschungsrecht (Art. 17) — „Recht auf Vergessenwerden".</li>
          <li>Datenübertragbarkeit (Art. 20) — maschinenlesbares Format.</li>
          <li>Widerspruchsrecht (Art. 21) — bei berechtigtem Interesse.</li>
          <li>Recht auf Einschränkung — vorübergehende Aussetzung der Verarbeitung.</li>
          <li>Widerruf der Einwilligung (Art. 7).</li>
        </ul>
        <p className="mb-4">Zur Ausübung: <A href="mailto:contact@borivon.com">contact@borivon.com</A> — Antwort innerhalb von 30 Kalendertagen.</p>

        <H>8. Cookies und Tracker</H>
        <ul className="mb-4 ml-[1.1rem] space-y-1 list-disc">
          <li><strong className="legal-head font-semibold">Notwendige Cookies</strong>: für den Betrieb erforderlich, immer aktiv.</li>
          <li><strong className="legal-head font-semibold">Analyse-Cookies</strong>: aggregierte Nutzungsdaten (mit Einwilligung).</li>
          <li><strong className="legal-head font-semibold">Werbe-Cookies</strong>: Anzeigenpersonalisierung inkl. Meta Pixel (mit Einwilligung).</li>
        </ul>
        <p className="mb-4">Einstellungen jederzeit über den Link „Cookie-Einstellungen" am Seitenende verwalten.</p>

        <H>9. Änderungen der Richtlinie</H>
        <p className="mb-4">Wir behalten uns das Recht vor, diese Richtlinie jederzeit zu ändern. Die aktualisierte Version wird auf dieser Seite mit einem neuen Datum veröffentlicht. Bei wesentlichen Änderungen werden Sie per E-Mail oder durch einen sichtbaren Hinweis informiert.</p>

        <H>10. Kontakt und Beschwerden</H>
        <p className="mb-4">Für Fragen oder zur Ausübung Ihrer Rechte: <A href="mailto:contact@borivon.com">contact@borivon.com</A></p>
        <p className="legal-muted mt-6 text-[0.78rem] italic">Stand: 28. April 2026</p>
      </div>
    ),
  };

  return content[l] ?? content.fr;
}
