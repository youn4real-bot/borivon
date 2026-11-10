import Link from "next/link";

/**
 * 404 in the site's one design (founder 2026-11-10): paper, EB Garamond, hairline, ink button.
 *
 * MUST stay a server component (tests/publicSlug404.test.ts): a client 404 arrives as an empty body
 * until JavaScript runs — a blank screen on a slow phone. So all three languages are in the markup and
 * CSS shows the one <html lang> names (German by default; LangProvider switches the attribute).
 */
const T = [
  { l: "de", h: "Diese Seite gibt es nicht.", p: "Vielleicht ist der Link alt, oder ein Buchstabe fehlt.", home: "Zur Startseite", fp: "Kostenloser Fahrplan" },
  { l: "en", h: "This page doesn't exist.", p: "The link may be old, or a letter is missing.", home: "Back to home", fp: "" },
  { l: "fr", h: "Cette page n'existe pas.", p: "Le lien est peut-être ancien, ou il manque une lettre.", home: "Retour à l'accueil", fp: "" },
] as const;

const CSS = `.nf-l{display:none}
html:not([lang="en"]):not([lang="fr"]) .nf-de,html[lang="en"] .nf-en,html[lang="fr"] .nf-fr{display:block}`;

export default function NotFound() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center text-center px-6">
      <style>{CSS}</style>
      <p style={{ margin: 0, font: "500 12px/1 var(--font-dm-sans)", letterSpacing: "0.18em", color: "var(--w3)" }}>404</p>
      <span aria-hidden="true" style={{ display: "block", width: 40, height: 1, margin: "22px auto 26px", background: "var(--border)" }} />
      {T.map((t) => (
        <div key={t.l} className={`nf-l nf-${t.l}`} lang={t.l}>
          <h1 style={{ margin: 0, font: "500 clamp(2rem, 1.4rem + 2.6vw, 3.2rem)/1.08 var(--font-serif)", letterSpacing: "-0.02em", color: "var(--w)" }}>{t.h}</h1>
          <p style={{ margin: "18px auto 34px", fontSize: 15.5, lineHeight: 1.6, color: "var(--w2)", maxWidth: "28em" }}>{t.p}</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 22, alignItems: "center", justifyContent: "center" }}>
            <Link href="/" className="no-underline" style={{ display: "inline-flex", alignItems: "center", padding: "14px 22px", borderRadius: 4, background: "var(--w)", color: "var(--bg)", font: "500 14.5px/1 var(--font-dm-sans)" }}>
              {t.home}
            </Link>
            {t.fp && <Link href="/fahrplan" className="bv-link" style={{ fontSize: 14.5 }}>{t.fp}</Link>}
          </div>
        </div>
      ))}
    </main>
  );
}
