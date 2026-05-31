/**
 * IMPRESSUM — German legal notice required by §5 DDG (formerly §5 TMG) for any
 * commercial site targeting Germany. SCAFFOLD: fill every [ … ] placeholder with
 * the real company data, then ask to have it linked in the footer + set to index.
 *
 * Until then it is noindex + NOT linked anywhere, so the placeholders are never
 * surfaced to visitors or search engines. This is a structural starting point —
 * have it reviewed by a lawyer before going public.
 */
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Impressum – Borivon",
  // Keep out of search + nav until the real data is filled in.
  robots: { index: false, follow: false },
};

const ph = (s: string) => s; // placeholders are plain text; replace with real data

export default function ImpressumPage() {
  return (
    <main
      className="mx-auto px-5 py-16 bv-page-bottom"
      style={{ maxWidth: 760, color: "var(--w2)", lineHeight: 1.7 }}
    >
      <h1
        className="text-[clamp(1.6rem,3.2vw,2.2rem)] font-medium mb-2"
        style={{ color: "var(--w)", letterSpacing: "-0.02em" }}
      >
        Impressum
      </h1>
      <p className="text-[13px] mb-10" style={{ color: "var(--w3)" }}>
        Angaben gemäß § 5 DDG
      </p>

      <Section title="Diensteanbieter">
        {ph("[ Firmenname, z. B. Borivon GmbH ]")}
        <br />
        {ph("[ Straße und Hausnummer ]")}
        <br />
        {ph("[ PLZ Ort ]")}
        <br />
        {ph("[ Land, z. B. Deutschland ]")}
      </Section>

      <Section title="Vertreten durch">
        {ph("[ Name der/des Vertretungsberechtigten – z. B. Geschäftsführer/in ]")}
      </Section>

      <Section title="Kontakt">
        Telefon: {ph("[ +49 … ]")}
        <br />
        E-Mail:{" "}
        <a className="bv-link" href="mailto:contact@borivon.com">
          contact@borivon.com
        </a>
      </Section>

      <Section title="Registereintrag">
        {ph("[ Falls eingetragen: Handelsregister / Registergericht ]")}
        <br />
        {ph("[ Registernummer, z. B. HRB 123456 ]")}
      </Section>

      <Section title="Umsatzsteuer-ID">
        {ph(
          "[ Falls vorhanden: USt-IdNr. gemäß § 27a UStG, z. B. DE123456789 ]",
        )}
      </Section>

      <Section title="Redaktionell verantwortlich">
        {ph("[ Name und Anschrift der verantwortlichen Person (§ 18 Abs. 2 MStV) ]")}
      </Section>

      <Section title="EU-Streitschlichtung">
        Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung
        (OS) bereit:{" "}
        <a
          className="bv-link"
          href="https://ec.europa.eu/consumers/odr/"
          target="_blank"
          rel="noopener noreferrer"
        >
          https://ec.europa.eu/consumers/odr/
        </a>
        . Unsere E-Mail-Adresse finden Sie oben im Impressum.
      </Section>

      <Section title="Verbraucherstreitbeilegung / Universalschlichtungsstelle">
        Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor
        einer Verbraucherschlichtungsstelle teilzunehmen.
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-7">
      <h2
        className="text-[13px] font-semibold uppercase tracking-[0.12em] mb-2"
        style={{ color: "var(--gold)" }}
      >
        {title}
      </h2>
      <div className="text-[14.5px]" style={{ color: "var(--w2)" }}>
        {children}
      </div>
    </section>
  );
}
