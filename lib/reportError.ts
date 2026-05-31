/**
 * Minimal, provider-agnostic server-error reporter. Two sinks, both safe:
 *
 *  1. ALWAYS — one structured JSON line to stderr (console.error). Lands in the
 *     Vercel / Workers logs, is queryable, and `next.config` keeps console.error
 *     in production builds. Never throws.
 *  2. OPTIONAL — if ERROR_WEBHOOK_URL is set, a fire-and-forget POST of a compact
 *     summary to that URL (a Slack or Discord incoming webhook, or any HTTP
 *     sink) so the team is pinged the instant a request errors. INERT when the
 *     env var is absent, so this ships safely before any webhook exists and
 *     "turns on" the moment the URL is added — no code change.
 *
 * Never throws, never blocks the response. Reporting must not be able to break
 * the app, so every path swallows its own errors.
 */

type ErrCtx = {
  route?: string;
  method?: string;
  routerKind?: string;
  renderSource?: string;
  [k: string]: unknown;
};

export function reportError(err: unknown, ctx: ErrCtx = {}): void {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;

  // Sink 1 — structured log (always).
  try {
    console.error(
      "[error]",
      JSON.stringify({ level: "error", message, ...ctx, stack, ts: new Date().toISOString() }),
    );
  } catch {
    /* logging must never throw */
  }

  // Sink 2 — optional webhook alert. Fire-and-forget, timeout-bounded.
  const hook = process.env.ERROR_WEBHOOK_URL;
  if (!hook) return;
  const text = `🔴 Borivon server error\n${message}\n${`${ctx.method ?? ""} ${ctx.route ?? ""}`.trim()}`;
  try {
    // Slack expects {text}; Discord expects {content}; send both — each ignores
    // the field it doesn't use, so one URL works for either provider.
    void fetch(hook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, content: text }),
      signal: AbortSignal.timeout(2500),
      cache: "no-store",
    }).catch(() => {
      /* swallow — reporting failure must never surface */
    });
  } catch {
    /* swallow */
  }
}
