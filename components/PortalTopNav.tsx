"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLang } from "./LangContext";

const NAV_T = {
  en: { dashboard: "Dashboard", community: "Community" },
  fr: { dashboard: "Tableau de bord", community: "Communauté" },
  de: { dashboard: "Dashboard", community: "Community" },
} as const;

/**
 * Universal sticky sub-nav: Dashboard + Community for every portal role.
 *   - /portal/admin        → Dashboard = /portal/admin
 *   - /portal/org/*        → Dashboard = /portal/org/dashboard
 *   - everything else      → Dashboard = /portal/dashboard  (candidate)
 *
 * Sets --bv-subnav-h CSS variable so modals below can offset correctly.
 */
export function PortalTopNav() {
  const { lang } = useLang();
  const T = NAV_T[lang as keyof typeof NAV_T] ?? NAV_T.en;
  const pathname = usePathname() ?? "";
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const update = () => {
      const h = navRef.current?.offsetHeight ?? 44;
      document.documentElement.style.setProperty("--bv-subnav-h", `${h}px`);
    };
    update();
    const ro = new ResizeObserver(update);
    if (navRef.current) ro.observe(navRef.current);
    return () => {
      ro.disconnect();
      document.documentElement.style.setProperty("--bv-subnav-h", "0px");
    };
  }, []);

  // Determine which Dashboard URL to use based on current route
  const isAdmin  = pathname.startsWith("/portal/admin");
  const isOrg    = pathname.startsWith("/portal/org");
  const isFeed   = pathname.startsWith("/portal/feed");

  const dashHref = isAdmin ? "/portal/admin"
                 : isOrg   ? "/portal/org/dashboard"
                 :            "/portal/dashboard";

  const dashActive = !isFeed;
  const feedActive = isFeed;

  const tabs = [
    { label: T.dashboard, href: dashHref,      active: dashActive },
    { label: T.community, href: "/portal/feed", active: feedActive },
  ];

  return (
    <nav
      ref={navRef}
      className="sticky z-[1100] flex items-center gap-0 px-4 sm:px-[3.5vw] border-b"
      style={{
        top: "58px",
        background: "var(--nav-bg)",
        borderColor: "var(--border)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
      }}
    >
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          prefetch={true}
          className="relative inline-flex items-center px-4 sm:px-5 py-3.5 text-[13px] font-semibold transition-colors duration-150 no-underline"
          style={{
            color: tab.active ? "var(--w)" : "var(--w3)",
            borderBottom: tab.active ? "2px solid var(--gold)" : "2px solid transparent",
            marginBottom: "-1px",
            letterSpacing: "-0.01em",
          }}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
