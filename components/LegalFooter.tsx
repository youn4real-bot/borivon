"use client";

import { useLang } from "@/components/LangContext";
import type { Lang } from "@/lib/translations";

/**
 * Impressum + Datenschutz on every page (founder, 2026-11-07; § 5 DDG wants
 * the Impressum one click away). The static pages (/, /plattform, /fahrplan)
 * carry the same two links in their own footers.
 *
 * German → /datenschutz, other languages → /privacy-policy. On the affiliate
 * subdomain only token paths exist, so the links point to the main site there.
 *
 * Since 2026-11-10 the site is German by default and the language choice lives
 * here, quietly (founder: "don't remove the languages, just hide them in the settings").
 */
const LANGS: { code: Lang; label: string }[] = [
  { code: "de", label: "Deutsch" },
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
];

export function LegalFooter({ absolute = false }: { absolute?: boolean }) {
  const { lang, setLang } = useLang();
  const base = absolute ? "https://borivon.com" : "";
  const imp = lang === "de" ? "Impressum" : lang === "fr" ? "Mentions légales" : "Imprint";
  const priv = lang === "de" ? "Datenschutz" : lang === "fr" ? "Confidentialité" : "Privacy";
  const privHref = lang === "de" ? "/datenschutz" : "/privacy-policy";
  const cls = "hover:underline underline-offset-2";
  return (
    <footer className="relative z-10 px-4 pt-6 pb-8 text-center text-[12px]" style={{ color: "var(--w3)" }}>
      <a className={cls} href={`${base}/impressum`}>{imp}</a>
      <span aria-hidden="true" className="mx-2">·</span>
      <a className={cls} href={`${base}${privHref}`}>{priv}</a>
      <div className="mt-3" role="group" aria-label="Sprache / Language / Langue">
        {LANGS.map((l, i) => (
          <span key={l.code}>
            {i > 0 && <span aria-hidden="true" className="mx-2">·</span>}
            <button
              type="button"
              onClick={() => setLang(l.code)}
              aria-pressed={lang === l.code}
              className={cls}
              style={{ background: "none", border: 0, padding: 0, font: "inherit", cursor: "pointer", color: lang === l.code ? "var(--w)" : "inherit" }}
            >
              {l.label}
            </button>
          </span>
        ))}
      </div>
    </footer>
  );
}
