"use client";

/**
 * Watches the Supabase session and shows a non-blocking toast 5 minutes before
 * expiry, with a "Stay signed in" button that refreshes the JWT.
 *
 * Mount once at the root of any authenticated portal page:
 *   <SessionExpiryWatcher />
 *
 * Without this, candidates filling the long CV form or admins reviewing many
 * docs were getting silently signed out mid-task — Supabase JWT lifetime is
 * 60 minutes by default. This re-keys on every TOKEN_REFRESHED event so the
 * timer always reflects the current expires_at.
 */

import * as React from "react";
import { supabase } from "@/lib/supabase";
import { Spinner } from "@/components/ui/states";
import { Clock, X as XIcon } from "lucide-react";
import { useLang } from "@/components/LangContext";

const WARN_BEFORE_MS = 5 * 60 * 1000; // show warning 5 min before expiry

const SE_T = {
  fr: { kicker: "Session expirante", line1: "Vous serez déconnecté dans", body: "Restez connecté pour ne rien perdre. Nous renouvelons votre session sans bruit.", stay: "Rester connecté", refreshing: "Renouvellement…", dismiss: "Ignorer", close: "Fermer" },
  en: { kicker: "Session expiring",  line1: "You'll be signed out in",   body: "Stay signed in to keep your work safe. We'll refresh your session quietly.",     stay: "Stay signed in",  refreshing: "Refreshing…",     dismiss: "Dismiss", close: "Close" },
  de: { kicker: "Sitzung läuft ab",  line1: "Sie werden abgemeldet in",  body: "Bleiben Sie angemeldet, um Ihre Arbeit zu sichern. Wir aktualisieren Ihre Sitzung im Hintergrund.", stay: "Angemeldet bleiben", refreshing: "Aktualisieren…", dismiss: "Ausblenden", close: "Schließen" },
} as const;

export function SessionExpiryWatcher() {
  const { lang } = useLang();
  const t = SE_T[(lang as "fr" | "en" | "de") in SE_T ? (lang as "fr" | "en" | "de") : "en"];
  const [warningOpen, setWarningOpen] = React.useState(false);
  const [secondsLeft, setSecondsLeft] = React.useState(0);
  const [refreshing, setRefreshing]   = React.useState(false);
  const expiresAtRef    = React.useRef<number | null>(null);
  const warningTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickIntervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  // Schedule the warning based on current session.expires_at
  const schedule = React.useCallback(() => {
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    if (tickIntervalRef.current) clearInterval(tickIntervalRef.current);
    setWarningOpen(false);

    supabase.auth.getSession().then(({ data: { session } }) => {
      const expSec = session?.expires_at;
      if (!expSec) return;
      const expMs = expSec * 1000;
      expiresAtRef.current = expMs;

      const fireInMs = expMs - Date.now() - WARN_BEFORE_MS;
      if (fireInMs <= 0) {
        // Already inside the warning window
        showWarning();
      } else {
        warningTimerRef.current = setTimeout(showWarning, fireInMs);
      }
    });

    function showWarning() {
      setWarningOpen(true);
      const tick = () => {
        if (!expiresAtRef.current) return;
        const left = Math.max(0, Math.floor((expiresAtRef.current - Date.now()) / 1000));
        setSecondsLeft(left);
        if (left <= 0 && tickIntervalRef.current) {
          clearInterval(tickIntervalRef.current);
        }
      };
      tick();
      tickIntervalRef.current = setInterval(tick, 1000);
    }
  }, []);

  React.useEffect(() => {
    schedule();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      // Re-schedule on any token-affecting event
      if (event === "TOKEN_REFRESHED" || event === "SIGNED_IN") schedule();
      if (event === "SIGNED_OUT") {
        if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
        if (tickIntervalRef.current) clearInterval(tickIntervalRef.current);
        setWarningOpen(false);
      }
    });
    return () => {
      subscription.unsubscribe();
      if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
      if (tickIntervalRef.current) clearInterval(tickIntervalRef.current);
    };
  }, [schedule]);

  async function stayIn() {
    setRefreshing(true);
    try {
      await supabase.auth.refreshSession();
      // schedule() will run via the TOKEN_REFRESHED listener
    } finally {
      setRefreshing(false);
    }
  }

  if (!warningOpen) return null;

  const min = Math.floor(secondsLeft / 60);
  const sec = secondsLeft % 60;
  const timeStr = min > 0 ? `${min}:${sec.toString().padStart(2, "0")}` : `${sec}s`;

  return (
    <div
      className="fixed z-[800] left-4 right-4 sm:left-auto sm:right-6 sm:max-w-[360px] bottom-[calc(1rem+72px)] sm:bottom-6"
      style={{ animation: "bvFadeRise 0.32s var(--ease-out) both" }}
      role="alert"
      aria-live="polite"
    >
      <div className="overflow-hidden p-4"
        style={{
          background: "var(--card)",
          border: "1px solid var(--border-gold)",
          borderRadius: "var(--r-xl)",
          boxShadow: "var(--shadow-lg)",
        }}>
        <div className="flex items-start gap-3">
          <span className="flex items-center justify-center w-9 h-9 rounded-full flex-shrink-0"
            style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>
            <Clock size={16} strokeWidth={1.7} />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] mb-1" style={{ color: "var(--gold)" }}>
              {t.kicker}
            </p>
            <p className="text-[13px] font-semibold tracking-tight mb-1" style={{ color: "var(--w)" }}>
              {t.line1} <span className="tabular-nums" style={{ color: "var(--gold)" }}>{timeStr}</span>
            </p>
            <p className="text-[11.5px] leading-relaxed mb-3" style={{ color: "var(--w3)" }}>
              {t.body}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={stayIn}
                disabled={refreshing}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold tracking-tight transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: "var(--gold)", color: "#131312", borderRadius: "var(--r-sm)", boxShadow: "var(--shadow-sm)" }}>
                {refreshing ? <Spinner size="xs" color="#131312" /> : null}
                {refreshing ? t.refreshing : t.stay}
              </button>
              <button
                onClick={() => setWarningOpen(false)}
                className="text-[12px] font-medium px-2 py-1.5 transition-colors"
                style={{ color: "var(--w3)" }}
                onMouseEnter={e => (e.currentTarget.style.color = "var(--w)")}
                onMouseLeave={e => (e.currentTarget.style.color = "var(--w3)")}>
                {t.dismiss}
              </button>
            </div>
          </div>
          <button
            onClick={() => setWarningOpen(false)}
            aria-label={t.close}
            className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-colors -mt-1 -mr-1"
            style={{ color: "var(--w3)" }}
            onMouseEnter={e => { e.currentTarget.style.background = "var(--bg2)"; e.currentTarget.style.color = "var(--w)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--w3)"; }}>
            <XIcon size={14} strokeWidth={1.8} />
          </button>
        </div>
      </div>
    </div>
  );
}
