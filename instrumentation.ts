/**
 * Next.js instrumentation (stable in Next 15).
 *
 * `onRequestError` is Next's official hook for unhandled server-side errors —
 * it fires for throws in route handlers, server components, and middleware.
 * We forward every one to reportError() → structured log + optional webhook
 * alert + Telegram ping (lib/reportError.ts). This is the server-error
 * visibility layer: today it logs structured JSON; set ERROR_WEBHOOK_URL and
 * the same errors also ping a Slack/Discord channel.
 *
 * NO SENTRY HERE, DELIBERATELY. A static `import * as Sentry from
 * "@sentry/nextjs"` put 2,065,127 bytes into the server build —
 * .next/server/instrumentation.js (1,177,809 B) plus the shared
 * chunks/9486.js (887,318 B), both @sentry/node + OpenTelemetry — and another
 * 510,337 B into edge-instrumentation.js. On Cloudflare Workers the whole
 * script is parsed on every cold isolate, and OpenTelemetry does not stop at
 * parsing: it patches globals and builds an instrumentation registry at
 * module-evaluation time. All of it ran on every cold start to do nothing,
 * because no SENTRY_DSN or NEXT_PUBLIC_SENTRY_DSN exists in wrangler.jsonc,
 * .env.local or .env.example — every call site was already a no-op.
 *
 * Making the import dynamic would NOT have helped: OpenNext inlines dynamic
 * imports into the one Worker script (measured in this repo — it made
 * handler.mjs 35 KB BIGGER), so the bytes stay and the parse cost is still
 * paid. A `if (dsn)` guard would not help either: process.env.SENTRY_DSN is a
 * runtime lookup, so webpack cannot fold it away. Only deleting the import
 * removes the bytes.
 *
 * The BROWSER half (instrumentation-client.ts) is untouched and already
 * correct: it dynamic-imports Sentry behind NEXT_PUBLIC_SENTRY_DSN, which IS
 * inlined at build time, so the bundler drops it while no DSN is set. Wanting
 * Sentry back on the server is a deliberate re-add, not an accident.
 *
 * `register()` is required by the instrumentation contract — nothing to boot.
 */
import { reportError } from "@/lib/reportError";

export async function register(): Promise<void> {
  // Nothing to boot. The export stays because it IS the contract: Next only
  // treats this file as instrumentation when it exports register(), and
  // dropping it would take onRequestError down with it.
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
}
