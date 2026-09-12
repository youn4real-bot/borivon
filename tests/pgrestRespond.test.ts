import { describe, it, expect } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { respond, errorResponse, type RespondMeta } from "../lib/d1/pgrest/respond";
import { statusForPgCode } from "../lib/d1/pgrest/errors";
import type { PostgrestError, QueryIntent } from "../lib/d1/pgrest/types";

/**
 * The responses the adapter hands back are only "right" if the REAL supabase-js
 * parser turns them into what Supabase would have. So this file checks both
 * sides of the seam:
 *
 *   1. the raw HTTP facts (status, headers, body text), and
 *   2. a round trip through the actual @supabase/supabase-js client (the one the
 *      1,261 call sites use) with our Response injected as its fetch — proving
 *      `{ data, error, count, status }` comes out the way the portal expects.
 *
 * Everything here is offline: the client never reaches the network because the
 * injected fetch answers every request.
 */

function intent(over: Partial<QueryIntent> = {}): QueryIntent {
  return {
    action: "select",
    table: "documents",
    select: "*",
    where: [],
    order: [],
    returning: "representation",
    ...over,
  };
}

/** A supabase-js client whose every request is answered by `make()`. */
function clientAnswering(make: () => Response): SupabaseClient {
  return createClient("http://127.0.0.1:9/", "test-key", {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: (async () => make()) as unknown as typeof fetch },
  });
}

async function body(res: Response): Promise<string> {
  return await res.text();
}

const ROW = { id: "d1", status: "approved", uploaded_by_admin: true, meta: { a: 1 } };
const NO_META: RespondMeta = {};

describe("respond — reads", () => {
  it("answers a plain select with a JSON array, 200 and a Content-Range", async () => {
    const res = respond([ROW, { id: "d2" }], NO_META, intent());
    expect(res.status).toBe(200);
    expect(res.statusText).toBe("OK");
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    // No count asked for → the total stays "*", exactly like PostgREST.
    expect(res.headers.get("content-range")).toBe("0-1/*");
    expect(JSON.parse(await body(res))).toEqual([ROW, { id: "d2" }]);
  });

  it("keeps an empty result an empty ARRAY, never null", async () => {
    // 367 maybeSingle call sites depend on this: supabase-js collapses [] → null
    // itself. If we sent `null` here a plain .select() would get null instead of [].
    const res = respond([], NO_META, intent());
    expect(await body(res)).toBe("[]");
    expect(res.headers.get("content-range")).toBe("*/*");
  });

  it("starts the range at the offset, so .range() reports real positions", async () => {
    const res = respond([{ id: "a" }, { id: "b" }, { id: "c" }], NO_META, intent({ offset: 10, limit: 5 }));
    expect(res.headers.get("content-range")).toBe("10-12/*");
  });

  it("head + count:exact → no body, count in the header", async () => {
    const res = respond([], { count: 137 }, intent({ count: "exact", head: true }));
    expect(res.status).toBe(200);
    expect(await body(res)).toBe("");
    expect(res.headers.get("content-range")).toBe("*/137");
  });

  it("head + a count of zero still publishes the number, not '*'", async () => {
    const res = respond([], { count: 0 }, intent({ count: "exact", head: true }));
    // `*/0` must stay `0`: parseInt("0") is 0, while `*` would leave count null
    // and every `count ?? 0` call site would read the same thing by accident.
    expect(res.headers.get("content-range")).toBe("*/0");
  });

  it("head without a count leaves the total unknown", async () => {
    const res = respond([], NO_META, intent({ head: true }));
    expect(res.headers.get("content-range")).toBe("*/*");
  });

  it("head with a count the runner couldn't produce says unknown, not 0", async () => {
    // rows are empty by design on a head request — counting them would claim an
    // empty table when we simply have no number.
    const res = respond([], NO_META, intent({ count: "exact", head: true }));
    expect(res.headers.get("content-range")).toBe("*/*");
  });

  it("a non-head select with count:exact reports the rows it returned", async () => {
    const res = respond([{ id: "a" }, { id: "b" }], NO_META, intent({ count: "exact" }));
    expect(res.headers.get("content-range")).toBe("0-1/2");
  });
});

