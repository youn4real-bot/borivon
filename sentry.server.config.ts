/**
 * Sentry — SERVER runtime init. Fully INERT unless SENTRY_DSN is set, so this
 * ships safely today and "turns on" the moment you paste the DSN into the env —
 * no code change. Loaded by instrumentation.ts register() on the Node runtime.
 */
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1, // 10% perf traces — plenty at this volume, near-zero cost
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
  });
}
