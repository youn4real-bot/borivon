import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  adminNotifDocIdState,
  shouldUseAdminNotifDocId,
  noteAdminNotifDocIdMissing,
  noteAdminNotifDocIdPresent,
  resetAdminNotifDocIdState,
  isMissingColumnError,
  learnFromDocIdAttempt,
} from "../lib/adminNotifDocId";

/**
 * THE BELL STOPPED PAYING FOR THE SAME ANSWER TWICE.
 *
 * admin_notifications.doc_id is what lets a notification OPEN the document
 * rather than dropping the admin on the candidate. It arrives with a migration
 * the founder runs by hand, so both places that touch it were written to be
 * schema-tolerant -- and both re-learnt the answer on EVERY request:
 *
 *   - the list route ran a separate `select doc_id limit 1` PROBE, awaited on
 *     its own, before the four queries that actually serve the bell. Every
 *     poll and every tap that refreshes the feed carried that whole extra
 *     Supabase round trip, and in production it always gave the same answer.
 *   - the upload route always inserted WITH doc_id and retried without it,
 *     i.e. two writes per upload whenever the column is not there.
 *
 * The answer cannot change while an isolate lives, so it is remembered. The
 * path that works is taken FIRST, and a migration run by hand is still picked
 * up by the next isolate with no deploy.
 */

beforeEach(() => resetAdminNotifDocIdState());

describe("remembering whether the column is there", () => {
  it("leans towards trying when nothing is known yet", () => {
    // Being wrong this way costs one retry, once. Being wrong the other way
    // silently drops the deep link the migration was run to enable.
    expect(adminNotifDocIdState()).toBe("unknown");
    expect(shouldUseAdminNotifDocId()).toBe(true);
  });

  it("stops asking once the column is known to be missing", () => {
    noteAdminNotifDocIdMissing();
    expect(adminNotifDocIdState()).toBe("absent");
    expect(shouldUseAdminNotifDocId(), "the fallback IS the fast path now").toBe(false);
  });

  it("and keeps using it once it is known to be there", () => {
    noteAdminNotifDocIdPresent();
    expect(shouldUseAdminNotifDocId()).toBe(true);
  });
});

describe("what counts as 'that column is not there'", () => {
  it("recognises the two codes PostgREST actually sends", () => {
    expect(isMissingColumnError({ code: "42703", message: "" })).toBe(true);
    expect(isMissingColumnError({ code: "PGRST204", message: "" })).toBe(true);
  });

  it("recognises the wording, for a client that gives no code", () => {
    expect(isMissingColumnError({ message: 'column admin_notifications.doc_id does not exist' })).toBe(true);
    expect(isMissingColumnError({ message: "Could not find the 'doc_id' column of 'admin_notifications' in the schema cache" })).toBe(true);
  });

  it("is NOT fooled by anything else that can go wrong", () => {
    // Guessing "absent" here would switch the deep link off for the life of
    // the isolate for a reason that has nothing to do with the schema.
    expect(isMissingColumnError(null)).toBe(false);
    expect(isMissingColumnError({ message: "fetch failed" })).toBe(false);
    expect(isMissingColumnError({ code: "PGRST301", message: "JWT expired" })).toBe(false);
    expect(isMissingColumnError({ code: "42501", message: "permission denied for table admin_notifications" })).toBe(false);
    expect(isMissingColumnError({ message: "column admin_notifications.user_email does not exist" }),
      "a DIFFERENT column's absence is not this one's").toBe(false);
  });
});

describe("learning from one attempt", () => {
  it("a clean result means the column is there", () => {
    expect(learnFromDocIdAttempt(true, null)).toEqual({ retryWithoutDocId: false });
    expect(adminNotifDocIdState()).toBe("present");
  });

  it("a missing-column error means retry once, and never try again", () => {
    expect(learnFromDocIdAttempt(true, { code: "42703", message: "" })).toEqual({ retryWithoutDocId: true });
    expect(adminNotifDocIdState()).toBe("absent");
    expect(shouldUseAdminNotifDocId()).toBe(false);
  });

  it("any other error teaches nothing and triggers no retry", () => {
    learnFromDocIdAttempt(true, { message: "fetch failed" });
    expect(adminNotifDocIdState(), "a network blip must not disable the deep link").toBe("unknown");
  });

  it("an attempt that never used the column cannot teach anything about it", () => {
    noteAdminNotifDocIdMissing();
    expect(learnFromDocIdAttempt(false, { code: "42703", message: "" })).toEqual({ retryWithoutDocId: false });
    expect(adminNotifDocIdState()).toBe("absent");
  });
});

/**
 * And the route itself, driven for real with only the database faked, because
 * the claim being made is about how many round trips a bell tap costs.
 */

/**
 * Every query that was actually SENT, in order -- recorded when it is awaited,
 * not when its builder is created, because a builder that is never awaited
 * costs nothing. A probe would show up here as its own entry.
 */
let selects: string[] = [];
/** Does the fake database have the column? */
let hasDocId = true;