describe("respond — single / maybeSingle", () => {
  it(".single() with one row returns a BARE object", async () => {
    const res = respond([ROW], NO_META, intent({ singleObject: true, requireExactlyOne: true }));
    expect(res.status).toBe(200);
    expect(JSON.parse(await body(res))).toEqual(ROW);
  });

  it(".single() with no rows is PGRST116 / 406", async () => {
    const res = respond([], NO_META, intent({ singleObject: true, requireExactlyOne: true }));
    expect(res.status).toBe(406);
    expect(res.statusText).toBe("Not Acceptable");
    expect(JSON.parse(await body(res))).toEqual({
      code: "PGRST116",
      details: "The result contains 0 rows",
      hint: null,
      message: "JSON object requested, multiple (or no) rows returned",
    });
  });

  it(".single() with several rows is PGRST116 too, and says how many", async () => {
    const res = respond([{ id: "a" }, { id: "b" }], NO_META, intent({ singleObject: true, requireExactlyOne: true }));
    expect(res.status).toBe(406);
    expect(JSON.parse(await body(res)).details).toBe("The result contains 2 rows");
  });

  it("defaults to the .single() rule when requireExactlyOne is unset", async () => {
    // The object Accept header is PostgREST's contract: 0 rows is an error unless
    // something explicitly says otherwise.
    const res = respond([], NO_META, intent({ singleObject: true }));
    expect(res.status).toBe(406);
  });

  it("an explicit maybeSingle object form answers null, not an error", async () => {
    const res = respond([], NO_META, intent({ singleObject: true, requireExactlyOne: false }));
    expect(res.status).toBe(200);
    expect(await body(res)).toBe("null");
  });

  it("leaves multi-row collapsing to the client for header-less maybeSingle", async () => {
    // .maybeSingle() sends no Accept header at all (v2.104.0 only flips an
    // internal flag), so the adapter can't see it — and must not guess.
    const res = respond([ROW, { id: "d2" }], NO_META, intent());
    expect(JSON.parse(await body(res))).toHaveLength(2);
  });
});

describe("respond — mutations", () => {
  it("insert with .select() → 201 and the inserted rows", async () => {
    const res = respond([ROW], NO_META, intent({ action: "insert", returning: "representation" }));
    expect(res.status).toBe(201);
    expect(res.statusText).toBe("Created");
    expect(JSON.parse(await body(res))).toEqual([ROW]);
    expect(res.headers.get("content-range")).toBeNull(); // no count asked for
  });

  it("insert without .select() → 201, empty body, no content-type", async () => {
    // PostgREST answers POST with 201 Created even for return=minimal (its own
    // docs' "Create a record" example), NOT 204.
    const res = respond([], { changes: 1 }, intent({ action: "insert", returning: "minimal" }));
    expect(res.status).toBe(201);
    expect(await body(res)).toBe("");
    expect(res.headers.get("content-type")).toBeNull();
  });

  it("upsert behaves like insert (POST), with or without rows back", async () => {
    const quiet = respond([], { changes: 2 }, intent({ action: "upsert", returning: "minimal", onConflict: ["user_id"] }));
    expect(quiet.status).toBe(201);
    const loud = respond([ROW], NO_META, intent({ action: "upsert", returning: "representation", onConflict: ["user_id"] }));
    expect(loud.status).toBe(201);
    expect(JSON.parse(await body(loud))).toEqual([ROW]);
  });

  it("an ignoreDuplicates upsert that changed nothing still returns []", async () => {
    const res = respond([], NO_META, intent({ action: "upsert", ignoreDuplicates: true, onConflict: ["user_id"] }));
    expect(res.status).toBe(201);
    expect(await body(res)).toBe("[]");
  });

  it("update/delete without .select() → 204 and nothing else", async () => {
    for (const action of ["update", "delete"] as const) {
      const res = respond([], { changes: 3 }, intent({ action, returning: "minimal" }));
      expect(res.status).toBe(204);
      expect(res.statusText).toBe("No Content");
      expect(await body(res)).toBe("");
    }
  });

  it("update/delete with .select() → 200 and the rows", async () => {
    for (const action of ["update", "delete"] as const) {
      const res = respond([ROW], NO_META, intent({ action, returning: "representation" }));
      expect(res.status).toBe(200);
      expect(JSON.parse(await body(res))).toEqual([ROW]);
    }
  });

  it("a counted update reports D1's rows-affected, even with an empty 204 body", async () => {
    // app/api/portal/admin/affiliates/payout/route.ts does exactly this:
    // `.update(patch, { count: "exact" })` and returns `updated: count ?? 0`.
    const res = respond([], { changes: 7 }, intent({ action: "update", returning: "minimal", count: "exact" }));
    expect(res.status).toBe(204);
    expect(res.headers.get("content-range")).toBe("*/7");
  });

  it("a counted update that matched nothing says 0", async () => {
    const res = respond([], { changes: 0 }, intent({ action: "update", returning: "minimal", count: "exact" }));
    expect(res.headers.get("content-range")).toBe("*/0");
  });

  it("insert + .select().single() returns a bare object at 201", async () => {
    const res = respond([ROW], NO_META, intent({ action: "insert", singleObject: true, requireExactlyOne: true }));
    expect(res.status).toBe(201);
    expect(JSON.parse(await body(res))).toEqual(ROW);
  });

  it("update + .select().single() that matched nothing is PGRST116", async () => {
    const res = respond([], NO_META, intent({ action: "update", singleObject: true, requireExactlyOne: true }));
    expect(res.status).toBe(406);
    expect(JSON.parse(await body(res)).code).toBe("PGRST116");
  });
});

