"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useLang } from "@/components/LangContext";

/**
 * Instagram-style verified badge.
 *   - Always sits next to a name (NEVER overlaid on the avatar).
 *   - Hovering shows a native tooltip ("Verified").
 *   - Clicking opens a small popover.
 *
 * Sizes:
 *   - "xs"  → next to a name in a list row / chat header (~13px)
 *   - "sm"  → next to a row label (~16px)
 *   - "md"  → in a profile-page header (~24px)
 *
 * z-index: popup uses z-[1500] — above every other modal in the app so the
 * tick popup always renders on top regardless of where it is clicked from.
 */

const VB_T = {
  fr: {
    tooltip: "Vérifié",
    title: "Compte vérifié",
    body: "Ce candidat a souscrit au plan Borivon Premium.",
    memberTitle: "Membre vérifié",
    memberBody: "Ce compte est un membre vérifié d'une organisation partenaire de Borivon.",
    adminTitle: "Youness Taoufiq",
    adminBody: "Compte officiel Borivon.",
    close: "Fermer",
  },
  en: {
    tooltip: "Verified",
    title: "Verified account",
    body: "This candidate is on the Borivon Premium plan.",
    memberTitle: "Verified organization member",
    memberBody: "This account is a verified member of a Borivon partner organization.",
    adminTitle: "Youness Taoufiq",
    adminBody: "Official Borivon account.",
    close: "Close",
  },
  de: {
    tooltip: "Verifiziert",
    title: "Verifiziertes Konto",
    body: "Dieser Kandidat hat den Borivon-Premium-Plan.",
    memberTitle: "Verifiziertes Organisationsmitglied",
    memberBody: "Dieses Konto ist ein verifiziertes Mitglied einer Borivon-Partnerorganisation.",
    adminTitle: "Youness Taoufiq",
    adminBody: "Offizielles Borivon-Konto.",
    close: "Schließen",
  },
} as const;

export function VerifiedBadge({
  verified, size = "sm", title, isAdmin = false, color = "gold", name,
}: {
  verified: boolean | null | undefined;
  size?: "xs" | "sm" | "md";
  title?: string;
  isAdmin?: boolean;
  /** Account holder's name. For the BLACK (Borivon team) popup the title must
   *  match the name shown next to the tick — supreme OR sub-admin — never a
   *  hardcoded person. Falls back to the generic admin title if absent. */
  name?: string;
  /** Badge colour:
   *  "gold"  — verified candidate (default)
   *  "red"   — org admin
   *  "black" — supreme admin (Youness / Borivon)
   */
  color?: "gold" | "red" | "black";
}) {
  const { lang } = useLang();
  const t = VB_T[(lang as "fr" | "en" | "de") in VB_T ? (lang as "fr" | "en" | "de") : "en"];
  const [open, setOpen] = useState(false);

  if (!verified) return null;
  const px = size === "xs" ? 14 : size === "md" ? 24 : 16;
  const isBlack = color === "black";
  const fillColor = isBlack ? "url(#bvBlackShine)" : color === "red" ? "#e03030" : "#c9a240";
  const gradId = `bvBlackShine_${size}`;

  return (
    <>
      <span
        role="button"
        tabIndex={0}
        title={title ?? t.tooltip}
        aria-label={title ?? t.tooltip}
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen(true); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); e.preventDefault(); setOpen(true); } }}
        className="inline-flex items-center justify-center align-middle flex-shrink-0 cursor-pointer"
        style={{ width: px, height: px, marginLeft: 4, padding: 0, border: "none", background: "transparent" }}
      >
        <svg width={px} height={px} viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
          {isBlack && (
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#4a4a4a" />
                <stop offset="40%" stopColor="#1c1c1e" />
                <stop offset="100%" stopColor="#000000" />
              </linearGradient>
            </defs>
          )}
          <path
            d="M19.998 3.094 14.638 0l-2.972 5.15H5.432v6.354L0 14.64 3.094 20 0 25.359l5.432 3.137v6.355h6.234L14.638 40l5.36-3.094L25.358 40l2.978-5.149h6.227v-6.355L40 25.359 36.905 20 40 14.64l-5.438-3.135V5.15h-6.227L25.358 0l-5.36 3.094Z"
            fill={isBlack ? `url(#${gradId})` : fillColor}
            stroke={isBlack ? "rgba(255,255,255,0.28)" : "none"}
            strokeWidth={isBlack ? "1.2" : "0"}
          />
          <path
            d="m13 19.5 4.5 4 7-7"
            stroke="#FFFFFF"
            strokeWidth="3.2"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>

      {open && typeof document !== "undefined" && createPortal(
        <div
          className="fixed inset-x-0 bottom-0 top-[58px] z-[9999] flex items-center justify-center p-4 bv-modal-outer"
          style={{
            background: "rgba(0,0,0,0.55)",
            backdropFilter: "blur(8px)",
            paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
          }}
          onClick={() => setOpen(false)}>
          <div className="w-full max-w-[340px] p-6 text-center"
            style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-lg)" }}
            onClick={e => e.stopPropagation()}>

            {/* Same starburst icon — consistent with the inline badge */}
            <div className="flex justify-center mb-4">
              <svg width={52} height={52} viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
                {isBlack && (
                  <defs>
                    <linearGradient id={`${gradId}_lg`} x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#4a4a4a" />
                      <stop offset="40%" stopColor="#1c1c1e" />
                      <stop offset="100%" stopColor="#000000" />
                    </linearGradient>
                  </defs>
                )}
                <path d="M19.998 3.094 14.638 0l-2.972 5.15H5.432v6.354L0 14.64 3.094 20 0 25.359l5.432 3.137v6.355h6.234L14.638 40l5.36-3.094L25.358 40l2.978-5.149h6.227v-6.355L40 25.359 36.905 20 40 14.64l-5.438-3.135V5.15h-6.227L25.358 0l-5.36 3.094Z" fill={isBlack ? `url(#${gradId}_lg)` : fillColor} stroke={isBlack ? "rgba(255,255,255,0.28)" : "none"} strokeWidth={isBlack ? "1.2" : "0"} />
                <path d="m13 19.5 4.5 4 7-7" stroke="#FFFFFF" strokeWidth="3.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>

            <p className="text-[15px] font-semibold tracking-tight mb-2" style={{ color: "var(--w)" }}>
              {isAdmin ? (name?.trim() || t.adminTitle) : color === "red" ? t.memberTitle : t.title}
            </p>
            <p className="text-[12.5px] leading-relaxed mb-5" style={{ color: "var(--w3)" }}>
              {isAdmin ? t.adminBody : color === "red" ? t.memberBody : t.body}
            </p>
            <button onClick={() => setOpen(false)}
              className="inline-flex items-center px-5 py-1.5 text-[12px] font-semibold rounded-full"
              style={{ background: "var(--bg2)", color: "var(--w)", border: "1px solid var(--border)" }}>
              {t.close}
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
