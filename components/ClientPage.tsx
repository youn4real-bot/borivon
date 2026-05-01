"use client";
import { useEffect, useState } from "react";
import { useTheme } from "./ThemeContext";
import { useLang } from "./LangContext";
import { Funnel } from "./Funnel";
import { Footer } from "./Footer";
import { CookieBanner } from "./CookieBanner";
import { Dialog } from "./ui/dialog";
import { PrivacyContent } from "./LegalContent";
import { AuthModal } from "./AuthModal";

// ── Pricing data ─────────────────────────────────────────────────────────────
const PLANS = {
  fr: {
    eyebrow: "Tarifs simples et transparents",
    title: "Choisissez votre plan",
    sub: "Paiement unique — aucun abonnement. Accès immédiat.",
    starter: {
      name: "Starter",
      price: "9€",
      period: "paiement unique",
      badge: null,
      desc: "Démarrez votre candidature et téléchargez tous vos documents.",
      features: [
        "Upload de tous vos documents",
        "Constructeur de CV allemand (Lebenslauf)",
        "Suivi des statuts de documents",
        "Messagerie avec votre conseiller",
        "Revue et feedback admin",
      ],
      cta: "Commencer pour 9€",
    },
    kandidat: {
      name: "Kandidat",
      price: "99€",
      period: "paiement unique",
      badge: "Le plus complet",
      desc: "Accès complet à tout le parcours jusqu'à l'Allemagne.",
      features: [
        "Tout le plan Starter",
        "Planification d'entretien",
        "Suivi de la reconnaissance",
        "Préparation ambassade",
        "Mises à jour visa",
        "Informations de vol",
      ],
      cta: "Commencer pour 99€",
    },
  },
  en: {
    eyebrow: "Simple, transparent pricing",
    title: "Choose your plan",
    sub: "One-time payment — no subscription. Instant access.",
    starter: {
      name: "Starter",
      price: "€9",
      period: "one-time",
      badge: null,
      desc: "Start your application and upload all your documents.",
      features: [
        "Upload all your documents",
        "German CV builder (Lebenslauf)",
        "Document status tracking",
        "Messaging with your advisor",
        "Admin review & feedback",
      ],
      cta: "Get started for €9",
    },
    kandidat: {
      name: "Kandidat",
      price: "€99",
      period: "one-time",
      badge: "Most complete",
      desc: "Full access to the entire journey to Germany.",
      features: [
        "Everything in Starter",
        "Interview scheduling",
        "Recognition tracking",
        "Embassy preparation",
        "Visa status updates",
        "Flight booking info",
      ],
      cta: "Get started for €99",
    },
  },
  de: {
    eyebrow: "Einfache, transparente Preise",
    title: "Wählen Sie Ihren Plan",
    sub: "Einmalige Zahlung — kein Abo. Sofortiger Zugang.",
    starter: {
      name: "Starter",
      price: "9€",
      period: "einmalig",
      badge: null,
      desc: "Starten Sie Ihre Bewerbung und laden Sie alle Dokumente hoch.",
      features: [
        "Alle Dokumente hochladen",
        "Deutscher Lebenslauf-Builder",
        "Dokumentenstatus-Tracking",
        "Nachrichten mit Ihrem Berater",
        "Admin-Prüfung & Feedback",
      ],
      cta: "Jetzt starten — 9€",
    },
    kandidat: {
      name: "Kandidat",
      price: "99€",
      period: "einmalig",
      badge: "Vollständigster Plan",
      desc: "Vollzugang für den gesamten Weg nach Deutschland.",
      features: [
        "Alles aus dem Starter-Plan",
        "Gesprächsplanung & Vorbereitung",
        "Anerkennungs-Tracking",
        "Botschafts-Vorbereitung",
        "Visum-Status-Updates",
        "Flugbuchungs-Info",
      ],
      cta: "Jetzt starten — 99€",
    },
  },
};

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="#34c759" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function PricingSection({ onCTA }: { onCTA: () => void }) {
  const { lang } = useLang();
  const P = PLANS[lang] ?? PLANS.en;

  return (
    <section
      className="relative z-10 w-full max-w-[860px] mx-auto px-4 sm:px-6"
      style={{ paddingTop: "clamp(3rem,8vw,5rem)", paddingBottom: "clamp(3rem,8vw,5rem)" }}
    >
      {/* Section header */}
      <div className="text-center mb-10">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] mb-3"
          style={{ color: "var(--gold)" }}>
          {P.eyebrow}
        </p>
        <h2 className="text-[clamp(1.6rem,3.5vw,2.4rem)] font-semibold tracking-[-0.02em] mb-3"
          style={{ color: "var(--w)" }}>
          {P.title}
        </h2>
        <p className="text-[14px]" style={{ color: "var(--w3)" }}>{P.sub}</p>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
        {/* Starter */}
        <div className="relative flex flex-col rounded-[22px] overflow-hidden"
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
          }}>
          <div className="px-7 pt-7 pb-5 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.15em] mb-4"
              style={{ color: "var(--w3)" }}>
              {P.starter.name}
            </p>
            <div className="flex items-end gap-2 mb-1">
              <span className="text-[clamp(2rem,4vw,2.6rem)] font-bold tracking-tight leading-none"
                style={{ color: "var(--w)" }}>
                {P.starter.price}
              </span>
              <span className="text-[12px] mb-1" style={{ color: "var(--w3)" }}>
                {P.starter.period}
              </span>
            </div>
            <p className="text-[13px] leading-relaxed mb-6" style={{ color: "var(--w2)" }}>
              {P.starter.desc}
            </p>
            <ul className="space-y-2.5">
              {P.starter.features.map((f, i) => (
                <li key={i} className="flex items-center gap-2.5 text-[13px]"
                  style={{ color: "var(--w2)" }}>
                  <span className="flex-shrink-0"><CheckIcon /></span>
                  {f}
                </li>
              ))}
            </ul>
          </div>
          <div className="px-7 pb-7 pt-2">
            <button
              onClick={onCTA}
              className="w-full py-3.5 rounded-[14px] text-[14px] font-semibold tracking-tight transition-all hover:opacity-90 hover:-translate-y-0.5 active:scale-[0.98]"
              style={{
                background: "var(--bg2)",
                color: "var(--w)",
                border: "1px solid var(--border2)",
              }}>
              {P.starter.cta}
            </button>
          </div>
        </div>

        {/* Kandidat — highlighted */}
        <div className="relative flex flex-col rounded-[22px] overflow-hidden"
          style={{
            background: "var(--card)",
            border: "1.5px solid rgba(212,175,55,0.45)",
            boxShadow: "0 4px 24px rgba(212,175,55,0.12), 0 2px 12px rgba(0,0,0,0.1)",
          }}>
          {/* Gold top bar */}
          <div className="h-[3px] w-full"
            style={{ background: "linear-gradient(90deg, rgba(212,175,55,0.6), var(--gold), rgba(212,175,55,0.6))" }} />

          {P.kandidat.badge && (
            <div className="absolute top-4 right-4">
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] px-2.5 py-1 rounded-full"
                style={{
                  background: "rgba(212,175,55,0.15)",
                  color: "var(--gold)",
                  border: "1px solid rgba(212,175,55,0.35)",
                }}>
                ★ {P.kandidat.badge}
              </span>
            </div>
          )}

          <div className="px-7 pt-7 pb-5 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.15em] mb-4"
              style={{ color: "var(--gold)" }}>
              {P.kandidat.name}
            </p>
            <div className="flex items-end gap-2 mb-1">
              <span className="text-[clamp(2rem,4vw,2.6rem)] font-bold tracking-tight leading-none"
                style={{ color: "var(--w)" }}>
                {P.kandidat.price}
              </span>
              <span className="text-[12px] mb-1" style={{ color: "var(--w3)" }}>
                {P.kandidat.period}
              </span>
            </div>
            <p className="text-[13px] leading-relaxed mb-6" style={{ color: "var(--w2)" }}>
              {P.kandidat.desc}
            </p>
            <ul className="space-y-2.5">
              {P.kandidat.features.map((f, i) => (
                <li key={i} className="flex items-center gap-2.5 text-[13px]"
                  style={{ color: "var(--w2)" }}>
                  <span className="flex-shrink-0"><CheckIcon /></span>
                  {f}
                </li>
              ))}
            </ul>
          </div>
          <div className="px-7 pb-7 pt-2">
            <button
              onClick={onCTA}
              className="w-full py-3.5 rounded-[14px] text-[14px] font-semibold tracking-tight transition-all hover:opacity-90 hover:-translate-y-0.5 active:scale-[0.98]"
              style={{
                background: "var(--gold)",
                color: "#131312",
                boxShadow: "0 4px 14px rgba(212,175,55,0.3)",
              }}>
              {P.kandidat.cta}
            </button>
          </div>
        </div>
      </div>

      {/* Fine print */}
      <p className="text-center text-[11.5px] mt-6" style={{ color: "var(--w3)" }}>
        {lang === "de"
          ? "Einladungscode erforderlich — wenden Sie sich an Ihren Berater."
          : lang === "en"
          ? "Invitation code required — contact your advisor to get one."
          : "Code d'invitation requis — contactez votre conseiller pour en obtenir un."}
      </p>
    </section>
  );
}

