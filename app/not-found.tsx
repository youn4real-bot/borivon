"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLang } from "@/components/LangContext";

/**
 * 404 in the site's one design (founder 2026-11-10: "one design inside and outside the portal"):
 * paper, EB Garamond, hairline, ink button. Speaks the visitor's language; the text fades in after
 * the language is known, so a German visitor never sees a French flash first.
 */
const T = {
  de: { h: "Diese Seite gibt es nicht.", p: "Vielleicht ist der Link alt, oder ein Buchstabe fehlt.", home: "Zur Startseite", fp: "Kostenloser Fahrplan" },
  fr: { h: "Cette page n'existe pas.", p: "Le lien est peut-être ancien, ou il manque une lettre.", home: "Retour à l'accueil", fp: "" },
  en: { h: "This page doesn't exist.", p: "The link may be old, or a letter is missing.", home: "Back to home", fp: "" },
} as const;

export default function NotFound() {
  const { lang } = useLang();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const t = T[lang] ?? T.de;

  return (
    <main
      className="min-h-screen flex flex-col items-center justify-center text-center px-6"
      style={{ opacity: ready ? 1 : 0, transition: "opacity .5s ease" }}
    >
      <p style={{ margin: 0, font: "500 12px/1 var(--font-dm-sans)", letterSpacing: "0.18em", color: "var(--w3)" }}>404</p>
      <span aria-hidden="true" style={{ display: "block", width: 40, height: 1, margin: "22px auto 26px", background: "var(--border)" }} />
      <h1
        style={{
          margin: 0,
          font: "500 clamp(2rem, 1.4rem + 2.6vw, 3.2rem)/1.08 var(--font-serif)",
          letterSpacing: "-0.02em",
          color: "var(--w)",
        }}
      >
        {t.h}
      </h1>
      <p style={{ margin: "18px 0 34px", fontSize: 15.5, lineHeight: 1.6, color: "var(--w2)", maxWidth: "28em" }}>{t.p}</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 22, alignItems: "center", justifyContent: "center" }}>
        <Link
          href="/"
          className="no-underline"
          style={{
            display: "inline-flex", alignItems: "center", padding: "14px 22px", borderRadius: 4,
            background: "var(--w)", color: "var(--bg)", font: "500 14.5px/1 var(--font-dm-sans)",
          }}
        >
          {t.home}
        </Link>
        {t.fp && (
          <Link href="/fahrplan" className="bv-link" style={{ fontSize: 14.5 }}>
            {t.fp}
          </Link>
        )}
      </div>
    </main>
  );
}
