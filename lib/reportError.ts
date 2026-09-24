/**
 * Minimal, provider-agnostic server-error reporter. Three sinks, all safe:
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
 *  3. OPTIONAL — Telegram ping straight to the founder's own chat (reuses the bot
 *     token + the locked TELEGRAM_CHAT_ID — ZERO extra setup). So the founder is
 *     alerted in the chat he already lives in the instant something breaks, with
 *     no Slack signup. Throttled so a hot error can't spam the chat. NOT on the
 *     edge runtime — see the comment above that sink for what it cost there.
 *
 * There used to be a fourth sink, Sentry, and removing it is what this comment
 * is for. `import * as Sentry from "@sentry/nextjs"` here and in
 * instrumentation.ts compiled 2,065,127 bytes of @sentry/node + OpenTelemetry
 * into the server build (.next/server/instrumentation.js 1,177,809 B +
 * chunks/9486.js 887,318 B), which every cold Cloudflare isolate had to parse
 * AND evaluate — OpenTelemetry patches globals at import time — in order to do
 * nothing at all, because no SENTRY_DSN is configured anywhere, so
 * captureException was already a no-op. The three sinks below are the ones that
 * actually reach a human. Re-adding Sentry means re-adding those bytes: it is a
 * decision, not a tidy-up.
 *
 * Never throws, never blocks the response. Reporting must not be able to break
 * the app, so every path swallows its own errors.
 */
import { keepAlive } from "@/lib/keepAlive";

type ErrCtx = {
  route?: string;
  method?: string;
  routerKind?: string;
  renderSource?: string;
  [k: string]: unknown;
};

// In-memory throttle so one hot error can't flood the chat.
//
// PER-ISOLATE ON WORKERS, and that changes the maths. On a Vercel lambda one warm
// instance meant one 60-second window, so the same error alerted about once a
// minute. On workerd this Map lives in EACH isolate, and a burst is exactly when
// Cloudflare spins up many of them — so the real rate became once per minute
// PER ISOLATE. The failure mode is not just noise: Telegram rate-limits the bot,
// and a 429'd bot silently drops the alerts the founder actually needs, so the
// anti-spam guard turns into an outage of the alerting itself.
//
// Two changes, both deliberately dependency-free: this runs inside error
// handling, and a throttle that needs a database is a throttle that fails
// exactly when the database is what broke.
//   • 10-minute window instead of 60s, so N isolates produce at most N messages
//     per 10 minutes for one error rather than N per minute.
//   • A hard ceiling per isolate lifetime. Distinct-but-related errors (one per
//     candidate id, say) evade a per-key window entirely; nothing evades a cap.
const ALERT_WINDOW_MS = 10 * 60_000;
const MAX_ALERTS_PER_ISOLATE = 20;
const _lastAlert = new Map<string, number>();
let _alertsSent = 0;
function shouldAlert(key: string): boolean {
  if (_alertsSent >= MAX_ALERTS_PER_ISOLATE) return false;
  const now = Date.now();
  if (now - (_lastAlert.get(key) ?? 0) < ALERT_WINDOW_MS) return false;
  _lastAlert.set(key, now);
  _alertsSent++;
  if (_lastAlert.size > 200) {
    for (const k of _lastAlert.keys()) { _lastAlert.delete(k); if (_lastAlert.size <= 100) break; }
  }
  return true;
}

export async function reportError(err: unknown, ctx: ErrCtx = {}): Promise<void> {
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

  // Sink 3 — Telegram ping to the founder's own chat. Zero setup: reuses the bot
  // token + locked chat id. Throttled per-message so it can't spam.
  //
  // NOT ON THE EDGE RUNTIME, and that guard is load-bearing. lib/telegram reads
  // the silence flag through @supabase/supabase-js, and a static import of it
  // here dragged GoTrueClient + RealtimeClient into the EDGE compilation — which
  // is .open-next/middleware/handler.mjs, 1,048,540 bytes, the one module
  // .open-next/worker.js imports STATICALLY, so workerd parses it on every cold
  // start before a single request is routed. The only edge code this app has is
  // middleware.ts: 40 lines of host/path string matching, no I/O, nothing that
  // can realistically throw. It was carrying a database client to report an
  // error that cannot happen.
  //
  // Next inlines process.env.NEXT_RUNTIME per compilation, so in the edge build
  // this folds to `if (false)` and webpack never even records the import()
  // below as a dependency. Measured with the webpack Next ships: this exact
  // shape emits 1,535 bytes and no second chunk with NEXT_RUNTIME defined as
  // "edge", against 812,199 bytes in two chunks with "nodejs" — the difference
  // being an 807,232-byte @supabase/supabase-js chunk. In the Node build
  // nothing changes: OpenNext inlines the dynamic import into the same script,
  // so the bytes and the behaviour are exactly what they were, which is also
  // why a dynamic import is NOT a bundle fix anywhere else in this repo.
  //
  // What an edge error loses: the Telegram ping. It still gets sink 1 (the
  // structured console.error line, which lands in the Worker logs) and sink 2
  // (the ERROR_WEBHOOK_URL POST). It is not lost, it is just not a chat message.
  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  const tgChat = process.env.TELEGRAM_CHAT_ID;
  // Honour the global Telegram silence even for the error alarm. The founder
  // asked for ALL Telegram to stop; silencing the chase pings but leaving the
  // alarm firing is exactly the half-measure that got me told twice. The other
  // sinks above (console, the ERROR_WEBHOOK_URL POST) still record everything, so
  // errors are NOT lost — they just stop arriving as Telegram messages.
  if (process.env.NEXT_RUNTIME !== "edge" && tgToken && tgChat && shouldAlert(message)) {
    try {
      const { telegramSilenced } = await import("@/lib/telegram");
      // No early `return` — a sink added after this one must still run.
      if (!(await telegramSilenced())) {
        keepAlive(() => fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: tgChat, text: summary.slice(0, 3500), disable_web_page_preview: true }),
          signal: AbortSignal.timeout(2500),
          cache: "no-store",
        }));
      }
    } catch { /* swallow */ }
  }
}
