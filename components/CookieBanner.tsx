"use client";
import { useState, useEffect } from "react";
import { useLang } from "./LangContext";
import { ChevronDown, ChevronUp } from "lucide-react";

const STORAGE_KEY = "cookie_consent";

const labels = {
  fr: {
    title:          "Paramètres des cookies",
    desc:           "Nous utilisons des cookies pour améliorer votre expérience.",
    acceptAll:      "Tout accepter",
    essentialOnly:  "Essentiels uniquement",
    manage:         "Gérer les préférences",
    saveChoices:    "Enregistrer mes choix",
    essentialTitle: "Cookies essentiels",
    essentialDesc:  "Nécessaires au fonctionnement du site. Toujours actifs.",
    analyticsTitle: "Cookies analytiques",
    analyticsDesc:  "Nous aident à comprendre comment les visiteurs utilisent le site.",
    adsTitle:       "Cookies publicitaires",
    adsDesc:        "Permettent des publicités personnalisées (Meta Pixel, etc.).",
    alwaysOn:       "Toujours actif",
    learnMore:      "Politique de confidentialité",
  },
  en: {
    title:          "Cookie Settings",
    desc:           "We use cookies to improve your experience.",
    acceptAll:      "Accept all",
    essentialOnly:  "Essentials only",
    manage:         "Manage preferences",
    saveChoices:    "Save my choices",
    essentialTitle: "Essential cookies",
    essentialDesc:  "Required for the site to function. Always active.",
    analyticsTitle: "Analytics cookies",
    analyticsDesc:  "Help us understand how visitors use the site.",
    adsTitle:       "Advertising cookies",
    adsDesc:        "Allow personalised ads (Meta Pixel, etc.).",
    alwaysOn:       "Always on",
    learnMore:      "Privacy policy",
  },
  de: {
    title:          "Cookie-Einstellungen",
    desc:           "Wir verwenden Cookies, um Ihre Erfahrung zu verbessern.",
    acceptAll:      "Alle akzeptieren",
    essentialOnly:  "Nur Notwendige",
    manage:         "Einstellungen verwalten",
    saveChoices:    "Auswahl speichern",
    essentialTitle: "Notwendige Cookies",
    essentialDesc:  "Für den Betrieb der Website erforderlich. Immer aktiv.",
    analyticsTitle: "Analyse-Cookies",
    analyticsDesc:  "Helfen uns, die Nutzung der Website zu verstehen.",
    adsTitle:       "Werbe-Cookies",
    adsDesc:        "Ermöglichen personalisierte Werbung (Meta Pixel usw.).",
    alwaysOn:       "Immer aktiv",
    learnMore:      "Datenschutzerklärung",
  },
};

// Meta Pixel — fires only when user accepts advertising cookies.
// Uncomment and set PIXEL_ID to activate.
function fireMetaPixel() {
  // const PIXEL_ID = "YOUR_PIXEL_ID";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // const w = window as any;
  // if (typeof w.fbq !== "function" && PIXEL_ID !== "YOUR_PIXEL_ID") { ... }
}

