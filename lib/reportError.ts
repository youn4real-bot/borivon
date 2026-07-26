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
 *  3. OPTIONAL — Sentry (rich backend: grouping, full stack traces, a searchable
 *     dashboard, client-side errors). No-op unless SENTRY_DSN is set and init ran
 *     (see sentry.*.config.ts). Adds nothing to the bundle's behavior until then.
 *  4. OPTIONAL — Telegram ping straight to the founder's own chat (reuses the bot
 *     token + the locked TELEGRAM_CHAT_ID — ZERO extra setup). So the founder is
 *     alerted in the chat he already lives in the instant something breaks, with
 *     no Slack/Sentry signup. Throttled so a hot error can't spam the chat.
 *
 * Never throws, never blocks the response. Reporting must not be able to break
 * the app, so every path swallows its own errors.
 */
import * as Sentry from "@sentry/nextjs";
import { keepAlive } from "@/lib/keepAlive";

type ErrCtx = {
  route?: string;
  method?: string;
  routerKind?: string;
  renderSource?: string;
  [k: string]: unknown;
};

// In-memory throttle so one hot error can't flood the chat: the same message
// alerts at most once per 60s per warm instance. Best-effort (resets on cold
// start) — that's fine, the goal is anti-spam, not exactly-once.
const _lastAlert = new Map<string, number>();
function shouldAlert(key: string): boolean {
  const now = Date.now();
  if (now - (_lastAlert.get(key) ?? 0) < 60_000) return false;
  _lastAlert.set(key, now);
  if (_lastAlert.size > 200) {
    for (const k of _lastAlert.keys()) { _lastAlert.delete(k); if (_lastAlert.size <= 100) break; }
  }
  return true;
}

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

  // Sink 3 — Sentry (rich backend). No-op unless SENTRY_DSN was set + init ran.
  try {
    Sentry.captureException(err instanceof Error ? err : new Error(message), { extra: { ...ctx } });
  } catch {
    /* reporting must never throw */
  }

  const where = `${ctx.method ?? ""} ${ctx.route ?? ""}`.trim();
  const summary = `🔴 Borivon error\n${message}${where ? `\n${where}` : ""}${ctx.tool ? `\ntool: ${ctx.tool}` : ""}`;

  // Sink 2 — optional webhook alert (Slack / Discord). Fire-and-forget.
  const hook = process.env.ERROR_WEBHOOK_URL;
  if (hook) {
    try {
      // Slack expects {text}; Discord expects {content}; send both — each ignores
      // the field it doesn't use, so one URL works for either provider.
      // keepAlive, not `void`: on Workers a bare floating fetch is CANCELLED the
      // instant the response returns, so the alert never left the building.
      keepAlive(() => fetch(hook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: summary, content: summary }),
        signal: AbortSignal.timeout(2500),
        cache: "no-store",
      }));
    } catch { /* swallow */ }
  }

  // Sink 4 — Telegram ping to the founder's own chat. Zero setup: reuses the bot
  // token + locked chat id. Throttled per-message so it can't spam.
  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  const tgChat = process.env.TELEGRAM_CHAT_ID;
  if (tgToken && tgChat && shouldAlert(message)) {
    try {
      // THE ALARM ITSELF. As a bare `void fetch` this was cancelled at response
      // end on Workers — the one mechanism meant to tell the founder something
      // broke was silently disarmed by the migration.
      keepAlive(() => fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: tgChat, text: summary.slice(0, 3500), disable_web_page_preview: true }),
        signal: AbortSignal.timeout(2500),
        cache: "no-store",
      }));
    } catch { /* swallow */ }
  }
}
