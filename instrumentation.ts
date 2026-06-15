/**
 * Next.js instrumentation (stable in Next 15).
 *
 * `onRequestError` is Next's official hook for unhandled server-side errors —
 * it fires for throws in route handlers, server components, and middleware.
 * We forward every one to reportError() → structured log + optional webhook
 * alert (lib/reportError.ts). This is the server-error visibility layer for
 * running at scale: today it logs structured JSON; set ERROR_WEBHOOK_URL and
 * the same errors also ping a Slack/Discord channel.
 *
 * `register()` is required by the instrumentation contract — nothing to boot.
 */
import { reportError } from "@/lib/reportError";
import * as Sentry from "@sentry/nextjs";

export async function register(): Promise<void> {
  // Boot Sentry for the active server runtime. INERT without SENTRY_DSN — the
  // config files no-op when the DSN is absent, so this is safe before signup.
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./sentry.server.config");
  else if (process.env.NEXT_RUNTIME === "edge") await import("./sentry.edge.config");
}

// Permissive param types: Next calls this structurally with a richer object;
// we only read these fields and access them defensively.
export async function onRequestError(
  err: unknown,
  request: { path?: string; method?: string },
  context: { routerKind?: string; routePath?: string; renderSource?: string },
): Promise<void> {
  reportError(err, {
    route: request?.path,
    method: request?.method,
    routerKind: context?.routerKind,
    renderSource: context?.renderSource,
  });
  // Also forward to Sentry's request-error capture (no-op unless DSN configured).
  try {
    Sentry.captureRequestError(
      err,
      request as Parameters<typeof Sentry.captureRequestError>[1],
      context as Parameters<typeof Sentry.captureRequestError>[2],
    );
  } catch {
    /* reporting must never throw */
  }
}
