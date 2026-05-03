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
              ? "radial-gradient(ellipse 80% 60% at 10% 0%, var(--gdim) 0%, transparent 65%), radial-gradient(ellipse 60% 70% at 90% 100%, var(--gdim) 0%, transparent 65%)"
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
