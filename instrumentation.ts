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

export function register(): void {
  // Reserved for future server-boot init (tracing, etc.). Intentionally empty.
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
