"use client";

import { useRouter } from "next/navigation";
import { PRIVACY, type PrivacyLang } from "@/lib/privacyContent";

/**
 * The privacy policy page body. /privacy-policy passes the site language,
 * /datenschutz always "de". Same look as before the split (2026-11-07).
 */
export function PrivacyView({ lang }: { lang: PrivacyLang }) {
  const router = useRouter();
  const c = PRIVACY[lang] ?? PRIVACY.en;

  return (
    <main className="bv-page-bottom min-h-screen" style={{ background: "var(--bg)", paddingTop: "calc(61px + 2rem)" }}>
      <div className="max-w-[760px] mx-auto px-4 pt-8 pb-16">

        {/* Header */}
        <div className="flex items-start gap-3 mb-10">
          <button
            onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))}
            aria-label={lang === "de" ? "Zurück" : lang === "fr" ? "Retour" : "Back"}
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
