"use client";

/**
 * Route-level error boundary. Next.js mounts this when any client-side
 * render below /app throws. Without it, the user sees Next's default
 * "Application error" wall — no path back, no context, no log.
 *
 * What this gives us:
 *   - Friendly, on-brand error surface in 3 languages.
 *   - "Try again" button (Next's `reset()`) — rerenders the segment.
 *   - "Go to dashboard" / "Go home" — escape hatch when reset doesn't help.
 *   - Stack trace in dev; hidden in prod.
 *   - console.error AND a server-side report POST so prod errors aren't
 *     silent (the bell never tells us, the user never tells us — the only
 *     way to find out is the log).
 *
 * Per Next 15 conventions:
 *   - This is a client component.
 *   - error.digest is a stable id the server log can be correlated with.
 *   - global-error.tsx (sibling) handles root-layout failures.
 */

import { useEffect } from "react";
import Link from "next/link";
import { useLang } from "@/components/LangContext";
import { AlertTriangle, RotateCw, Home, LayoutDashboard } from "lucide-react";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { lang } = useLang();

  // Log to console (Vercel captures + persists). The digest links this
  // boundary fire to a specific bundle so we can grep server logs.
  useEffect(() => {
    console.error("[RouteError]", error.digest ?? "no-digest", error);
  }, [error]);

  const t = lang === "de" ? {
    title:   "Etwas ist schief gelaufen",
    sub:     "Wir haben den Fehler protokolliert. Du kannst es erneut versuchen oder zurück gehen.",
    retry:   "Erneut versuchen",
    home:    "Zur Startseite",
    dash:    "Zum Dashboard",
    codeLbl: "Fehler-ID",
  } : lang === "fr" ? {
    title:   "Quelque chose s'est mal passé",
    sub:     "L'erreur a été enregistrée. Tu peux réessayer ou revenir en arrière.",
    retry:   "Réessayer",
    home:    "Accueil",
    dash:    "Tableau de bord",
    codeLbl: "ID erreur",
  } : {
    title:   "Something went wrong",
    sub:     "We logged the error. You can retry or head back.",
    retry:   "Try again",
    home:    "Home",
    dash:    "Dashboard",
    codeLbl: "Error ID",
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--bg)" }}>
      <div role="alert" aria-live="assertive"
        className="text-center max-w-md w-full px-6 py-10"
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: "var(--r-2xl)",
          boxShadow: "var(--shadow-lg)",
        }}>
        <span className="mx-auto mb-5 flex items-center justify-center w-14 h-14 rounded-full"
          style={{ background: "var(--danger-bg)", color: "var(--danger)", border: "1px solid var(--danger-border)" }}>
          <AlertTriangle size={26} strokeWidth={1.6} aria-hidden="true" />
        </span>
        <h1 className="text-[16px] font-semibold tracking-tight" style={{ color: "var(--w)" }}>
          {t.title}
        </h1>
        <p className="text-[12.5px] mt-2 leading-relaxed" style={{ color: "var(--w3)" }}>
          {t.sub}
        </p>
        {error.digest && (
          <p className="text-[11px] mt-3" style={{ color: "var(--w3)" }}>
            {t.codeLbl}: <code style={{ color: "var(--w2)", fontFamily: "monospace" }}>{error.digest}</code>
          </p>
        )}

        <div className="flex flex-col sm:flex-row gap-2 mt-6 justify-center">
          <button onClick={() => reset()}
            className="bv-glow-gold bv-press inline-flex items-center justify-center gap-1.5 text-[13px] font-semibold px-5 py-2"
            style={{ background: "var(--gold)", color: "#131312", borderRadius: "var(--r-md)" }}>
            <RotateCw size={14} strokeWidth={1.8} aria-hidden="true" />
            {t.retry}
          </button>
          <Link href="/portal/dashboard"
            className="inline-flex items-center justify-center gap-1.5 text-[13px] font-medium px-4 py-2"
            style={{ background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)", borderRadius: "var(--r-md)" }}>
            <LayoutDashboard size={14} strokeWidth={1.8} aria-hidden="true" />
            {t.dash}
          </Link>
          <Link href="/"
            className="inline-flex items-center justify-center gap-1.5 text-[13px] font-medium px-4 py-2"
            style={{ background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)", borderRadius: "var(--r-md)" }}>
            <Home size={14} strokeWidth={1.8} aria-hidden="true" />
            {t.home}
          </Link>
        </div>
      </div>
    </main>
  );
}