describe("errorResponse", () => {
  const dup: PostgrestError = {
    code: "23505",
    message: 'duplicate key value violates unique constraint "documents_pkey"',
    details: "Key (id)=(d1) already exists.",
    hint: null,
    status: 409,
  };

  it("sends PostgREST's four-key body and drops our internal status field", async () => {
    const res = errorResponse(dup);
    expect(res.status).toBe(409);
    expect(res.statusText).toBe("Conflict");
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    const parsed = JSON.parse(await body(res));
    expect(parsed).toEqual({ code: "23505", details: "Key (id)=(d1) already exists.", hint: null, message: dup.message });
    expect("status" in parsed).toBe(false);
  });

  it("keeps missing details/hint as explicit nulls", async () => {
    const res = errorResponse({ code: "PGRST205", message: "Could not find the table", details: null, hint: null, status: 404 });
    expect(JSON.parse(await body(res))).toEqual({ code: "PGRST205", details: null, hint: null, message: "Could not find the table" });
  });

  it("names every status the adapter can actually emit", async () => {
    // supabase-js hands `statusText` to callers verbatim and undici fills in
    // nothing, so a status missing from the table reads as "". These are the real
    // sources: lib/d1/pgrest/errors.ts maps every code it can produce through
    // statusForPgCode (57014 → 504 is the one that bites), and parseRequest.ts
    // hardcodes 405 for PGRST101 (a verb PostgREST doesn't take).
    const codes = [
      "PGRST100", "PGRST101", "PGRST102", "PGRST116", "PGRST204", "PGRST205",
      "23502", "23503", "23505", "23514", "42703", "42P01", "42501",
      "53300", "57014", "XX000", "08006",
    ];
    for (const status of new Set<number>([405, ...codes.map(statusForPgCode)])) {
      const res = errorResponse({ code: "XX000", message: "x", details: null, hint: null, status });
      expect(res.statusText, `no reason phrase for ${status}`).not.toBe("");
    }
  });

  it("never emits a status that would swallow the body", async () => {
    // 204 (and anything outside 4xx/5xx) would leave supabase-js with no error to
    // report at all — worse than a plain 500.
    for (const status of [204, 0, 200, 700]) {
      const res = errorResponse({ ...dup, status });
      expect(res.status).toBe(500);
      expect(JSON.parse(await body(res)).code).toBe("23505");
    }
  });
});

