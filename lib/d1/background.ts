/**
 * Run work after the response WITHOUT importing next/server.
 *
 * Same mechanism as lib/d1/shadow.ts (kept as its own module so the write
 * journal does not need to reach into the shadow comparison): lib/supabase.ts
 * is imported by client components, so a static or dynamic path to `after()`
 * fails the build. `after()` ultimately calls Cloudflare's ctx.waitUntil, which
 * OpenNext publishes on the @next/request-context global, so reach that
 * directly. Outside a request scope (node scripts, vitest) this falls back to
 * fire-and-forget.
 *
 * Why it matters for the journal specifically: Workers cancel every in-flight
 * I/O the moment the response is done (see lib/keepAlive.ts). A journal insert
 * started with a bare `void` would be cancelled and the rollback would silently
 * miss that write — the one failure the journal exists to prevent.
 */
export function scheduleBackground(work: () => Promise<void>): void {
  try {
    const holder = (globalThis as Record<symbol, unknown>)[Symbol.for("@next/request-context")] as
      | { get?: () => { waitUntil?: (p: Promise<unknown>) => void } | undefined }
      | undefined;
    const waitUntil = holder?.get?.()?.waitUntil;
    if (typeof waitUntil === "function") { waitUntil(work().catch(() => {})); return; }
  } catch { /* no request scope */ }
  void work().catch(() => {});
}
