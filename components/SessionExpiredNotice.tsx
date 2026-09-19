"use client";

/**
 * "Your session expired — sign in again."
 *
 * Why this exists: a dead session used to be completely invisible. The download
 * -token loop in lib/dlClient.ts kept re-minting against an expired JWT forever
 * (944 x 401 in 72 hours from two abandoned tabs), every preview stayed on its
 * spinner and every Download button did nothing, and at no point did the portal
 * say a single word about it. The admin's own report was "the PDF window won't
 * open" — the real answer was "you have been logged out for half an hour".
 *
 * So the loop now stops on a proven-dead session and flips the flag this
 * component listens to. Mount it once per page that mints download tokens; it
 * renders nothing until that happens.
 *
 * LAW #36 — canonical popup: single wrapper carrying both the blurred backdrop
 * and the card, z-[1100], radius 20. LAW #19 — FR / EN / DE.
 *
 * Deliberately NOT click-outside-dismissable: nothing on the page works while
 * the session is dead, so quietly closing it would put the person straight back
 * into the silent-failure state this replaces.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLang } from "@/components/LangContext";
import {
  DL_SESSION_EXPIRED_TEXT,
  useDlReauth,
  useDlSessionExpired,
} from "@/lib/dlClient";

export default function SessionExpiredNotice() {
  const { lang } = useLang();
  const expired = useDlSessionExpired();
  const reauth = useDlReauth();
  // The popup portals into document.body, which does not exist during SSR.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  if (!expired || !mounted) return null;
  const txt = DL_SESSION_EXPIRED_TEXT[lang];

  return createPortal(
    <div
      className="fixed inset-x-0 bottom-0 top-[58px] z-[1100] flex items-center justify-center p-4 pb-[88px] sm:pb-4"
      style={{
        background: "rgba(0,0,0,0.45)",
        backdropFilter: "blur(8px)",
        animation: "bvFadeRise .22s var(--ease-out)",
      }}
    >
      <div
        className="w-full max-w-sm rounded-[20px] p-5"
        style={{
          background: "var(--card)",
          border: "1px solid var(--border-gold)",
          boxShadow: "var(--shadow-lg)",
          animation: "bvFadeRise .28s var(--ease-out)",
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--w)" }}>{txt.title}</div>
        <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: "var(--w2)" }}>
          {txt.body}
        </div>
        <button
          onClick={reauth}
          className="mt-4 w-full rounded-[12px] py-2.5"
          style={{
            background: "var(--gold)",
            color: "#000",
            fontSize: 13,
            fontWeight: 700,
            border: "none",
            cursor: "pointer",
          }}
        >
          {txt.cta}
        </button>
      </div>
    </div>,
    document.body,
  );
}
