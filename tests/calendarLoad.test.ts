import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fetchCalendar, calendarEmptyKind } from "../lib/calendarLoad";

/**
 * THE CALENDAR TAB MUST NOT SPIN FOREVER, OR CALL A FAILURE A QUIET MONTH.
 *
 * Two failures, one family:
 *   1. `await load()` sat directly above `setLoading(false)` with no try/catch
 *      and no deadline. One dropped request threw straight past that line —
 *      and a stalled mobile connection, which raises nothing at all, never
 *      answered — so she was left on <PageLoader/> with no error, nothing to
 *      tap, and no reason to think a reload would help.
 *   2. `await res.json().catch(() => ({ events: [] }))`, with no look at
 *      res.status. A 500, a 429 or an HTML error page all became an empty
 *      event list, and an empty event list renders the calm sentence
 *      "No events this month" — to a candidate with an interview that week.
 */

type Ev = { id: string; title: string; starts_at: string };
const EVENTS: Ev[] = [{ id: "e1", title: "Interview", starts_at: "2026-09-24T09:00:00Z" }];

const HEALTHY = {
  events: EVENTS, canManage: true, isStaff: false,
  feedToken: "tok", googleSync: { configured: true, connected: false, email: null },
};

function scripted(answer: { status: number; body?: unknown } | "reject" | "badjson" | "stall") {
  return async (_url: string, init?: RequestInit): Promise<Response> => {
    if (answer === "reject") throw new TypeError("Failed to fetch");
    if (answer === "stall") {
      return new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener("abort", () => rej(new Error("The operation was aborted")));
      });
    }
    if (answer === "badjson") {
      return { ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token <"); } } as unknown as Response;
    }
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      json: async () => answer.body ?? {},
    } as Response;
  };
}

describe("fetchCalendar — a failed read is never an empty month", () => {
  it("a healthy read returns the real events and permissions", async () => {
    const res = await fetchCalendar<Ev>(scripted({ status: 200, body: HEALTHY }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.events).toEqual(EVENTS);
    expect(res.data.canManage).toBe(true);
    expect(res.data.feedToken).toBe("tok");
  });

  it("a genuinely empty month is a SUCCESS with no events", async () => {
    const res = await fetchCalendar<Ev>(scripted({ status: 200, body: { ...HEALTHY, events: [] } }));
    expect(res).toMatchObject({ ok: true });
    if (!res.ok) return;
    expect(res.data.events).toEqual([]);
  });

  it("THE BUG: a 500 is a failure, not an empty month", async () => {
    const res = await fetchCalendar<Ev>(scripted({ status: 500, body: { error: "boom" } }));
    expect(res).toEqual({ ok: false, status: 500, perms: null });
  });

  it("THE BUG: an unreadable 200 (an HTML error page) is a failure", async () => {
    expect(await fetchCalendar<Ev>(scripted("badjson"))).toEqual({ ok: false, status: 200, perms: null });
  });

  it("a 401 is reported with its status so the page can send her to log in", async () => {
    const res = await fetchCalendar<Ev>(scripted({ status: 401, body: { error: "no" } }));
    expect(res).toEqual({ ok: false, status: 401, perms: null });
  });

  it("an offline fetch is a failure with no status", async () => {
    expect(await fetchCalendar<Ev>(scripted("reject"))).toEqual({ ok: false, status: null, perms: null });
  });

  it("THE BUG: a stalled request aborts on its deadline instead of hanging the page", async () => {
    expect(await fetchCalendar<Ev>(scripted("stall"), 10)).toEqual({ ok: false, status: null, perms: null });
  });

  it("the route's graceful 200 degrade is a failure, but keeps the admin's '+'", async () => {
    // The route answers 200 with an empty list on a db error ON PURPOSE, so
    // canManage still reaches the admin. eventsOk:false is what stops that
    // kindness reading as "nothing on this month".
    const res = await fetchCalendar<Ev>(scripted({
      status: 200, body: { events: [], eventsOk: false, canManage: true, isStaff: true },
    }));
    expect(res).toEqual({ ok: false, status: 200, perms: { canManage: true, isStaff: true } });
  });

  it("a 200 with no events array at all is a broken read", async () => {
    expect(await fetchCalendar<Ev>(scripted({ status: 200, body: { canManage: false, isStaff: false } })))
      .toEqual({ ok: false, status: 200, perms: { canManage: false, isStaff: false } });
  });
});

describe("calendarEmptyKind — what a month with nothing on it should SAY", () => {
  it("THE BUG: a failed read says 'failed', never the quiet-month sentence", () => {
    expect(calendarEmptyKind({ loaded: true, failed: true, monthCount: 0 })).toBe("failed");
  });
  it("a failure outranks 'still loading' — otherwise the spinner never ends", () => {
    expect(calendarEmptyKind({ loaded: false, failed: true, monthCount: 0 })).toBe("failed");
  });
  it("a read that succeeded on a quiet month is 'empty'", () => {
    expect(calendarEmptyKind({ loaded: true, failed: false, monthCount: 0 })).toBe("empty");
  });
  it("events present → no empty state at all", () => {
    expect(calendarEmptyKind({ loaded: true, failed: true, monthCount: 3 })).toBe("none");
  });
});

/** Comments blanked, offsets preserved — every fix is commented with the
 *  broken line it replaces, so raw text would match the explanation. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\r\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\r\n]*/g, (m, lead: string) => lead + " ".repeat(m.length - lead.length));
}

const PAGE  = code("app/portal/calendar/page.tsx");
const ROUTE = code("app/api/portal/calendar/route.ts");

describe("app/portal/calendar/page.tsx — the spinner always ends", () => {
  it("THE BUG: setLoading(false) is in a finally, not on the line after await load()", () => {
    expect(PAGE).toMatch(/finally\s*\{[\s\S]{0,120}?setLoading\(false\)/);
    // The old shape: `await load();\n if (!cancelled) setLoading(false);`
    expect(PAGE).not.toMatch(/await load\(\);\s*\r?\n\s*if \(!cancelled\) setLoading\(false\);/);
  });

  it("THE BUG: the unreadable answer no longer defaults to an empty event list", () => {
    expect(PAGE).not.toMatch(/json\(\)\.catch\(\(\) => \(\{ events: \[\] \}\)\)/);
    expect(PAGE).toMatch(/fetchCalendar<Ev>\(authedFetch\)/);
  });

  it("a failed read is SAID, with a retry, in all three languages (LAW #19)", () => {
    expect(PAGE).toMatch(/setLoadFailed\(true\)/);
    expect(PAGE).toContain("We couldn’t load your calendar.");
    expect(PAGE).toContain("Ihr Kalender konnte nicht geladen werden.");
    expect(PAGE).toContain("Impossible de charger votre calendrier.");
    expect(PAGE).toMatch(/onClick=\{\(\) => void retryLoad\(\)\}/);
  });

  it("the session lookups carry a deadline — supabase-js takes no AbortSignal", () => {
    expect(PAGE).not.toMatch(/await supabase\.auth\.(getSession|refreshSession)\(\)/);
    expect(PAGE).toMatch(/withTimeout\(supabase\.auth\.getSession\(\)\)/);
  });
});

describe("app/api/portal/calendar/route.ts — the graceful degrade admits itself", () => {
  it("THE BUG: the empty-list fallback is flagged, not passed off as a quiet month", () => {
    expect(ROUTE).toMatch(/events: \[\], eventsOk: false/);
  });
});