describe("round trip through the real supabase-js parser", () => {
  it("select → data array, error null", async () => {
    const db = clientAnswering(() => respond([ROW], NO_META, intent()));
    const r = await db.from("documents").select("*");
    expect(r).toMatchObject({ data: [ROW], error: null, status: 200 });
  });

  it("maybeSingle on one row → the bare object (client collapses our array)", async () => {
    const db = clientAnswering(() => respond([ROW], NO_META, intent()));
    const r = await db.from("documents").select("*").eq("id", "d1").maybeSingle();
    expect(r.data).toEqual(ROW);
    expect(r.error).toBeNull();
  });

  it("maybeSingle on no rows → data null, NO error", async () => {
    const db = clientAnswering(() => respond([], NO_META, intent()));
    const r = await db.from("documents").select("*").eq("id", "nope").maybeSingle();
    expect(r.data).toBeNull();
    expect(r.error).toBeNull();
  });

  it("single on no rows → PGRST116 at 406", async () => {
    const db = clientAnswering(() => respond([], NO_META, intent({ singleObject: true, requireExactlyOne: true })));
    const r = await db.from("documents").select("*").eq("id", "nope").single();
    expect(r.data).toBeNull();
    expect(r.error?.code).toBe("PGRST116");
    expect(r.status).toBe(406);
  });

  it("head + count → count parsed from Content-Range, data null", async () => {
    const db = clientAnswering(() => respond([], { count: 42 }, intent({ count: "exact", head: true })));
    const r = await db.from("documents").select("id", { count: "exact", head: true });
    expect(r.count).toBe(42);
    expect(r.data).toBeNull();
    expect(r.error).toBeNull();
  });

  it("a count of zero survives the parse as 0, not null", async () => {
    const db = clientAnswering(() => respond([], { count: 0 }, intent({ count: "exact", head: true })));
    const r = await db.from("documents").select("id", { count: "exact", head: true });
    expect(r.count).toBe(0);
  });

  it("insert without .select() → no data, no error (201 reads as success)", async () => {
    const db = clientAnswering(() => respond([], { changes: 1 }, intent({ action: "insert", returning: "minimal" })));
    const r = await db.from("documents").insert({ id: "d1" });
    expect(r).toMatchObject({ data: null, error: null, status: 201 });
  });

  it("update without .select() → 204, no data, no error", async () => {
    const db = clientAnswering(() => respond([], { changes: 1 }, intent({ action: "update", returning: "minimal" })));
    const r = await db.from("documents").update({ status: "approved" }).eq("id", "d1");
    expect(r).toMatchObject({ data: null, error: null, status: 204 });
  });

  it("a counted update hands the caller the number of rows it touched", async () => {
    const db = clientAnswering(() => respond([], { changes: 7 }, intent({ action: "update", returning: "minimal", count: "exact" })));
    const r = await db.from("affiliate_earnings").update({ status: "paid" }, { count: "exact" }).eq("affiliate_id", "a1");
    expect(r.count).toBe(7);
    expect(r.error).toBeNull();
  });

  it("insert + .select().single() → the created row as an object", async () => {
    const db = clientAnswering(() => respond([ROW], NO_META, intent({ action: "insert", singleObject: true, requireExactlyOne: true })));
    const r = await db.from("documents").insert({ id: "d1" }).select().single();
    expect(r.data).toEqual(ROW);
    expect(r.status).toBe(201);
  });

  it("insert + .select().maybeSingle() → the created row, still at 201", async () => {
    // The commonest write shape in the portal. maybeSingle sends no Accept header,
    // so the adapter answers a one-element ARRAY at 201 and the client collapses
    // it — proof that returning a bare object here would be wrong.
    const db = clientAnswering(() => respond([ROW], NO_META, intent({ action: "insert" })));
    const r = await db.from("documents").insert({ id: "d1" }).select().maybeSingle();
    expect(r.data).toEqual(ROW);
    expect(r.error).toBeNull();
    expect(r.status).toBe(201);
  });

  it("maybeSingle on two rows → the client's own PGRST116, from our plain array", async () => {
    // We can't see .maybeSingle(), so we must hand back both rows and let the
    // client raise. Collapsing to rows[0] would silently hide a duplicate.
    const db = clientAnswering(() => respond([ROW, { id: "d2" }], NO_META, intent()));
    const r = await db.from("documents").select("*").eq("status", "approved").maybeSingle();
    expect(r.data).toBeNull();
    expect(r.error?.code).toBe("PGRST116");
    expect(r.status).toBe(406);
  });

  it("an error body lands in `error` with its Postgres code intact", async () => {
    const db = clientAnswering(() =>
      errorResponse({ code: "23505", message: "duplicate key", details: "Key (id)=(d1) already exists.", hint: null, status: 409 }),
    );
    const r = await db.from("documents").insert({ id: "d1" });
    expect(r.data).toBeNull();
    expect(r.error).toEqual({ code: "23505", message: "duplicate key", details: "Key (id)=(d1) already exists.", hint: null });
    expect(r.status).toBe(409);
  });

  it("a select never leaks null into a call site that expects a list", async () => {
    const db = clientAnswering(() => respond([], NO_META, intent()));
    const r = await db.from("documents").select("*");
    expect(r.data).toEqual([]);
  });
});
