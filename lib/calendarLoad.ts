/**
 * Loading the Calendar tab — and the two ways it used to lie.
 *
 * THE BUGS THIS FILE EXISTS TO PREVENT:
 *
 *  1. ONE DROPPED REQUEST, A SPINNER FOREVER. The page did
 *
 *         await load();
 *         if (!cancelled) setLoading(false);
 *
 *     with `load()` containing a bare `await authedFetch(...)` — no deadline,
 *     no try/catch. A rejected fetch threw straight out of the bootstrap and
 *     `setLoading(false)` was never reached; a stalled mobile connection, which
 *     raises nothing at all, simply never answered. Either way she is left on
 *     `<PageLoader/>` with no error, nothing to tap, and no way out but a
 *     reload she has no reason to think would help.
 *
 *  2. AN UNREADABLE ANSWER RENDERS AS "No events this month." The next line was
 *
 *         const j = await res.json().catch(() => ({ events: [] }));
 *
 *     with no look at `res.status`. A 500, a 429, an HTML error page from an
 *     edge proxy — every one of them became an empty event list, and an empty
 *     event list is the calm sentence a genuinely empty month shows. A missed
 *     interview is the cost of that sentence being wrong.
 *
 * So: either the events were really read, or this is a FAILURE the page must
 * say out loud. There is no empty-ish middle.
 */

/** What the caller may still act on after a failure: the admin "+ Add event"
 *  button must not disappear just because the events query hiccuped. `null`
 *  when the body was never readable. */
export type CalendarPerms = { canManage: boolean; isStaff: boolean };

export type CalendarPayload<E> = CalendarPerms & {
  events: E[];
  feedToken: string | null;
  googleSync: { configured: boolean; connected: boolean; email: string | null } | null;
};

/** `null` status = the request never produced a response (offline / abort). */
export type CalendarLoadFailure = { ok: false; status: number | null; perms: CalendarPerms | null };
export type CalendarLoadSuccess<E> = { ok: true; data: CalendarPayload<E> };
export type CalendarLoadResult<E> = CalendarLoadSuccess<E> | CalendarLoadFailure;

/** Same reasoning as the login page: a stalled radio raises nothing, so
 *  without a deadline there is no failure for the page to react to. */
export const CALENDAR_TIMEOUT_MS = 20_000;

function bool(v: unknown): boolean { return v === true; }

function perms(j: Record<string, unknown>): CalendarPerms {
  return { canManage: bool(j.canManage), isStaff: bool(j.isStaff) };
}

export async function fetchCalendar<E>(
  doFetch: (url: string, init?: RequestInit) => Promise<Response>,
  timeoutMs: number = CALENDAR_TIMEOUT_MS,
): Promise<CalendarLoadResult<E>> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let res: Response;
  try {
    res = await doFetch("/api/portal/calendar", { signal: ac.signal });
  } catch {
    return { ok: false, status: null, perms: null };
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) return { ok: false, status: res.status, perms: null };

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    // A 200 whose body will not parse is a broken read, not an empty month.
    return { ok: false, status: res.status, perms: null };
  }
  if (!body || typeof body !== "object") return { ok: false, status: res.status, perms: null };
  const j = body as Record<string, unknown>;

  // The route degrades a failed events query to a 200 on purpose — that is how
  // the admin keeps his "+ Add event" button — but it now says so with
  // `eventsOk: false`. Without that flag the degrade was indistinguishable
  // from a quiet month.
  if (j.eventsOk === false) return { ok: false, status: res.status, perms: perms(j) };

  // A 200 with no `events` array at all is not an empty month either.
  if (!Array.isArray(j.events)) return { ok: false, status: res.status, perms: perms(j) };

  const gs = j.googleSync;
  return {
    ok: true,
    data: {
      events: j.events as E[],
      ...perms(j),
      feedToken: typeof j.feedToken === "string" ? j.feedToken : null,
      googleSync: gs && typeof gs === "object"
        ? gs as { configured: boolean; connected: boolean; email: string | null }
        : null,
    },
  };
}

/**
 * What a month with no events on screen should SAY.
 *
 * - "loading" — the read has not finished; say nothing yet.
 * - "failed"  — the read failed; say so and offer a retry.
 * - "empty"   — the read succeeded and there genuinely is nothing this month.
 * - "none"    — there are events; render them, no empty state at all.
 *
 * Splitting "failed" out of "empty" IS the fix: they were the same sentence.
 */
export type CalendarEmptyKind = "loading" | "failed" | "empty" | "none";

export function calendarEmptyKind(opts: {
  loaded: boolean;
  failed: boolean;
  monthCount: number;
}): CalendarEmptyKind {
  if (opts.monthCount > 0) return "none";
  // A failure outranks "not loaded yet": after a failed attempt the spinner
  // would otherwise spin forever with nothing to wait for.
  if (opts.failed) return "failed";
  if (!opts.loaded) return "loading";
  return "empty";
}
