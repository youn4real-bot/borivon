"use client";

import { useEffect, useState } from "react";
import { useLang } from "@/components/LangContext";
import { MAINTENANCE_EVENT, MAINTENANCE_MESSAGES, type MaintenanceLang } from "@/lib/maintenance";

/**
 * The portal's answer to the WRITE FREEZE (lib/maintenance.ts).
 *
 * While MAINTENANCE_WRITES is on, every save answers 503. Each save path has its
 * own error handling — the upload retries twice then shows "upload failed",
 * others show a generic failure — and none of them can tell a planned
 * ten-minute pause from a broken portal. A nurse who sees "upload failed" three
 * times assumes her document is lost and gives up.
 *
 * So the save paths call reportIfMaintenance() on a failed answer, and this
 * shows one calm line in the portal's language: saving is paused, your data is
 * safe, try again shortly. It only LISTENS for that event. It patches nothing
 * global (no window.fetch, no XMLHttpRequest): with the flag off it renders
 * nothing and changes nothing on any page.
 */

/** How long the notice stays after the LAST refused save. */
const VISIBLE_MS = 60_000;

export function MaintenanceNotice() {
  const { lang } = useLang();
  const [until, setUntil] = useState(0);
  const [, tick] = useState(0);

  useEffect(() => {
    const onHit = () => setUntil(Date.now() + VISIBLE_MS);
    window.addEventListener(MAINTENANCE_EVENT, onHit);
    return () => window.removeEventListener(MAINTENANCE_EVENT, onHit);
  }, []);

  useEffect(() => {
    if (!until) return;
    const t = setTimeout(() => tick((n) => n + 1), Math.max(0, until - Date.now()) + 50);
    return () => clearTimeout(t);
  }, [until]);

  if (!until || Date.now() > until) return null;

  const key: MaintenanceLang = lang === "de" || lang === "en" ? lang : "fr";
  const close = lang === "de" ? "Schließen" : lang === "fr" ? "Fermer" : "Close";

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-1/2 -translate-x-1/2 z-[1100] flex items-start gap-3 px-4 py-3 text-[13px]"
      style={{
        top: 16,
        width: "min(560px, calc(100vw - 24px))",
        background: "var(--card)",
        color: "var(--w)",
        border: "1px solid var(--border-gold)",
        borderRadius: 20,
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        lineHeight: 1.45,
      }}
    >
      <span className="flex-1">{MAINTENANCE_MESSAGES[key]}</span>
      <button
        type="button"
        onClick={() => setUntil(0)}
        aria-label={close}
        className="shrink-0"
        style={{ color: "var(--w3)", background: "none", border: "none", cursor: "pointer", fontSize: 16, lineHeight: 1 }}
      >
        ×
      </button>
    </div>
  );
}
