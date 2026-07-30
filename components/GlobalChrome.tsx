"use client";

import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { ThemeProvider } from "@/components/ThemeContext";
import { LangProvider } from "@/components/LangContext";
import { MobileMenuProvider } from "@/components/MobileMenuContext";
import { Navbar } from "@/components/Navbar";
import { useLang } from "@/components/LangContext";

/**
 * The five PORTAL-ONLY widgets, lazy-loaded.
 *
 * GlobalChrome is mounted in app/layout.tsx, so it is on EVERY route — including
 * the public marketing pages where a lead lands. Statically importing these meant
 * every one of those visitors downloaded the notification bell, message icon,
 * profile menu (and its stack of modals), checklist drawer and bug reporter — none
 * of which can ever render outside /portal/*. That was ~60 kB gzipped of the shared
 * baseline paid by people who will never see any of it.
 *
 * ssr:false costs nothing here, and that is not a guess about how it looks: all of
 * these already gate themselves on an ASYNC supabase session read and return null
 * until it resolves (see the LAW #1 note below — that async gate is exactly what
 * caused the recurring chrome-leak bug). They were never present on first paint, so
 * loading them after hydration changes nothing visible and shifts no layout.
 *
 * LAW #1 is untouched: the decision to render them at all is still the synchronous
 * `pathname` check below, never an auth-state read.
 */
const NotificationBell = dynamic(() => import("@/components/NotificationBell").then((m) => m.NotificationBell), { ssr: false });
const MessageIcon = dynamic(() => import("@/components/MessageIcon").then((m) => m.MessageIcon), { ssr: false });
const ProfileIcon = dynamic(() => import("@/components/ProfileIcon").then((m) => m.ProfileIcon), { ssr: false });
const ChecklistDrawer = dynamic(() => import("@/components/ChecklistDrawer").then((m) => m.ChecklistDrawer), { ssr: false });
const BugReportButton = dynamic(() => import("@/components/BugReportButton").then((m) => m.BugReportButton), { ssr: false });

function HomeLoginButton() {
  const { lang } = useLang();
  const label = lang === "de" ? "Anmelden" : lang === "fr" ? "Se connecter" : "Log in";
  return (
    <button
      onClick={() => window.dispatchEvent(new CustomEvent("bv:open-auth"))}
      className="bv-glow-gold bv-press text-[13px] font-semibold px-4 py-1.5 rounded-full"
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
 * Keyboard skip-link. The first focusable element on every page — Tab once
 * from cold and the user can jump straight past the navbar, language picker,
 * notification cluster, and bug-report button. Visually hidden until the
 * link itself is focused, then it pops into the top-left so sighted keyboard
 * users see what they're activating.
 *
 * Targets `#bv-main` (the dashboard / cv-builder / admin / feed /
 * motivationsschreiben pages all anchor on that id). Pages without it
 * (the /portal login screen, etc.) have nothing to skip past anyway —
 * the link is harmless there.
 */
function SkipToMain() {
  const { lang } = useLang();
  const label = lang === "de" ? "Zum Hauptinhalt springen"
              : lang === "fr" ? "Aller au contenu principal"
              : "Skip to main content";
  return (
    <a
      href="#bv-main"
      className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[2000] focus:px-4 focus:py-2 focus:rounded-full focus:outline-none focus:ring-2 text-[13px] font-semibold"
      style={{
        background: "var(--gold)",
        color: "#131312",
        boxShadow: "var(--shadow-gold-sm)",
      }}
    >
      {label}
    </a>
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
  // /v2 is the new self-contained marketing site — it ships its OWN glass nav +
  // footer (app/v2/_nav.tsx) with language/theme controls. Suppress the global
  // Navbar + bug button here so there's no double-nav. The providers above stay
  // mounted, so /v2's own nav reads/writes the same Lang/Theme context.
  const isV2 = pathname === "/v2" || pathname.startsWith("/v2/");

  return (
    <ThemeProvider>
      <LangProvider>
        <MobileMenuProvider>
          {/* Skip-link is the first focusable element on every page.
              Visually hidden until focused — keyboard-only users get to
              the main content with one Tab keypress instead of 8+. */}
          <SkipToMain />
          {!isV2 && (
            <Navbar
              hideThemeLang={isPortal}
              rightExtra={isPortal ? (
                <>
                  <ChecklistDrawer />
                  <MessageIcon />
                  <NotificationBell />
                  <ProfileIcon />
                </>
              ) : isHome ? (
                <HomeLoginButton />
              ) : null}
            />
          )}
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
