"use client";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLang } from "./LangContext";
import { useTheme } from "./ThemeContext";
import { useMobileMenu } from "./MobileMenuContext";
import type { Lang } from "@/lib/translations";
import { Sun, Moon, Menu, Home } from "lucide-react";
import { supabase } from "@/lib/supabase";

const PORTAL_NAV_T = {
  en: { dashboard: "Dashboard",     community: "Community"  },
  fr: { dashboard: "Tableau de bord", community: "Communauté" },
  de: { dashboard: "Dashboard",     community: "Community"  },
} as const;

const LANGS: { code: Lang; flagSrc: string; label: string }[] = [
  { code: "fr", flagSrc: "https://flagcdn.com/fr.svg", label: "Français" },
  { code: "en", flagSrc: "https://flagcdn.com/gb.svg", label: "English" },
  { code: "de", flagSrc: "https://flagcdn.com/de.svg", label: "Deutsch" },
];

export function Navbar({ rightExtra, leftExtra }: { rightExtra?: ReactNode; leftExtra?: ReactNode }) {
  const { lang, setLang } = useLang();
  const { theme, toggleTheme } = useTheme();
  const [langOpen, setLangOpen] = useState(false);
  const langRef = useRef<HTMLDivElement>(null);
  const langTriggerRef = useRef<HTMLButtonElement>(null);
  const [communityUnread, setCommunityUnread] = useState(0);
  const [authTk, setAuthTk] = useState("");
  // Position of the dropdown when portaled to <body> — recomputed each open.
  const [dropdownPos, setDropdownPos] = useState<{ top?: number; bottom?: number; left: number } | null>(null);
  // Per-page mobile menu toggle (e.g. dashboard's slide-in phase rail).
  // null on pages that don't register one.
  const mobileMenu = useMobileMenu();
  const menuConfig = mobileMenu?.config ?? null;
  // Mobile-bottom action bar is only used inside the candidate/admin portal —
  // public marketing pages put theme/lang at the top-right on every breakpoint
  // so the homepage stays uncluttered.
  const pathname = usePathname() ?? "";
  const useBottomBar = pathname.startsWith("/portal");

  const current = LANGS.find((l) => l.code === lang) ?? LANGS[0];
  const others   = LANGS.filter((l) => l.code !== lang);

  const navT = {
    en: {
      switchToLight: "Switch to light mode",
      switchToDark: "Switch to dark mode",
      closeMenu: "Close menu",
      openMenu: "Open menu",
    },
    fr: {
      switchToLight: "Passer en mode clair",
      switchToDark: "Passer en mode sombre",
      closeMenu: "Fermer le menu",
      openMenu: "Ouvrir le menu",
    },
    de: {
      switchToLight: "Zum Hellmodus wechseln",
      switchToDark: "Zum Dunkelmodus wechseln",
      closeMenu: "Menü schließen",
      openMenu: "Menü öffnen",
    },
  };
  const NT = navT[lang] ?? navT.en;
  const PNT = PORTAL_NAV_T[lang as keyof typeof PORTAL_NAV_T] ?? PORTAL_NAV_T.en;

  // Portal tab logic — mirrors PortalTopNav routing
  const isAdmin = pathname.startsWith("/portal/admin");
  const isOrg   = pathname.startsWith("/portal/org");
  const isFeed  = pathname.startsWith("/portal/feed");
  const dashHref = isAdmin ? "/portal/admin"
                 : isOrg   ? "/portal/org/dashboard"
                 :            "/portal/dashboard";
  const portalTabs = useBottomBar ? [
    { label: PNT.dashboard, href: dashHref,        active: !isFeed },
    { label: PNT.community, href: "/portal/feed",  active: isFeed  },
  ] : null;

  // Community unread badge ────────────────────────────────────────────────────
  useEffect(() => {
    if (!useBottomBar) return;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.access_token) setAuthTk(session.access_token);
    });
  }, [useBottomBar]);

  useEffect(() => {
    if (!isFeed) return;
    setCommunityUnread(0);
    if (typeof localStorage !== "undefined")
      localStorage.setItem("community_last_visited", new Date().toISOString());
  }, [isFeed]);

  useEffect(() => {
    if (!authTk || isFeed) return;
    const poll = async () => {
      const since = (typeof localStorage !== "undefined"
        ? localStorage.getItem("community_last_visited")
        : null) ?? new Date(0).toISOString();
      try {
        const res = await fetch(
          `/api/portal/feed/unread?since=${encodeURIComponent(since)}`,
          { headers: { Authorization: `Bearer ${authTk}` } },
        );
        if (res.ok) {
          const j = await res.json();
          setCommunityUnread(j.count ?? 0);
        }
      } catch { /* offline */ }
    };
    poll();
    const id = setInterval(poll, 60_000);
    return () => clearInterval(id);
  }, [authTk, isFeed]);
  // ─────────────────────────────────────────────────────────────────────────────

  // Close on Escape. Outside-click is handled by the portal-rendered backdrop
  // (we can't use the document mousedown trick because the dropdown lives
  // outside `langRef` once portaled).
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setLangOpen(false); };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); };
  }, []);

  // Action buttons (theme, lang, message, bell, profile). On desktop they
  // live at the top-right of the navbar. On mobile they're moved to a fixed
  // bottom bar — Skool-style. All icons are borderless and background-less:
  // the icon itself IS the button. Hover/active state is just a color shift
  // and a small scale animation. Same look on every screen size.
  const actions = (
    <>
      {/* Theme Toggle */}
      <button
        onClick={toggleTheme}
        aria-label={theme === "dark" ? NT.switchToLight : NT.switchToDark}
        style={{
          background: "transparent",
          border: "none",
          color: "var(--w3)",
          transition: "color 0.2s, transform 0.15s",
        }}
        className="flex items-center justify-center w-11 h-11 cursor-pointer hover:scale-110 active:scale-95"
        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--w)")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--w3)")}
      >
        {theme === "dark" ? <Sun size={20} strokeWidth={1.8} /> : <Moon size={20} strokeWidth={1.8} />}
      </button>

      {/* Language selector — single flag, dropdown on click */}
      <div ref={langRef} className="relative" aria-label="Language selector">
        <button
          ref={langTriggerRef}
          onClick={() => {
            // Compute the dropdown anchor position before opening so the
            // portal-rendered list appears under (desktop) or above (mobile,
            // bottom-bar action) the trigger button — not at top-left of body.
            const r = langTriggerRef.current?.getBoundingClientRect();
            if (r) {
              const isBottomBar = r.top > window.innerHeight / 2;
              setDropdownPos({
                left: r.left + r.width / 2,
                ...(isBottomBar
                  ? { bottom: window.innerHeight - r.top + 8 }
                  : { top: r.bottom + 8 }),
              });
            }
            setLangOpen((o) => !o);
          }}
          aria-label={`Language: ${current.label}`}
          aria-expanded={langOpen}
          style={{
            background: "transparent",
            border: "none",
            transition: "transform 0.15s",
            opacity: langOpen ? 1 : 0.9,
          }}
          className="flex items-center justify-center w-11 h-11 cursor-pointer hover:scale-110 hover:opacity-100 active:scale-95"
        >
          <img src={current.flagSrc} alt={current.label} width={34} height={24}
            className="object-cover" style={{
              display: "block",
              borderRadius: "6px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.22), 0 0 0 1px rgba(255,255,255,0.06) inset",
            }} />
        </button>
        {langOpen && typeof document !== "undefined" && dropdownPos && createPortal(
          // Click-outside catcher — invisible full-screen layer that closes
          // the picker when tapped (no blur, just dismissal).
          <>
            <div
              onClick={() => setLangOpen(false)}
              className="fixed inset-0"
              style={{ background: "transparent", zIndex: 1300 }}
            />
            {/* Premium picker — generous padding, larger flags, comfortable
                tap targets (≥44 px) for mobile. */}
            <div
              className="fixed flex flex-col gap-2 p-2"
              style={{
                ...dropdownPos,
                transform: "translateX(-50%)",
                zIndex: 1301,
                background: "var(--bg2)",
                border: "1px solid var(--border)",
                borderRadius: "16px",
                boxShadow: "0 16px 40px rgba(0,0,0,0.28), 0 4px 12px rgba(0,0,0,0.16)",
                animation: "slideDownCentered 0.22s var(--ease-out)",
              }}
            >
              {others.map((l) => (
                <button key={l.code}
                  onClick={() => { setLang(l.code); setLangOpen(false); }}
                  aria-label={`Switch to ${l.label}`} title={l.label}
                  className="cursor-pointer transition-all duration-200 hover:scale-[1.06] hover:-translate-y-0.5 active:scale-95 inline-flex items-center justify-center"
                  style={{
                    background: "transparent",
                    border: "none",
                    width: "44px",
                    height: "44px",
                    padding: 0,
                    borderRadius: "10px",
                    lineHeight: 0,
                  }}>
                  <img src={l.flagSrc} alt={l.label} width={36} height={26}
                    className="object-cover" style={{
                      display: "block",
                      borderRadius: "6px",
                      // Subtle dual-shadow gives flags a premium "lifted card" feel
                      // without resorting to a heavy border.
                      boxShadow: "0 2px 6px rgba(0,0,0,0.22), 0 0 0 1px rgba(255,255,255,0.08) inset",
                    }} />
                </button>
              ))}
            </div>
          </>,
          document.body
        )}
      </div>

      {/* Portal-injected actions: message, bell, profile */}
      {rightExtra}
    </>
  );

  return (
    <>
      {/* German flag strip — thinner for a more refined silhouette */}
      <div className="fixed top-0 left-0 right-0 h-[2px] z-[1201] flex">
        <div className="flex-1 bg-[#111]" />
        <div className="flex-1 bg-[#CC0000]" />
        <div className="flex-1 bg-[#FFCE00]" />
      </div>

      <nav
        className="fixed top-[2px] left-0 right-0 z-[1200] flex items-center justify-between px-4 sm:px-[3.5vw] h-[56px] backdrop-blur-[20px] border-b"
        style={{
          background: "var(--nav-bg)",
          borderColor: "var(--border)",
          transition: "background var(--dur-3) var(--ease), border-color var(--dur-3) var(--ease)",
        }}
      >
        <div className="flex items-center gap-1">
          {/* Public pages: show logo. Portal pages: show Dashboard + Community tabs. */}
          {portalTabs ? (
            portalTabs.map(tab => {
              const isCommunity = tab.href === "/portal/feed";
              const badge = isCommunity && communityUnread > 0 ? communityUnread : 0;
              return (
              <Link
                key={tab.href}
                href={tab.href}
                prefetch
                aria-current={tab.active ? "page" : undefined}
                className="relative inline-flex items-center px-2.5 py-[18px] text-[12px] font-semibold transition-colors duration-150 no-underline"
                style={{
                  color: tab.active ? "var(--w)" : "var(--w3)",
                  borderBottom: tab.active ? "2px solid var(--gold)" : "2px solid transparent",
                  marginBottom: "-1px",
                  letterSpacing: "-0.01em",
                }}
              >
                {tab.label}
                {badge > 0 && (
                  <span
                    className="absolute flex items-center justify-center font-bold"
                    style={{
                      top: 8, left: 6,
                      minWidth: 16, height: 16,
                      borderRadius: 99,
                      fontSize: 9,
                      padding: "0 4px",
                      background: "var(--gold)",
                      color: "#131312",
                      lineHeight: 1,
                    }}
                  >
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </Link>
              );
            })
          ) : (
            <a
              href="/"
              className="font-[family-name:var(--font-dm-serif)] italic no-underline hover:opacity-80 transition-opacity"
              style={{ fontSize: "clamp(1.15rem,3.5vw,1.4rem)", color: "var(--w)" }}
              aria-label="Borivon — Accueil"
            >
              Borivon<span style={{ color: "var(--gold)" }} className="not-italic">.</span>
            </a>
          )}
          {leftExtra}
        </div>
        {/* On mobile the actions live in the bottom bar — this slot is empty
            so the brand sits alone at the top. */}
      </nav>

      {/*
        Single, fixed-positioned action bar — one instance of {actions} only.
        CSS @media query switches its location: top-right on desktop,
        full-width bottom bar on mobile. We can't render `{actions}` twice
        (top + bottom) because every instance of <MessageIcon> opens its own
        Supabase Realtime channel — duplicates with the same channel name
        crash the page on the candidate side.
      */}
      <div
        className={`bv-actions-bar ${useBottomBar ? "bv-actions-bar--mobile-bottom" : ""}`}
        data-bv="actions"
      >
        {/* Mobile-only menu toggle (e.g. dashboard's slide-in phase rail).
            Only renders if the active page registered a menuConfig — on
            pages without a sidebar to toggle the slot is empty. Icon swaps
            from hamburger ↔ home depending on whether the menu is open. */}
        {menuConfig && (
          <button
            onClick={menuConfig.toggle}
            aria-label={menuConfig.label ?? (menuConfig.isOpen ? NT.closeMenu : NT.openMenu)}
            className="bv-mobile-menu-toggle flex items-center justify-center w-9 h-9 cursor-pointer hover:scale-110 active:scale-95"
            style={{
              background: "transparent",
              border: "none",
              color: menuConfig.isOpen ? "var(--gold)" : "var(--w3)",
              transition: "color 0.2s, transform 0.15s",
            }}
            onMouseEnter={(e) => { if (!menuConfig.isOpen) e.currentTarget.style.color = "var(--w)"; }}
            onMouseLeave={(e) => { if (!menuConfig.isOpen) e.currentTarget.style.color = "var(--w3)"; }}
          >
            {menuConfig.isOpen
              ? <Home size={18} strokeWidth={1.8} />
              : <Menu size={18} strokeWidth={1.8} />}
          </button>
        )}
        {actions}
      </div>
      <style>{`
        /* Mobile menu toggle is mobile-only — hidden on desktop where the
           sidebar is always visible. */
        @media (min-width: 640px) {
          .bv-mobile-menu-toggle { display: none !important; }
        }
      `}</style>
      <style>{`
        .bv-actions-bar {
          position: fixed;
          /* Same stack as nav so the language flag stays visible above
             modal blur backdrops (which sit at z 1100). */
          z-index: 1200;
          display: flex;
          align-items: center;
          gap: 0.6rem;
          /* Default everywhere: anchored to the top-right of the navbar.
             Vertically centered against the 56 px tall nav (44 px buttons → 6 px top). */
          top: 7px;
          right: 3.5vw;
        }
        /* Portal pages (candidate dashboard, admin) opt into the Skool-style
           mobile bottom bar by adding .bv-actions-bar--mobile-bottom. */
        @media (max-width: 639.98px) {
          .bv-actions-bar--mobile-bottom {
            top: auto;
            bottom: 0;
            left: 0;
            right: 0;
            justify-content: space-around;
            padding: 10px 12px calc(10px + env(safe-area-inset-bottom));
            background: var(--nav-bg);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border-top: 1px solid var(--border);
          }
        }
      `}</style>
    </>
  );
}