export function CookieBanner({ onOpenPrivacy }: { onOpenPrivacy: () => void }) {
  const { lang } = useLang();
  const l = labels[lang] ?? labels.en;

  const [visible, setVisible]            = useState(false);
  const [expanded, setExpanded]          = useState(false);
  const [analyticsEnabled, setAnalytics] = useState(false);
  const [adsEnabled, setAds]             = useState(false);

  // Show after short delay if no consent stored
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!localStorage.getItem(STORAGE_KEY)) setVisible(true);
    }, 900);
    return () => clearTimeout(timer);
  }, []);

  // Reopen via Footer "Cookie Settings" link
  useEffect(() => {
    const handler = () => {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        try {
          const prefs = JSON.parse(stored);
          setAnalytics(!!prefs.analytics);
          setAds(!!prefs.ads);
        } catch { /* ignore */ }
      }
      setExpanded(false);
      setVisible(true);
    };
    window.addEventListener("bv:open-cookie-settings", handler);
    return () => window.removeEventListener("bv:open-cookie-settings", handler);
  }, []);

  function save(analytics: boolean, ads: boolean) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ essential: true, analytics, ads, ts: Date.now() }));
    if (ads) fireMetaPixel();
    setVisible(false);
  }

  const acceptAll       = () => save(true, true);
  const acceptEssential = () => save(false, false);
  const saveChoices     = () => save(analyticsEnabled, adsEnabled);

  return (
    <>
      {/* Dimmed backdrop */}
      {visible && (
        <div
          className="fixed inset-0 z-[899]"
          style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(8px)" }}
        />
      )}

      {/* ══════════════════════════════════════════
          MOBILE card — floats well above bottom bar
          ══════════════════════════════════════════ */}
      <div
        className={[
          "fixed md:hidden z-[900] transition-all duration-500",
          "ease-[cubic-bezier(.16,1,.3,1)]",
          visible
            ? "opacity-100 translate-y-0"
            : "opacity-0 translate-y-6 pointer-events-none",
        ].join(" ")}
        style={{
          /* 90px clearance: clears Android soft nav (~56px) + breathing room */
          bottom: "calc(90px + env(safe-area-inset-bottom, 0px))",
          left: "14px",
          right: "14px",
          background: "var(--card)",
          border: "1px solid var(--border2)",
          borderRadius: "var(--r-2xl)",
          boxShadow: "var(--shadow-lg), 0 0 0 1px rgba(255,255,255,0.04)",
          overflow: "hidden",
        }}
      >
        {/* Gold top accent */}
        <div
          className="h-px w-full"
          style={{ background: "linear-gradient(to right, transparent 10%, var(--gold) 50%, transparent 90%)", opacity: 0.7 }}
        />

        {/* Card body */}
        <div className="px-5 pt-4 pb-0 flex flex-col gap-3">
          {/* Title + privacy link */}
          <div className="flex items-start justify-between gap-2">
            <p className="text-[1rem] font-semibold tracking-tight" style={{ color: "var(--w)" }}>
              {l.title}
            </p>
            <button
              onClick={onOpenPrivacy}
              className="text-[0.7rem] font-medium underline underline-offset-2 bg-transparent border-none p-0 cursor-pointer flex-shrink-0 mt-0.5"
              style={{ color: "var(--gold)" }}
            >
              {l.learnMore}
            </button>
          </div>

          {/* Description */}
          <p className="text-[0.82rem] leading-[1.55]" style={{ color: "var(--w2)" }}>
            {l.desc}
          </p>

          {/* Manage preferences — collapsible */}
          <button
            onClick={() => setExpanded(v => !v)}
            className="flex items-center gap-1.5 text-[0.78rem] font-medium bg-transparent border-none p-0 cursor-pointer w-fit"
            style={{ color: "var(--w3)" }}
          >
            {l.manage}
            {expanded
              ? <ChevronUp size={12} strokeWidth={2.5} />
              : <ChevronDown size={12} strokeWidth={2.5} />}
          </button>

          {/* Expanded preferences panel */}
          <div
            className="overflow-hidden transition-all duration-350 ease-[cubic-bezier(.4,0,.2,1)]"
            style={{ maxHeight: expanded ? "280px" : "0px" }}
          >
            <div
              className="flex flex-col gap-3 py-3"
              style={{ borderTop: "1px solid var(--border)" }}
            >
              {/* Essential — always on */}
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[0.78rem] font-semibold" style={{ color: "var(--w)" }}>{l.essentialTitle}</p>
                  <p className="text-[0.68rem] mt-0.5" style={{ color: "var(--w3)" }}>{l.essentialDesc}</p>
                </div>
                <span
                  className="text-[0.6rem] font-semibold tracking-wide px-2.5 py-1 rounded-full flex-shrink-0"
                  style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}
                >
                  {l.alwaysOn}
                </span>
              </div>

              <ToggleRow title={l.analyticsTitle} desc={l.analyticsDesc} enabled={analyticsEnabled} onChange={setAnalytics} />
              <ToggleRow title={l.adsTitle} desc={l.adsDesc} enabled={adsEnabled} onChange={setAds} />
            </div>
          </div>
        </div>

        {/* Action buttons — Accept All ALWAYS at the bottom edge, thumb-first */}
        <div
          className="px-4 pt-2 pb-4 flex flex-col gap-2.5 mt-1"
          style={{ borderTop: "1px solid var(--border)" }}
        >
          {/* Save choices — only visible when expanded */}
          {expanded && (
            <button
              onClick={saveChoices}
              className="w-full text-[0.82rem] font-semibold py-3 border cursor-pointer transition-all duration-150 active:scale-[0.98]"
              style={{
                background: "transparent",
                color: "var(--w2)",
                borderColor: "var(--border2)",
                borderRadius: "12px",
              }}
            >
              {l.saveChoices}
            </button>
          )}

          {/* Essentials only */}
          <button
            onClick={acceptEssential}
            className="w-full text-[0.82rem] font-semibold py-3 border cursor-pointer transition-all duration-150 active:scale-[0.98]"
            style={{
              background: "transparent",
              color: "var(--w2)",
              borderColor: "var(--border2)",
              borderRadius: "12px",
            }}
          >
            {l.essentialOnly}
          </button>

          {/* Accept All — always last = closest to thumb */}
          <button
            onClick={acceptAll}
            className="w-full text-[0.95rem] font-semibold py-3.5 border-none cursor-pointer transition-all duration-150 active:scale-[0.98]"
            style={{
              background: "var(--gold)",
              color: "#131312",
              borderRadius: "16px",
              boxShadow: "var(--shadow-gold-lg)",
            }}
          >
            {l.acceptAll}
          </button>
        </div>
      </div>

      {/* ══════════════════════════════════════════
          DESKTOP full-width bottom bar (md+)
          ══════════════════════════════════════════ */}
      <div
        className={[
          "hidden md:block fixed bottom-0 left-0 right-0 z-[900]",
          "transition-all duration-500 ease-[cubic-bezier(.4,0,.2,1)]",
          visible
            ? "translate-y-0 opacity-100"
            : "translate-y-full opacity-0 pointer-events-none",
        ].join(" ")}
        style={{
          background: "var(--card)",
          borderTop: "1px solid var(--border2)",
          boxShadow: "0 -8px 40px rgba(0,0,0,0.18)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {/* Gold accent line */}
        <div
          className="absolute top-[-1px] left-[30%] right-[30%] h-px"
          style={{ background: "linear-gradient(to right, transparent, var(--gold), transparent)" }}
        />

        {/* Desktop row */}
        <div className="flex px-[3.5vw] py-[1.1rem] items-center justify-between flex-wrap gap-[0.85rem]">
          <p className="text-[0.78rem] leading-[1.6] max-w-[560px]" style={{ color: "var(--w2)" }}>
            <strong className="font-semibold" style={{ color: "var(--w)" }}>{l.title}</strong>
            {" — "}{l.desc}{" "}
            <button
              onClick={onOpenPrivacy}
              className="underline underline-offset-2 cursor-pointer bg-transparent border-none p-0 text-[0.77rem] transition-colors"
              style={{ color: "var(--gold)" }}
            >
              {l.learnMore}
            </button>.
          </p>
          <div className="flex gap-[0.6rem] flex-shrink-0 items-center">
            <button
              onClick={() => setExpanded(v => !v)}
              className="bv-row-hover ck-btn text-[0.75rem] font-semibold px-[1.1rem] py-[0.5rem] cursor-pointer"
              style={{ color: "var(--w2)" }}
            >
              <span className="inline-flex items-center gap-1.5">
                {l.manage}
                {expanded ? <ChevronUp size={11} strokeWidth={2} /> : <ChevronDown size={11} strokeWidth={2} />}
              </span>
            </button>
            <button
              onClick={acceptEssential}
              className="ck-btn text-[0.75rem] font-semibold px-[1.1rem] py-[0.5rem] cursor-pointer border transition-all duration-150"
              style={{
                background: "transparent",
                color: "var(--w2)",
                borderColor: "var(--border2)",
                borderRadius: "8px",
              }}
            >
              {l.essentialOnly}
            </button>
            <button
              onClick={acceptAll}
              className="ck-btn text-[0.75rem] font-semibold px-[1.1rem] py-[0.5rem] hover:-translate-y-px transition-all duration-150 cursor-pointer border-none"
              style={{
                background: "var(--gold)",
                color: "#131312",
                borderRadius: "16px",
                boxShadow: "var(--shadow-gold-sm)",
              }}
            >
              {l.acceptAll}
            </button>
          </div>
        </div>

        {/* Desktop expanded preferences */}
        <div
          className="overflow-hidden transition-all duration-400 ease-[cubic-bezier(.4,0,.2,1)]"
          style={{ maxHeight: expanded ? "280px" : "0px" }}
        >
          <div
            className="px-[3.5vw] pb-[1.2rem] flex flex-col gap-[0.7rem]"
            style={{ borderTop: "1px solid var(--border)" }}
          >
            <div className="flex items-center justify-between gap-4 pt-[1rem]">
              <div>
                <p className="text-[0.8rem] font-semibold" style={{ color: "var(--w)" }}>{l.essentialTitle}</p>
                <p className="text-[0.72rem]" style={{ color: "var(--w3)" }}>{l.essentialDesc}</p>
              </div>
              <span
                className="text-[0.65rem] font-semibold tracking-wide px-[0.7rem] py-[0.3rem] rounded-full flex-shrink-0"
                style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}
              >
                {l.alwaysOn}
              </span>
            </div>
            <ToggleRow title={l.analyticsTitle} desc={l.analyticsDesc} enabled={analyticsEnabled} onChange={setAnalytics} />
            <ToggleRow title={l.adsTitle} desc={l.adsDesc} enabled={adsEnabled} onChange={setAds} />
            <div className="flex justify-end pt-[0.2rem]">
              <button
                onClick={saveChoices}
                className="bv-row-hover text-[0.74rem] font-semibold px-[1.2rem] py-[0.45rem] cursor-pointer"
                style={{ color: "var(--gold)" }}
              >
                {l.saveChoices}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function ToggleRow({
  title, desc, enabled, onChange,
}: {
  title: string; desc: string; enabled: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-[0.78rem] font-semibold" style={{ color: "var(--w)" }}>{title}</p>
        <p className="text-[0.68rem] mt-0.5" style={{ color: "var(--w3)" }}>{desc}</p>
      </div>
      <button
        onClick={() => onChange(!enabled)}
        className="flex-shrink-0 relative cursor-pointer border-none p-0 transition-colors duration-200 rounded-full"
        style={{ width: "40px", height: "22px", background: enabled ? "var(--gold)" : "var(--border2)" }}
        aria-pressed={enabled}
      >
        <span
          className="absolute top-[2px] transition-all duration-200 rounded-full"
          style={{
            width: "18px", height: "18px",
            background: "#fff",
            left: enabled ? "20px" : "2px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
          }}
        />
      </button>
    </div>
  );
}
