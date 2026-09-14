"use client";

import { useEffect, useState } from "react";
import { useLang } from "@/components/LangContext";
import { MAINTENANCE_MESSAGES, isMaintenanceBody, type MaintenanceLang } from "@/lib/maintenance";

/**
 * The portal's answer to the WRITE FREEZE (lib/maintenance.ts).
 *
 * While MAINTENANCE_WRITES is on, every save answers 503. Each save path has its
 * own error handling — the upload retries twice then shows "upload failed", the
 * chat composer shows `json.error`, others show a generic failure — and none of
 * them can tell a planned ten-minute pause from a broken portal. A nurse who
 * sees "upload failed" three times assumes her document is lost and gives up.
 *
 * So this watches responses GLOBALLY (fetch and XMLHttpRequest — the document
 * upload uses XHR for its progress bar) and, when one is the freeze's 503, shows
 * one calm line in the portal's language: saving is paused, your data is safe,
 * try again shortly. It changes no response and no call site: with the flag off
 * no such 503 exists, so this never renders.
 */

const EVENT = "bv:maintenance";
/** How long the notice stays after the LAST refused save. */
const VISIBLE_MS = 60_000;

type Patched = Window & { __bvMaintenanceObserver?: boolean };

function announce(): void {
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Install once per page: wrap fetch + XHR, inspect only 503s, never alter them. */
function installObserver(): void {
  const w = window as Patched;
  if (w.__bvMaintenanceObserver) return;
  w.__bvMaintenanceObserver = true;

  const originalFetch = window.fetch;
  window.fetch = async function observedFetch(...args: Parameters<typeof fetch>) {
    const res = await originalFetch.apply(window, args);
    if (res.status === 503) {
      // A clone, read in the background: the caller's body stays unread.
      res.clone().json().then((j) => { if (isMaintenanceBody(j)) announce(); }).catch(() => {});
    }
    return res;
  } as typeof fetch;

  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function observedSend(this: XMLHttpRequest, ...args: Parameters<XMLHttpRequest["send"]>) {
    this.addEventListener("loadend", () => {
      if (this.status !== 503) return;
      // responseText throws for blob/arraybuffer response types.
      if (this.responseType !== "" && this.responseType !== "text") return;
      try { if (isMaintenanceBody(JSON.parse(this.responseText))) announce(); } catch { /* not ours */ }
    });
    return originalSend.apply(this, args);
  };
}

export function MaintenanceNotice() {
  const { lang } = useLang();
  const [until, setUntil] = useState(0);
  const [, tick] = useState(0);

  useEffect(() => {
    installObserver();
    const onHit = () => setUntil(Date.now() + VISIBLE_MS);
    window.addEventListener(EVENT, onHit);
    return () => window.removeEventListener(EVENT, onHit);
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
