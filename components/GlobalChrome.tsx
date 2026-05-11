"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ThemeProvider } from "@/components/ThemeContext";
import { LangProvider } from "@/components/LangContext";
import { MobileMenuProvider } from "@/components/MobileMenuContext";
import { Navbar } from "@/components/Navbar";
import { NotificationBell } from "@/components/NotificationBell";
import { MessageIcon } from "@/components/MessageIcon";
import { ProfileIcon } from "@/components/ProfileIcon";
import { BugReportButton } from "@/components/BugReportButton";
import { useLang } from "@/components/LangContext";
import { supabase } from "@/lib/supabase";

function HomeLoginButton() {
  const { lang } = useLang();
  const label = lang === "de" ? "Anmelden" : lang === "fr" ? "Se connecter" : "Log in";
  return (
    <button
      onClick={() => window.dispatchEvent(new CustomEvent("bv:open-auth"))}
      className="text-[13px] font-semibold px-4 py-1.5 rounded-full transition-all hover:opacity-90 active:scale-[0.97]"
      style={{
        background: "var(--gold)",
        color: "#131312",
        border: "none",
        cursor: "pointer",
        letterSpacing: "-0.01em",
      }}
    >
      {label}
    </button>
  );
}

/**
 * Site-wide chrome — providers + permanent top bar + report-bug button.
 *
 * Mounted once in `app/layout.tsx` so EVERY route gets:
 *   - Theme + Lang + MobileMenu providers
 *   - Top navbar (logo / messages / notifications / language / theme / profile)
 *   - Floating "Report a bug" button
 *
 * Mobile-bottom action bar is opt-in per-route: only `/portal/*` pages get
 * it (so candidates / admins keep their fast-access toolbar). Public
 * marketing pages get a clean top-right action cluster on every breakpoint.
 *
 * MessageIcon, NotificationBell and ProfileIcon all return `null` when
 * there's no signed-in user — so the bar stays clean for visitors.
 */
export function GlobalChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const isPortal  = pathname.startsWith("/portal");
  const isHome    = pathname === "/";
  const isLoginPg = pathname === "/portal";
  const [isAuthed, setIsAuthed] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsAuthed(!!session);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_evt, session) => {
      setIsAuthed(!!session);
    });
    return () => subscription.unsubscribe();
  }, []);

  return (
    <ThemeProvider>
      <LangProvider>
        <MobileMenuProvider>
          <Navbar
            rightExtra={isPortal && isAuthed && !isLoginPg ? (
              <>
                <MessageIcon />
                <NotificationBell />
                <ProfileIcon />
              </>
            ) : isHome ? (
              <HomeLoginButton />
            ) : null}
          />
          <div className={isPortal ? "pb-[100px] sm:pb-0" : ""}>
            {children}
          </div>
          {isPortal && isAuthed && !isLoginPg && <BugReportButton />}
        </MobileMenuProvider>
      </LangProvider>
    </ThemeProvider>
  );
}
