"use client";

import { useRouter } from "next/navigation";
import { PRIVACY, type PrivacyLang } from "@/lib/privacyContent";

/**
 * The privacy policy page body. /privacy-policy passes the site language,
 * /datenschutz always "de". Same text source for both (lib/privacyContent.ts).
 *
 * Look = the site's one design (founder 2026-11-10), same as /impressum: paper, EB Garamond titles,
 * hairlines between sections, readable 14.5px body. No cards, no gold box.
 */
export function PrivacyView({ lang }: { lang: PrivacyLang }) {
  const router = useRouter();
  const c = PRIVACY[lang] ?? PRIVACY.en;
  const back = lang === "de" ? "Zurück" : lang === "fr" ? "Retour" : "Back";

  return (
    <main className="bv-page-bottom min-h-screen" style={{ background: "var(--bg)" }}>
      <div className="mx-auto px-5 pt-[112px] pb-16" style={{ maxWidth: 760 }}>

        <button
          onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))}
          className="inline-flex items-center gap-2 transition-opacity hover:opacity-70"
          style={{ marginBottom: 28, padding: 0, background: "none", border: 0, fontSize: 13, color: "var(--w3)", cursor: "pointer" }}
        >
          <span aria-hidden="true">←</span>{back}
        </button>

        <h1
          className="text-[clamp(1.6rem,3.2vw,2.2rem)] font-medium mb-2"
          style={{ color: "var(--w)", letterSpacing: "-0.02em", fontFamily: "var(--font-serif)" }}
        >
          {c.title}
        </h1>
        <p className="text-[13px]" style={{ color: "var(--w3)" }}>{c.subtitle} · {c.updated}</p>

        <p className="text-[15.5px]" style={{ margin: "34px 0 0", paddingBottom: 34, lineHeight: 1.7, color: "var(--w2)" }}>
          {c.intro}
        </p>

        {c.sections.map((s, i) => (
          <section key={i} style={{ borderTop: "1px solid var(--border)", padding: "30px 0 6px" }}>
            <h2
              className="text-[1.2rem] mb-3"
              style={{ color: "var(--w)", fontFamily: "var(--font-serif)", fontWeight: 500, letterSpacing: "-0.01em", lineHeight: 1.3 }}
            >
              {s.heading}
            </h2>
            {s.body.split("\n\n").map((para, pi) => (
              <p key={pi} className="text-[14.5px] whitespace-pre-line" style={{ margin: "0 0 14px", lineHeight: 1.7, color: "var(--w2)" }}>
                {para}
              </p>
            ))}
          </section>
        ))}

        <p className="text-[12px]" style={{ marginTop: 34, paddingTop: 22, borderTop: "1px solid var(--border)", color: "var(--w3)" }}>
          © {new Date().getFullYear()} Borivon.com.{" "}
          {lang === "fr" ? "Tous droits réservés." : lang === "de" ? "Alle Rechte vorbehalten." : "All rights reserved."}
        </p>

      </div>
    </main>
  );
}