function PageInner() {
  const { t, lang } = useLang();
  const { theme } = useTheme();
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [authOpen, setAuthOpen]       = useState(false);

  // Open auth modal when the funnel's "Build your application file" CTA fires
  useEffect(() => {
    const handler = () => setAuthOpen(true);
    window.addEventListener("bv:open-auth", handler);
    return () => window.removeEventListener("bv:open-auth", handler);
  }, []);

  return (
    <>
      {/* Navbar is rendered by <GlobalChrome> in the root layout. */}

      {/* Ambient glow */}
      <div
        className="fixed inset-0 pointer-events-none z-0"
        style={{
          background:
            theme === "dark"
              ? "radial-gradient(ellipse 80% 60% at 10% 0%, rgba(201,162,64,0.07) 0%, transparent 65%), radial-gradient(ellipse 60% 70% at 90% 100%, rgba(201,162,64,0.05) 0%, transparent 65%)"
              : "radial-gradient(ellipse 80% 60% at 10% 0%, rgba(173,139,58,0.05) 0%, transparent 65%), radial-gradient(ellipse 60% 70% at 90% 100%, rgba(173,139,58,0.03) 0%, transparent 65%)",
          transition: "background 0.4s var(--ease)",
        }}
      />

      {/* Background watermark */}
      <div
        className="bg-char fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 font-[family-name:var(--font-dm-serif)] italic select-none pointer-events-none z-0"
        style={{
          fontSize: "62vw",
          color: theme === "dark" ? "rgba(255,255,255,0.011)" : "rgba(0,0,0,0.018)",
          lineHeight: 1,
          letterSpacing: "-0.05em",
          transition: "color 0.4s var(--ease)",
        }}
        aria-hidden="true"
      >
        B
      </div>

      <main
        className="relative z-10 min-h-screen flex flex-col items-center justify-center px-5 sm:px-[6vw]"
        style={{
          paddingTop: "clamp(88px,12vw,120px)",
          paddingBottom: "clamp(3rem,10vw,6rem)",
        }}
      >
        {/* Tagline */}
        <div
          className="text-center w-full"
          style={{ marginBottom: "clamp(2.5rem,5vw,3.5rem)" }}
        >
          {/* Status pill */}
          <div
            className="inline-flex items-center gap-2 rounded-full tracking-[0.03em]"
            style={{
              border: "1px solid var(--border2)",
              background: "var(--bg2)",
              color: "var(--w3)",
              transition: "background 0.4s, border-color 0.4s, color 0.4s",
              padding: "0.42rem 1.1rem",
              fontSize: "0.72rem",
              marginBottom: "clamp(1.2rem,3vw,1.6rem)",
            }}
          >
            <span
              className="w-[6px] h-[6px] rounded-full bg-[#4db87a] flex-shrink-0"
              style={{ animation: "pls 2s ease-in-out infinite" }}
            />
            <span>{t.pill}</span>
          </div>

          {/* Hero title */}
          <h1
            className="hero-title leading-[1.05] tracking-[-0.025em] font-medium"
            style={{
              color: "var(--w)",
              transition: "color 0.4s",
              fontSize: "clamp(2.2rem,4.5vw,3.6rem)",
              marginBottom: "clamp(1rem,2.5vw,1.4rem)",
            }}
            dangerouslySetInnerHTML={{ __html: t.heroTitle }}
          />

          {/* Hero sub */}
          <p
            className="font-normal mx-auto"
            style={{
              color: "var(--w2)",
              transition: "color 0.4s",
              fontSize: "clamp(0.9rem,1.8vw,1rem)",
              lineHeight: 1.8,
              maxWidth: "460px",
            }}
          >
            {t.heroSub}
          </p>
        </div>

        {/* Funnel card */}
        <Funnel />

        {/* Login link — returning users */}
        <p
          className="mt-6 text-center text-[13px]"
          style={{ color: "var(--w3)" }}
        >
          {lang === "de" ? "Bereits ein Konto?" : lang === "en" ? "Already have an account?" : "Déjà un compte ?"}{" "}
          <button
            onClick={() => setAuthOpen(true)}
            className="font-semibold hover:opacity-80 transition-opacity"
            style={{ color: "var(--gold)", background: "transparent", border: "none", cursor: "pointer" }}
          >
            {t.pBtnLogin} →
          </button>
        </p>
      </main>

      {/* Divider */}
      <div className="relative z-10 w-full" style={{ borderTop: "1px solid var(--border)" }} />

      {/* Pricing section */}
      <div className="relative z-10" style={{ background: "var(--bg)" }}>
        <PricingSection onCTA={() => setAuthOpen(true)} />
      </div>

      <Footer />

      <CookieBanner onOpenPrivacy={() => setPrivacyOpen(true)} />

      {/* Privacy modal from cookie banner */}
      <Dialog
        open={privacyOpen}
        onClose={() => setPrivacyOpen(false)}
        title={t.mPrivacy}
      >
        <PrivacyContent lang={lang} />
      </Dialog>

      {/* Auth modal */}
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />

      <style>{`
        @keyframes pls { 0%,100%{opacity:1} 50%{opacity:.35} }
      `}</style>
    </>
  );
}

export function ClientPage() {
  return <PageInner />;
}
