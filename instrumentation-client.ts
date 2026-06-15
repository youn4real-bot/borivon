/**
 * Sentry — BROWSER init. INERT unless NEXT_PUBLIC_SENTRY_DSN is set. Next 15
 * auto-loads this file on the client. Captures client-side errors — the half a
 * server-only reporter (lib/reportError) can't see.
 */
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV || "development",
  });
}
