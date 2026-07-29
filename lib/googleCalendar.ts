/**
 * "Connect Google Calendar" — REMOVED. This module is now an inert stub that
 * only exists so its callers keep compiling.
 *
 * It used to be a one-way instant push (Borivon → each user's own Google) built
 * on per-user OAuth: a web-app client id/secret plus a refresh token per user in
 * a `google_calendar_tokens` table, driven through the `googleapis` SDK.
 *
 * It never ran in production. The worker has no GOOGLE_OAUTH_CLIENT_ID /
 * GOOGLE_OAUTH_CLIENT_SECRET binding, `supabase/google_calendar_tokens.sql` was
 * never applied so the table does not exist, and the "Connect Google Calendar"
 * button on /portal/calendar is gated behind the same switch and therefore never
 * rendered. Meanwhile the `googleapis` import it carried was pulled into the
 * single OpenNext worker bundle whether or not it was ever evaluated, and that
 * bundle is what costs every other route a 2-5s cold start. Dead weight that
 * expensive is deleted, not deferred.
 *
 * The Workspace calendar the portal actually reads and writes is a different
 * thing entirely — service-account + domain-wide delegation via the fetch shim
 * in lib/googleRestShim.ts, wired up in lib/workspaceCalendar.ts. Nothing here
 * touched it, and nothing here was removed from it.
 *
 * If the per-user push is ever wanted back, do not reach for `googleapis`: it is
 * a plain client-secret OAuth flow (form-encoded POSTs to
 * https://oauth2.googleapis.com/token, then the same /calendars/primary/events
 * endpoints lib/googleRestShim.ts already talks to), roughly eighty lines of
 * fetch. It also needs the two secrets set and the migration run first.
 */

/** Always false: the transport this feature needed no longer exists in the tree. */
export function googleOAuthConfigured(): boolean {
  return false;
}

/**
 * Unreachable — the only caller, app/api/portal/calendar/google/connect/route.ts,
 * answers 503 on `!googleOAuthConfigured()` before it gets here. Throwing keeps
 * that honest rather than handing the browser a consent URL that cannot work.
 */
export async function buildAuthUrl(_state: string): Promise<string> {
  throw new Error("google_calendar_oauth_removed");
}

/**
 * Reachable but inert, exactly as before. A logged-in user can hit the OAuth
 * callback with their own signed feed token as `state`; the code exchange used
 * to throw there too (no client id, no secret), and the route's try/catch turns
 * either throw into the same redirect to ?google=error.
 */
export async function completeConnect(_userId: string, _code: string, _seesAll: boolean): Promise<string | null> {
  throw new Error("google_calendar_oauth_removed");
}

/** Nothing is stored any more, so there is nothing to forget. */
export async function disconnect(_userId: string): Promise<void> {
  /* no-op */
}

export async function googleStatus(_userId: string): Promise<{ configured: boolean; connected: boolean; email: string | null }> {
  return { configured: false, connected: false, email: null };
}

// ── Push ──────────────────────────────────────────────────────────────────────

/** Kept because app/api/portal/calendar/route.ts still types its rows with it. */
export type PushEvent = {
  id: string; title: string; description?: string | null;
  starts_at: string; ends_at?: string | null;
  location?: string | null; link_url?: string | null;
  attendee_ids?: string[] | null;
};

/**
 * No-ops. Both already returned immediately on `!googleOAuthConfigured()`, so
 * community event create / edit / delete behave identically to production.
 */
export async function fanOutUpsert(_events: PushEvent[]): Promise<void> {
  /* no-op */
}

export async function fanOutDelete(_borivonId: string): Promise<void> {
  /* no-op */
}
