"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useLang } from "@/components/LangContext";

/**
 * Instagram-style verified badge.
 *   - Always sits next to a name (NEVER overlaid on the avatar).
 *   - Hovering shows a native tooltip ("Verified").
 *   - Clicking opens a small popover explaining what verified means
 *     (passport approved + Lebenslauf approved, or "Borivon team" for admin).
 *
 * Sizes:
 *   - "xs"  → next to a name in a chat bubble (~13px)
 *   - "sm"  → next to a row label / list item (~15px)
 *   - "md"  → in a profile-page header (~22px)
 */

const VB_T = {
  fr: { tooltip: "Vérifié", title: "Compte vérifié", body: "Borivon a vérifié l'identité et le diplôme infirmier de cette personne. Le passeport a été approuvé et le Lebenslauf est disponible.", adminTitle: "Compte officiel Borivon", adminBody: "Compte officiel de l'équipe Borivon.", close: "Fermer" },
  en: { tooltip: "Verified", title: "Verified account",      body: "Borivon has verified this person's identity and nursing background. Their passport has been approved and a Lebenslauf is available.",                          adminTitle: "Official Borivon account",   adminBody: "Official account of the Borivon team.",                          close: "Close" },
  de: { tooltip: "Verifiziert", title: "Verifiziertes Konto", body: "Borivon hat die Identität und den Pflegehintergrund dieser Person geprüft. Der Reisepass wurde genehmigt und ein Lebenslauf liegt vor.",                          adminTitle: "Offizielles Borivon-Konto", adminBody: "Offizielles Konto des Borivon-Teams.",                          close: "Schließen" },
} as const;

export function VerifiedBadge({
  verified, size = "sm", title, isAdmin = false,
}: {
  verified: boolean | null | undefined;
  size?: "xs" | "sm" | "md";
  title?: string;
  isAdmin?: boolean;
}) {
  const { lang } = useLang();
  const t = VB_T[(lang as "fr" | "en" | "de") in VB_T ? (lang as "fr" | "en" | "de") : "en"];
  const [open, setOpen] = useState(false);

  if (!verified) return null;
  const px = size === "xs" ? 14 : size === "md" ? 24 : 16;

  return (
    <>
      <button
        type="button"
        title={title ?? t.tooltip}
        aria-label={title ?? t.tooltip}
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen(true); }}
        className="inline-flex items-center justify-center align-middle flex-shrink-0 cursor-pointer"
        style={{
          width: px,
          height: px,
          marginLeft: 4,
          padding: 0,
          border: "none",
          background: "transparent",
        }}
      >
        {/* Instagram-style scalloped/starburst verified badge — 12 bumps */}
        <svg width={px} height={px} viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M19.998 3.094 14.638 0l-2.972 5.15H5.432v6.354L0 14.64 3.094 20 0 25.359l5.432 3.137v6.355h6.234L14.638 40l5.36-3.094L25.358 40l2.978-5.149h6.227v-6.355L40 25.359 36.905 20 40 14.64l-5.438-3.135V5.15h-6.227L25.358 0l-5.36 3.094Z"
            fill="#0095F6"
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
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-x-0 bottom-0 top-[58px] z-[1900] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)" }}
          onClick={() => setOpen(false)}>
          <div className="w-full max-w-[360px] p-6 text-center"
            style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-lg)" }}
            onClick={e => e.stopPropagation()}>
            <span className="inline-flex items-center justify-center mb-3"
              style={{ width: 48, height: 48, borderRadius: "50%", background: "#1da1f2", color: "#fff" }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
            <p className="text-[15px] font-semibold tracking-tight mb-2" style={{ color: "var(--w)" }}>
              {isAdmin ? t.adminTitle : t.title}
            </p>
            <p className="text-[12.5px] leading-relaxed mb-5" style={{ color: "var(--w3)" }}>
              {isAdmin ? t.adminBody : t.body}
            </p>
            <button onClick={() => setOpen(false)}
              className="inline-flex items-center px-4 py-1.5 text-[12px] font-semibold rounded-full"
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
