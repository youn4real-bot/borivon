"use client";

import { useRouter } from "next/navigation";
import { useLang } from "@/components/LangContext";

const LAST_UPDATED = "28 April 2026";

const content = {
  fr: {
    title: "Politique de Remboursement",
    subtitle: "Borivon.com",
    updated: `Dernière mise à jour : ${LAST_UPDATED}`,
    intro: "Tous les paiements effectués sur Borivon.com sont définitifs. Aucun remboursement n'est accordé une fois le service réglé. Veuillez lire attentivement cette politique avant tout achat.",
    sections: [
      {
        heading: "1. Politique générale — aucun remboursement",
        body: `Tout paiement effectué sur Borivon.com est définitif et non remboursable. Dès lors qu'un service est réglé, aucune demande de remboursement ne sera acceptée, quelle qu'en soit la raison.\n\nCela s'applique à l'ensemble de nos services : cours d'allemand, accompagnement de candidature, services de traduction et d'interprétation, formations en entreprise.`,
      },
      {
        heading: "2. Exception — défaillance de Borivon.com",
        body: `Dans le cas exceptionnel où Borivon.com serait dans l'incapacité totale de fournir le service souscrit pour des raisons internes (et non liées au client), un avoir ou un report du service sera proposé à la discrétion de Borivon.com.\n\nAucun remboursement en espèces ou par virement ne sera accordé même dans ce cas.`,
      },
      {
        heading: "3. Responsabilité du client",
        body: `En procédant au paiement, le client reconnaît avoir pris connaissance de la nature du service souscrit et accepte que tout paiement est irrévocable. Il appartient au client de s'assurer de la pertinence du service avant tout achat.`,
      },
      {
        heading: "4. Modifications de la politique",
        body: `Borivon.com se réserve le droit de modifier cette politique à tout moment. La version en vigueur est celle publiée sur cette page à la date de votre achat.`,
      },
      {
        heading: "5. Contact",
        body: `Pour toute question :\nE-mail : contact@borivon.com\nTéléphone : +49 157 315 047 59`,
      },
    ],
  },
  en: {
    title: "Refund Policy",
    subtitle: "Borivon.com",
    updated: `Last updated: ${LAST_UPDATED}`,
    intro: "All payments made on Borivon.com are final. No refunds are issued once a service has been paid for. Please read this policy carefully before making any purchase.",
    sections: [
      {
        heading: "1. General Policy — No Refunds",
        body: `All payments made to Borivon.com are final and non-refundable. Once a service has been paid for, no refund request will be accepted, regardless of the reason.\n\nThis applies to all our services: German language courses, application support, translation and interpretation services, and in-company training.`,
      },
      {
        heading: "2. Exception — Borivon.com Service Failure",
        body: `In the exceptional case where Borivon.com is entirely unable to deliver the contracted service due to internal reasons (unrelated to the client), a credit or rescheduling of the service will be offered at Borivon.com's discretion.\n\nNo cash or bank transfer refund will be issued even in this case.`,
      },
      {
        heading: "3. Client Responsibility",
        body: `By proceeding with payment, the client acknowledges having understood the nature of the service purchased and accepts that all payments are irrevocable. It is the client's responsibility to ensure the service is appropriate before purchasing.`,
      },
      {
        heading: "4. Policy Changes",
        body: `Borivon.com reserves the right to modify this policy at any time. The applicable version is the one published on this page on the date of your purchase.`,
      },
      {
        heading: "5. Contact",
        body: `For any questions:\nEmail: contact@borivon.com\nPhone: +49 157 315 047 59`,
      },
    ],
  },
  de: {
    title: "Rückerstattungsrichtlinie",
    subtitle: "Borivon.com",
    updated: `Zuletzt aktualisiert: ${LAST_UPDATED}`,
    intro: "Alle Zahlungen auf Borivon.com sind endgültig. Nach Bezahlung eines Dienstes werden keine Rückerstattungen gewährt. Bitte lesen Sie diese Richtlinie sorgfältig, bevor Sie einen Kauf tätigen.",
    sections: [
      {
        heading: "1. Allgemeine Richtlinie — keine Rückerstattung",
        body: `Alle an Borivon.com geleisteten Zahlungen sind endgültig und nicht erstattungsfähig. Sobald ein Dienst bezahlt wurde, wird kein Rückerstattungsantrag akzeptiert, unabhängig vom Grund.\n\nDies gilt für alle unsere Dienstleistungen: Deutschkurse, Bewerbungsbegleitung, Übersetzungs- und Dolmetschleistungen sowie Inhouse-Schulungen.`,
      },
      {
        heading: "2. Ausnahme — Leistungsausfall seitens Borivon.com",
        body: `Im Ausnahmefall, dass Borivon.com den gebuchten Dienst aus internen Gründen (nicht kundenseitig) vollständig nicht erbringen kann, wird nach Ermessen von Borivon.com ein Guthaben oder eine Terminverschiebung angeboten.\n\nEine Barrückerstattung oder Banküberweisung wird auch in diesem Fall nicht gewährt.`,
      },
      {
        heading: "3. Verantwortung des Kunden",
        body: `Mit der Zahlung bestätigt der Kunde, die Art der gebuchten Dienstleistung verstanden zu haben und akzeptiert, dass alle Zahlungen unwiderruflich sind. Es liegt in der Verantwortung des Kunden, vor dem Kauf sicherzustellen, dass der Dienst seinen Anforderungen entspricht.`,
      },
      {
        heading: "4. Änderungen der Richtlinie",
        body: `Borivon.com behält sich das Recht vor, diese Richtlinie jederzeit zu ändern. Die gültige Version ist die zum Zeitpunkt Ihres Kaufs auf dieser Seite veröffentlichte.`,
      },
      {
        heading: "5. Kontakt",
        body: `Bei Fragen:\nE-Mail: contact@borivon.com\nTelefon: +49 157 315 047 59`,
      },
    ],
  },
};

export default function RefundPolicyPage() {
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
