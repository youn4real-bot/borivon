/**
 * IMPRESSUM — the German legal notice (§ 5 DDG). Data from the founder,
 * 2026-11-07. Linked in the footer of every page (components/LegalFooter.tsx
 * and the static pages in content/pflege).
 *
 * The EU online-dispute (ODR) link is gone on purpose: the EU shut that
 * platform down on 20 July 2025, so the old hint would point nowhere.
 */
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Impressum",
  description: "Impressum der Borivon LLC.",
  alternates: { canonical: "https://borivon.com/impressum" },
};

export default function ImpressumPage() {
  return (
    <main
      className="mx-auto px-5 pt-[112px] pb-16 bv-page-bottom"
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

      <Section title="Anbieter">
        Borivon LLC
        <br />
        30 N Gould St Ste R
        <br />
        Sheridan, WY 82801
        <br />
        USA
      </Section>

      <Section title="Vertreten durch">
        Youness Taoufiq (Managing Member)
      </Section>

      <Section title="Kontakt">
        E-Mail:{" "}
        <a className="bv-link" href="mailto:contact@borivon.com">
          contact@borivon.com
        </a>
        <br />
        Telefon:{" "}
        <a className="bv-link" href="tel:+4915731504759">
          +49 157 315 047 59
        </a>
      </Section>

      <Section title="Verbraucherstreitbeilegung">
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
