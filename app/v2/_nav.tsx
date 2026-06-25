"use client";

/**
 * /v2 site chrome — its own premium glass nav + footer (the global GlobalChrome
 * Navbar is suppressed on /v2/*). Language switcher (FR·EN·DE) + theme toggle
 * reuse the existing Lang/Theme providers, so the choice persists site-wide.
 */
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { Menu, X, Sun, Moon } from "lucide-react";
import { useLang } from "@/components/LangContext";
import { useTheme } from "@/components/ThemeContext";
import type { Lang } from "@/lib/translations";
import { COPY, MOTTO, type Tri } from "./_copy";

const LANGS: Lang[] = ["fr", "en", "de"];

function Wordmark() {
  return (
    <Link href="/v2" aria-label="Borivon" className="select-none" style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontWeight: 700, fontSize: "1.5rem", letterSpacing: "-0.01em", color: "var(--w)" }}>
      Borivon<span style={{ color: "var(--gold)" }}>.</span>
    </Link>
  );
}

function LangSwitch({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  return (
    <div className="flex items-center gap-0.5 rounded-full p-0.5" style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
      {LANGS.map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          className="rounded-full px-2 py-1 text-[11px] font-semibold uppercase transition-opacity hover:opacity-80"
          style={{ background: lang === l ? "var(--gdim)" : "transparent", color: lang === l ? "var(--gold)" : "var(--w3)", letterSpacing: "0.02em" }}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

function ThemeBtn() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button onClick={toggleTheme} aria-label="Toggle theme" className="bv-icon-btn grid h-9 w-9 place-items-center rounded-full" style={{ color: "var(--w2)", border: "1px solid var(--border)" }}>
      {theme === "dark" ? <Sun size={15} strokeWidth={1.8} /> : <Moon size={15} strokeWidth={1.8} />}
    </button>
  );
}

export function V2Nav() {
  const { lang, setLang } = useLang();
  const pathname = usePathname() ?? "";
  const [open, setOpen] = useState(false);
  const T = (t: Tri) => t[lang];

  const links = [
    { href: "/v2/solutions", label: T(COPY.nav.business) },
    { href: "/v2/particuliers", label: T(COPY.nav.individuals) },
    { href: "/v2/methode", label: T(COPY.nav.model) },
    { href: "/v2/a-propos", label: T(COPY.nav.about) },
  ];
  const isActive = (href: string) => pathname === href;

  return (
    <>
      <header
        className="fixed inset-x-0 top-0 z-[1000]"
        style={{ background: "color-mix(in oklab, var(--bg) 72%, transparent)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)", borderBottom: "1px solid var(--border)" }}
      >
        <div className="mx-auto flex h-[60px] max-w-[1200px] items-center justify-between px-[5vw] lg:px-8">
          <Wordmark />

          <nav className="hidden items-center gap-7 lg:flex">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className="text-[14px] font-medium transition-colors" style={{ color: isActive(l.href) ? "var(--gold)" : "var(--w2)" }}>
                {l.label}
              </Link>
            ))}
          </nav>

          <div className="hidden items-center gap-3 lg:flex">
            <LangSwitch lang={lang} setLang={setLang} />
            <ThemeBtn />
            <Link href="/v2/contact" className="bv-glow-gold bv-press rounded-full px-4 py-2 text-[13px] font-semibold" style={{ background: "var(--gold)", color: "#131312", letterSpacing: "-0.01em" }}>
              {T(COPY.nav.contact)}
            </Link>
          </div>

          {/* Mobile trigger */}
          <button onClick={() => setOpen(true)} aria-label={T(COPY.nav.menu)} className="grid h-10 w-10 place-items-center rounded-full lg:hidden" style={{ color: "var(--w)" }}>
            <Menu size={20} strokeWidth={1.8} />
          </button>
        </div>
      </header>

      {/* Mobile menu */}
      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-[1001] flex flex-col lg:hidden"
            style={{ background: "color-mix(in oklab, var(--bg) 96%, transparent)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)" }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
          >
            <div className="flex h-[60px] items-center justify-between px-[5vw]">
              <Wordmark />
              <button onClick={() => setOpen(false)} aria-label="Close" className="grid h-10 w-10 place-items-center rounded-full" style={{ color: "var(--w)" }}>
                <X size={20} strokeWidth={1.8} />
              </button>
            </div>
            <div className="flex flex-1 flex-col gap-1 px-[7vw] pt-6">
              {links.map((l, i) => (
                <motion.div key={l.href} initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.04 * i + 0.05 }}>
                  <Link href={l.href} onClick={() => setOpen(false)} className="block py-3 font-medium" style={{ fontFamily: "var(--font-sans)", fontSize: "1.6rem", letterSpacing: "-0.02em", color: isActive(l.href) ? "var(--gold)" : "var(--w)" }}>
                    {l.label}
                  </Link>
                </motion.div>
              ))}
              <div className="mt-8 flex items-center justify-between">
                <LangSwitch lang={lang} setLang={setLang} />
                <ThemeBtn />
              </div>
              <Link href="/v2/contact" onClick={() => setOpen(false)} className="bv-glow-gold bv-press mt-6 rounded-full py-3.5 text-center text-[15px] font-semibold" style={{ background: "var(--gold)", color: "#131312" }}>
                {T(COPY.nav.contact)}
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export function V2Footer() {
  const { lang } = useLang();
  const T = (t: Tri) => t[lang];
  return (
    <footer className="px-[6vw] pb-12 pt-16" style={{ borderTop: "1px solid var(--border)", background: "var(--bg2)" }}>
      <div className="mx-auto max-w-[1200px]">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <span style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontWeight: 700, fontSize: "1.5rem", color: "var(--w)" }}>
              Borivon<span style={{ color: "var(--gold)" }}>.</span>
            </span>
            <p className="mt-2.5" style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: "1.05rem", color: "var(--gold)" }}>{MOTTO}</p>
            <p className="mt-3 max-w-[320px]" style={{ fontFamily: "var(--font-sans)", fontSize: "0.95rem", lineHeight: 1.6, color: "var(--w2)" }}>{T(COPY.footer.tagline)}</p>
            <p className="mt-4 bv-small" style={{ fontSize: "0.8rem", color: "var(--w3)" }}>{T(COPY.footer.institut)}</p>
          </div>
          <div>
            <div className="bv-eyebrow" style={{ marginBottom: "0.9rem" }}>{T(COPY.footer.colSite)}</div>
            <ul className="space-y-2.5">
              {[
                ["/v2/solutions", T(COPY.nav.business)],
                ["/v2/particuliers", T(COPY.nav.individuals)],
                ["/v2/methode", T(COPY.nav.model)],
                ["/v2/contact", T(COPY.nav.contact)],
              ].map(([h, l]) => (
                <li key={h}><Link href={h} className="transition-opacity hover:opacity-80" style={{ fontFamily: "var(--font-sans)", fontSize: "0.92rem", color: "var(--w2)" }}>{l}</Link></li>
              ))}
            </ul>
          </div>
          <div>
            <div className="bv-eyebrow" style={{ marginBottom: "0.9rem" }}>{T(COPY.footer.colCompany)}</div>
            <ul className="space-y-2.5">
              <li><Link href="/v2/a-propos" className="transition-opacity hover:opacity-80" style={{ fontFamily: "var(--font-sans)", fontSize: "0.92rem", color: "var(--w2)" }}>{T(COPY.nav.about)}</Link></li>
              <li><Link href="/portal" className="transition-opacity hover:opacity-80" style={{ fontFamily: "var(--font-sans)", fontSize: "0.92rem", color: "var(--w2)" }}>{T(COPY.footer.login)}</Link></li>
              <li><a href={`mailto:${COPY.footer.email.en}`} className="transition-opacity hover:opacity-80" style={{ fontFamily: "var(--font-sans)", fontSize: "0.92rem", color: "var(--w2)" }}>{COPY.footer.email.en}</a></li>
            </ul>
            <p className="mt-5 bv-small" style={{ fontSize: "0.8rem", lineHeight: 1.55, color: "var(--w3)" }}>
              {T(COPY.footer.company)}<br />{T(COPY.footer.country)}
            </p>
          </div>
        </div>
        <div className="mt-12 flex flex-col items-center justify-between gap-3 pt-6 sm:flex-row" style={{ borderTop: "1px solid var(--border)" }}>
          <span className="bv-small" style={{ fontSize: "0.8rem", color: "var(--w3)" }}>© {new Date().getFullYear()} Borivon · {T(COPY.footer.company)}. {T(COPY.footer.rights)}</span>
          <span className="bv-small" style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: "0.86rem", color: "var(--w3)" }}>{MOTTO}</span>
        </div>
      </div>
    </footer>
  );
}
