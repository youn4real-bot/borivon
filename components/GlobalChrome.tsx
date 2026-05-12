"use client";

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
  // LAW #1: `/portal` exact-match is the login screen — NEVER render any
  // logged-in chrome (message icon, bell, profile, bug button, Dashboard /
  // Community tabs) there. The previous `pathname.startsWith("/portal")`
  // check matched the login page too, and the individual chrome components
  // gated themselves on `supabase.auth.getSession()` — an async call. While
  // it resolved, a cached session token from a prior login leaked the bell /
  // tabs / profile icon onto the login page (this is the recurring bug).
  // Suppressing UNCONDITIONALLY here (no auth state read) is the battle-
  // tested fix: the route alone decides, no async flicker possible.
  const isLoginPage = pathname === "/portal";
  const isPortal    = pathname.startsWith("/portal") && !isLoginPage;
  const isHome      = pathname === "/";

  return (
    <ThemeProvider>
      <LangProvider>
        <MobileMenuProvider>
          <Navbar
            rightExtra={isPortal ? (
              <>
                <MessageIcon />
                <NotificationBell />
                <ProfileIcon />
              </>
            ) : isHome ? (
              <HomeLoginButton />
            ) : null}
          />
          {/* 100 px bottom clearance only on portal mobile (where the
              bottom action bar lives). Public + login pages stay flush. */}
          <div className={isPortal ? "pb-[100px] sm:pb-0" : ""}>
            {children}
          </div>
          {/* Bug-report button: portal-only AND not on the login page.
              Public/marketing/login pages never render it so a stale cached
              session can't leak after logout. */}
          {isPortal && <BugReportButton />}
        </MobileMenuProvider>
      </LangProvider>
    </ThemeProvider>
  );
}