function qb(table: string, cols: string, rows: unknown[]) {
  const missing = table === "admin_notifications" && !hasDocId && cols.includes("doc_id");
  const result = missing
    ? { data: null, error: { code: "42703", message: "column admin_notifications.doc_id does not exist" }, count: null }
    : { data: rows, error: null, count: rows.length };
  const b: Record<string, unknown> = {};
  for (const m of ["eq", "in", "is", "not", "order", "limit", "gte", "lte", "neq", "ilike"]) b[m] = () => b;
  const send = () => { if (table === "admin_notifications") selects.push(cols); return result; };
  b.maybeSingle = async () => { send(); return { data: rows[0] ?? null, error: result.error }; };
  b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(send()).then(res, rej);
  return b;
}

const ROW = {
  id: "n1", type: "upload", user_name: "N", user_email: "nurse@x.test",
  doc_type: "Diplom", doc_name: "d.pdf", read: false, created_at: new Date().toISOString(),
};

const fakeDb = {
  from: (table: string) => ({
    select: (cols: string) => qb(table, cols, table === "admin_notifications" ? [ROW] : []),
  }),
  auth: {
    admin: { listUsers: async () => ({ data: { users: [] }, error: null }) },
  },
};

vi.mock("@/lib/supabase", () => ({
  getServiceSupabase: () => fakeDb,
  getAnonVerifyClient: () => fakeDb,
  supabase: {},
}));

vi.mock("@/lib/admin-auth", () => ({
  requireAdminRole: async () => ({ ok: true, role: "admin", email: "founder@borivon.test" }),
  getVisibleCandidateIds: async () => null,
  getVisibleCandidateScope: async () => ({ ids: null, emails: null }),
}));

async function callBell() {
  const { GET } = await import("@/app/api/portal/admin/notifications/route");
  const { NextRequest } = await import("next/server");
  return GET(new NextRequest("https://www.borivon.com/api/portal/admin/notifications"));
}

describe("what a bell load actually costs", () => {
  beforeEach(() => { selects = []; hasDocId = true; resetAdminNotifDocIdState(); });

  it("no separate probe query, ever", async () => {
    // THE BUG: `select doc_id limit 1` used to run on its own, awaited, before
    // anything the bell needs — an extra Supabase round trip on every poll.
    const res = await callBell();
    expect(res.status).toBe(200);
    expect(selects.some(c => c.trim() === "doc_id"), "the probe is gone").toBe(false);
  });

  it("with the column present: one list query, asking for doc_id", async () => {
    const res = await callBell();
    expect(res.status).toBe(200);
    const lists = selects.filter(c => c.includes("user_email"));
    expect(lists.length).toBe(1);
    expect(lists[0]).toContain("doc_id");
  });

  it("without the column: one failed attempt, then the answer -- and never again", async () => {
    hasDocId = false;

    const first = await callBell();
    expect(first.status, "an un-run migration must never cost the notifications").toBe(200);
    expect((await first.json()).notifications).toHaveLength(1);
    const firstLists = selects.filter(c => c.includes("user_email"));
    expect(firstLists.length, "one attempt with the column, one retry without").toBe(2);
    expect(firstLists[0]).toContain("doc_id");
    expect(firstLists[1]).not.toContain("doc_id");

    selects = [];
    const second = await callBell();
    expect(second.status).toBe(200);
    const secondLists = selects.filter(c => c.includes("user_email"));
    expect(secondLists.length, "the fallback is now the FIRST thing tried").toBe(1);
    expect(secondLists[0], "and it no longer asks for a column that is not there")
      .not.toContain("doc_id");
  });

  it("a network failure does not permanently disable the deep link", async () => {
    // The retry is gated on the column itself being refused, so an unrelated
    // outage cannot turn the bell's deep link off until the isolate dies.
    learnFromDocIdAttempt(true, { message: "fetch failed" });
    const res = await callBell();
    expect(res.status).toBe(200);
    expect(selects.filter(c => c.includes("user_email"))[0]).toContain("doc_id");
  });
});

describe("the upload route's notification insert learns the same lesson", () => {
  // Driving the whole upload route would mean R2, Drive naming, OCR budget and
  // a multipart body; the behaviour that matters here is which insert is
  // ATTEMPTED, and it is one short block. Read it -- the same way
  // tests/mergePhotoDocs.test.ts pins the route wiring it cannot execute.
  const UPLOAD_ROUTE = readFileSync("app/api/portal/upload/route.ts", "utf8");
  const block = UPLOAD_ROUTE.slice(
    UPLOAD_ROUTE.indexOf("const notifBase = {"),
    UPLOAD_ROUTE.indexOf("const notifBase = {") + 1400,
  );

  it("does not attempt a column it already knows is missing", () => {
    // Two writes per upload, every upload, for an answer that cannot change
    // while the isolate lives.
    expect(block).toContain("shouldUseAdminNotifDocId()");
    expect(block).toMatch(/insert\(withDocId \? \{ \.\.\.notifBase, doc_id: insertedId \} : notifBase\)/);
  });

  it("still retries, and still only for the column itself", () => {
    expect(block).toContain("learnFromDocIdAttempt(withDocId, notifErr).retryWithoutDocId");
    expect(block, "the private regex is gone -- one place decides what 'missing column' means")
      .not.toMatch(/\/doc_id\|column \.\* does not exist\|schema cache\/i/);
  });

  it("an un-run migration still never costs the founder the notification", () => {
    expect(block).toMatch(/const \{ error: retryErr \} = await db\.from\("admin_notifications"\)\.insert\(notifBase\)/);
  });
});
