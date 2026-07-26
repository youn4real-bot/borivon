import { after } from "next/server";

/**
 * Run work that must OUTLIVE the response — safely on Cloudflare Workers.
 *
 * THE BUG THIS EXISTS TO KILL. The codebase is full of `void doSomething()` /
 * `promise.catch(() => {})` — start it, don't await it, let it finish while the
 * response goes out. On Vercel that worked by accident: AWS Lambda FREEZES the
 * container after the response and THAWS it on the next invocation, so the
 * pending promise resumed and eventually completed. Cloudflare Workers destroy
 * the request's IoContext the moment the response is done, and every in-flight
 * fetch / R2 / DB call is CANCELLED. No throw, no log, nothing in the response —
 * the work simply never happens.
 *
 * That silently broke real things after the migration: the "document approved"
 * and "document rejected" emails to candidates, the passport-data admin bell,
 * and — worst — lib/reportError.ts's Telegram alert, i.e. the alarm that was
 * supposed to tell the founder about failures was itself disarmed.
 *
 * `after()` registers the callback on Cloudflare's ExecutionContext.waitUntil
 * (verified end-to-end: the cloudflare-node wrapper passes ctx.waitUntil into
 * OpenNext, which publishes it as Next's `@next/request-context` hook, which
 * after-context consumes), so the isolate is kept alive until it settles.
 *
 * Takes a THUNK, not a promise, so the work doesn't start until after() owns it.
 * Never throws: a failure in background work must never surface to the caller,
 * and calling this outside a request scope (a script, a test, module init) just
 * falls back to the old fire-and-forget rather than blowing up.
 */
export function keepAlive(work: () => Promise<unknown>): void {
  try {
    after(async () => {
      try { await work(); } catch { /* background work must never surface */ }
    });
  } catch {
    // No request scope (script / test / cron outside a handler) — there is no
    // waitUntil to register with, so fall back to the previous behaviour.
    try { void work().catch(() => {}); } catch { /* ignore */ }
  }
}
