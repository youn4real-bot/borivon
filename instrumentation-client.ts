/**
 * Sentry — BROWSER init. INERT unless NEXT_PUBLIC_SENTRY_DSN is set. Next 15
 * auto-loads this file on the client. Captures client-side errors — the half a
 * server-only reporter (lib/reportError) can't see.
 *
 * The import is DYNAMIC, and that is the whole point. A static
 * `import * as Sentry from "@sentry/nextjs"` ships the ENTIRE browser SDK to every
 * visitor whether or not a DSN exists — the `if (dsn)` guard only skips init(), it
 * cannot un-download the library. No DSN is configured, so ~47 kB gzipped of the
 * 176 kB shared baseline was being downloaded and parsed by every nurse on Moroccan
 * mobile data, on every page, to do precisely nothing.
 *
 * NEXT_PUBLIC_* is inlined at build time, so with no DSN the condition folds to
 * false and the bundler drops the import entirely. If a DSN is ever set, Sentry
 * loads asynchronously AFTER first paint instead of blocking it — which is where an
 * error reporter belongs anyway.
 */

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  void import("@sentry/nextjs").then((Sentry) => {
    Sentry.init({
      dsn,
      tracesSampleRate: 0.1,
      environment: process.env.NEXT_PUBLIC_VERCEL_ENV || "development",
    });
  });
}
