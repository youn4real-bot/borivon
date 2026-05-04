"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useLang } from "./LangContext";

const NAV_T = {
  en: { skip: "Skip to content" },
  fr: { skip: "Aller au contenu" },
  de: { skip: "Zum Inhalt springen" },
} as const;

// Tabs are now in the top Navbar. This component only handles the
// skip-to-content link (accessibility) and zeroes --bv-subnav-h so
// all modals/PDF popups start flush below the single 58px top bar.
export function PortalTopNav() {
  const { lang } = useLang();
  const T = NAV_T[lang as keyof typeof NAV_T] ?? NAV_T.en;

  usePathname(); // keep the hook so the component re-renders on navigation

  useEffect(() => {
    document.documentElement.style.setProperty("--bv-subnav-h", "0px");
    return () => {
      document.documentElement.style.setProperty("--bv-subnav-h", "0px");
    };
  }, []);

  return (
    <a
      href="#bv-main"
      className="sr-only focus:not-sr-only fixed top-2 left-2 z-[2000] px-3 py-2 rounded-md text-[13px] font-semibold no-underline"
      style={{ background: "var(--gold)", color: "#131312", boxShadow: "var(--shadow-md)" }}
    >
      {T.skip}
    </a>
  );
}
