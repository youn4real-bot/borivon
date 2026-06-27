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

// Flag picker (matches the old site: flagcdn SVGs). gb flag for English.
const LANGS: { code: Lang; flag: string; label: string }[] = [
  { code: "fr", flag: "https://flagcdn.com/fr.svg", label: "Français" },
  { code: "en", flag: "https://flagcdn.com/gb.svg", label: "English" },
  { code: "de", flag: "https://flagcdn.com/de.svg", label: "Deutsch" },
];

function Wordmark() {
  return (
    <Link href="/v2" aria-label="Borivon" className="select-none" style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontWeight: 700, fontSize: "1.5rem", letterSpacing: "-0.01em", color: "var(--w)" }}>
      Borivon<span style={{ color: "var(--gold)" }}>.</span>
    </Link>
  );
}

function LangSwitch({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      {LANGS.map((l) => {
        const active = lang === l.code;
        return (
          <button
            key={l.code}
            onClick={() => setLang(l.code)}
            aria-label={l.label}
            aria-pressed={active}
            title={l.label}
            className="relative grid place-items-center rounded-full hover:opacity-100"
            style={{ width: 26, height: 26, opacity: active ? 1 : 0.4 }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={l.flag} alt={l.label} width={26} height={26} className="h-full w-full rounded-full object-cover" style={{ boxShadow: active ? "none" : "0 0 0 1px var(--border)" }} />
            {/* Active ring as a conditionally-rendered child: a DOM structure change
                on every switch forces a clean repaint (paint-only toggles on a single
                node can go stale under the page's continuous animation load). */}
            {active && (
              <span aria-hidden className="pointer-events-none absolute inset-0 rounded-full" style={{ boxShadow: "0 0 0 2px var(--gold)" }} />
            )}
          </button>
        );
      })}
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
        <div className="relative mx-auto flex h-[60px] max-w-[1200px] items-center justify-between px-[5vw] lg:px-8">
          <Wordmark />

          {/* Centered nav — absolutely placed so it sits in the true middle of the bar */}
          <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-8 lg:flex">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className="text-[14px] font-medium transition-colors hover:opacity-80" style={{ color: isActive(l.href) ? "var(--gold)" : "var(--w2)" }}>
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
          </div>
          <div>
            <div className="bv-eyebrow" style={{ marginBottom: "0.9rem" }}>{T(COPY.footer.colSite)}</div>
            <ul className="space-y-2.5">
              {[
                ["/v2/solutions", T(COPY.nav.business)],
                ["/v2/methode", T(COPY.nav.model)],
                ["/v2/a-propos", T(COPY.nav.about)],
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
          </div>
        </div>
        <div className="mt-12 flex items-center pt-6" style={{ borderTop: "1px solid var(--border)" }}>
          <span className="bv-small" style={{ fontSize: "0.8rem", color: "var(--w3)" }}>© {new Date().getFullYear()} Borivon · {T(COPY.footer.company)}. {T(COPY.footer.rights)}</span>
        </div>
      </div>
    </footer>
  );
}
