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
  const isPortal = pathname.startsWith("/portal");

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
            ) : null}
          />
          {/* 100 px bottom clearance only on portal mobile (where the
              bottom action bar lives). Public pages stay flush. */}
          <div className={isPortal ? "pb-[100px] sm:pb-0" : ""}>
            {children}
          </div>
          {/* Bug-report button: portal-only. Public/marketing pages never render
              it so a stale cached session can't leak after logout. */}
          {isPortal && <BugReportButton />}
        </MobileMenuProvider>
      </LangProvider>
    </ThemeProvider>
  );
}
