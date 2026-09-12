import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { PostgrestClient } from "@supabase/postgrest-js";
import { parseParts, parseRequest, isPgrestError } from "../lib/d1/pgrest/parseRequest";
import type { Condition, Group, PostgrestError, QueryIntent, Registry } from "../lib/d1/pgrest/types";

/**
 * The parser has to read what supabase-js ACTUALLY sends, so most of these tests
 * drive the real @supabase/postgrest-js serializer (the same code the 1,261 call
 * sites go through), capture the request it would have put on the wire, and feed
 * that to parseRequest. The hand-written URL tests below cover the shapes a
 * client can't produce (Range header, malformed input, hand-built `or=` strings).
 *
 * Registry = the generated d1/types.json, not a fixture: a column that is really
 * text (phone) or really numeric (commission_eur) is what makes the decoding
 * decisions meaningful.
 */
const registry = JSON.parse(fs.readFileSync("d1/types.json", "utf8")) as Registry;

const BASE = "http://d1.local/rest/v1";

/** Runs a postgrest-js chain against a fake transport and parses what it sent. */
async function sent(run: (db: any) => PromiseLike<unknown>): Promise<QueryIntent | PostgrestError> {
  let captured: Request | null = null;
  const fetchImpl = (input: unknown, init: Record<string, unknown>) => {
    captured = new Request(String(input), init as RequestInit);
    return Promise.resolve(
      new Response("[]", { status: 200, headers: { "content-range": "0-0/*", "content-type": "application/json" } }),
    );
  };
  const db = new PostgrestClient(BASE, { fetch: fetchImpl as never }) as unknown as any;
  await run(db);
  if (!captured) throw new Error("client never called fetch");
  return parseRequest(captured, registry);
}

/** Hand-built request (no client) — for grammar the client cannot emit. */
function get(query: string, headers: Record<string, string> = {}, table = "documents") {
  return parseParts({ method: "GET", url: `${BASE}/${table}?${query}`, headers }, registry);
}

function intent(x: QueryIntent | PostgrestError): QueryIntent {
  if (isPgrestError(x)) throw new Error(`expected an intent, got ${x.code}: ${x.message}`);
  return x;
}
function error(x: QueryIntent | PostgrestError): PostgrestError {
  if (!isPgrestError(x)) throw new Error(`expected an error, got an intent for ${x.table}`);
  return x;
}
const cond = (w: unknown) => w as Condition;
const group = (w: unknown) => w as Group;

describe("select lists", () => {
  it("reads '*', plain comma lists and a missing select as '*'", async () => {
    expect(intent(await sent((db) => db.from("documents").select("*"))).select).toBe("*");
    expect(intent(await sent((db) => db.from("documents").select())).select).toBe("*");
    expect(intent(get("")).select).toBe("*");
    // postgrest-js strips the spaces in "id, user_id" before sending.
    expect(intent(await sent((db) => db.from("documents").select("id, user_id, status"))).select).toEqual([
      { column: "id" }, { column: "user_id" }, { column: "status" },
    ]);
  });

  it("reads the one alias+json-path form used in the codebase", async () => {
    const q = intent(await sent((db) =>
      db.from("candidate_profiles").select("user_id, b2_stage, cv_langs:cv_draft->langs")));
    expect(q.select).toEqual([
      { column: "user_id" },
      { column: "b2_stage" },
      { column: "cv_draft", alias: "cv_langs", jsonPath: "langs" },
    ]);
  });

  it("names an un-aliased json path after its last key, like PostgREST", () => {
    expect(intent(get("select=cv_draft->langs", {}, "candidate_profiles")).select).toEqual([
      { column: "cv_draft", alias: "langs", jsonPath: "langs" },
    ]);
    // ->> only changes the returned type; the adapter reads the same key.
    expect(intent(get("select=cv_draft->>langs", {}, "candidate_profiles")).select).toEqual([
      { column: "cv_draft", alias: "langs", jsonPath: "langs" },
    ]);
  });

  it("refuses an unknown column with 42703 (the code schema-tolerant reads look for)", () => {
    const e = error(get("select=id,not_a_column"));
    expect(e.code).toBe("42703");
    expect(e.status).toBe(400);
    expect(e.message).toMatch(/column .* does not exist/i);
  });

  it("refuses grammar we never implemented instead of guessing", () => {
    expect(error(get("select=id,org:organizations(name)")).details).toMatch(/embedded resource/);
    expect(error(get("select=id::text")).details).toMatch(/cast/);
  });
});

describe("filters", () => {
  it("covers every comparison operator the codebase uses", async () => {
    const q = intent(await sent((db) => db.from("documents").select("*")
      .eq("user_id", "u1").neq("status", "rejected")
      .gt("rotation", 1).gte("rotation", 2).lt("rotation", 3).lte("rotation", 4)
      .like("file_name", "%pass%").ilike("file_type", "%reisepass%")));
    expect(q.where.map((w) => [cond(w).column, cond(w).op, cond(w).value])).toEqual([
      ["user_id", "eq", "u1"], ["status", "neq", "rejected"],
      ["rotation", "gt", 1], ["rotation", "gte", 2], ["rotation", "lt", 3], ["rotation", "lte", 4],
      ["file_name", "like", "%pass%"], ["file_type", "ilike", "%reisepass%"],
    ]);
  });

  it("decodes by column type, not by shape", async () => {
    // phone is text: a Moroccan number must NOT become the number 612345678.
    const phone = intent(await sent((db) => db.from("candidate_profiles").select("*").eq("phone", "0612345678")));
    expect(cond(phone.where[0]).value).toBe("0612345678");
    // commission_eur is numeric → a real number for the SQL binding.
    const eur = intent(await sent((db) => db.from("affiliates").select("*").eq("commission_eur", 250)));
    expect(cond(eur.where[0]).value).toBe(250);
    // b2_failed is boolean → true, not the string "true".
    const flag = intent(await sent((db) => db.from("candidate_profiles").select("*").eq("b2_failed", true)));
    expect(cond(flag.where[0]).value).toBe(true);
    // …but "true" on a text column stays text.
    expect(cond(intent(get("status=eq.true")).where[0]).value).toBe("true");
  });

  it("keeps quoted values literal and preserves inner spaces", () => {
    expect(cond(intent(get("file_name=eq.%22a,b(c)%22")).where[0]).value).toBe("a,b(c)");
    expect(cond(intent(get("file_name=eq.%20John%20")).where[0]).value).toBe(" John ");
  });

  it("treats `.eq(col, null)` as PostgREST does — a NULL comparison, not a match", async () => {
    const q = intent(await sent((db) => db.from("documents").select("*").eq("superseded_at", null as never)));
    expect(cond(q.where[0])).toMatchObject({ op: "eq", value: null });
  });

  it("reads is.null / is.true and their not. negations", async () => {
    const q = intent(await sent((db) => db.from("documents").select("*")
      .is("superseded_at", null).not("drive_file_id", "is", null)
      .not("uploaded_by_admin", "is", true)));
    expect(q.where).toEqual([
      { kind: "cmp", column: "superseded_at", op: "is", value: null },
      { kind: "cmp", column: "drive_file_id", op: "is", value: null, negate: true },
      { kind: "cmp", column: "uploaded_by_admin", op: "is", value: true, negate: true },
    ]);
    // hand-written `is.not.null` (legal in an or= string) means the same thing
    expect(cond(intent(get("superseded_at=is.not.null")).where[0])).toEqual({
      kind: "cmp", column: "superseded_at", op: "is", value: null, negate: true,
    });
    // …and double negation cancels, like Postgres.
    expect(cond(intent(get("superseded_at=not.is.not.null")).where[0]).negate).toBeUndefined();
    expect(error(get("superseded_at=is.maybe")).code).toBe("PGRST100");
  });

  it("reads in-lists, including quoted commas, de-duped values and the empty list", async () => {
    const q = intent(await sent((db) => db.from("documents").select("*").in("user_id", ["a", "b", "a"])));
    expect(cond(q.where[0]).value).toEqual(["a", "b"]); // the client de-dupes

    // postgrest-js double-quotes any value containing , ( ) — the split must respect that
    const quoted = intent(await sent((db) => db.from("documents").select("*").in("file_type", ["Diplôme (copie)", "x,y"])));
    expect(cond(quoted.where[0]).value).toEqual(["Diplôme (copie)", "x,y"]);

    // `.in("id", [])` → `in.()`: an empty match, never a parse error
    expect(cond(intent(await sent((db) => db.from("documents").select("*").in("user_id", []))).where[0]).value).toEqual([]);

    const notIn = intent(get("user_id=not.in.(a,b)"));
    expect(cond(notIn.where[0])).toEqual({ kind: "cmp", column: "user_id", op: "in", value: ["a", "b"], negate: true });

    // list items are decoded per column type too
    expect(cond(intent(await sent((db) => db.from("documents").select("*").in("rotation", [0, 90]))).where[0]).value)
      .toEqual([0, 90]);
  });

  it("leaves a bigint beyond 2^53 as text so it can't round", () => {
    // assistant_chat_turns.id is bigint; SQLite applies the column's numeric
    // affinity to a bound string, so the comparison still works — losing digits
    // to a float would not.
    const big = intent(get("id=eq.9007199254740993", {}, "assistant_chat_turns"));
    expect(cond(big.where[0]).value).toBe("9007199254740993");
    expect(cond(intent(get("id=eq.42", {}, "assistant_chat_turns")).where[0]).value).toBe(42);
  });

  it("tells a jsonb containment object from a text[] array literal", () => {
    // `{a,b}` is a Postgres array literal (never valid JSON); `{"k":1}` is jsonb.
    expect(cond(intent(get("uploaded_keys=cs.{a,b}", {}, "upload_links")).where[0]).value).toEqual(["a", "b"]);
    expect(cond(intent(get('cv_draft=cs.{"langs":1}', {}, "candidate_profiles")).where[0]).value).toEqual({ langs: 1 });
  });

  it("reads the one array-containment filter in the codebase", async () => {
    // app/api/portal/u/[token]/route.ts:169 — the single-use upload link claim.
    const q = intent(await sent((db) => db.from("upload_links").update({ uploaded_keys: ["passport"] })
      .eq("id", "l1").is("used_at", null).not("uploaded_keys", "cs", "{passport}").select("id")));
    expect(q.action).toBe("update");
    expect(cond(q.where[2])).toEqual({ kind: "cmp", column: "uploaded_keys", op: "cs", value: ["passport"], negate: true });
  });

  it("accepts `*` as a like wildcard, the way PostgREST does", () => {
    expect(cond(intent(get("file_name=ilike.*pass*")).where[0]).value).toBe("%pass%");
    expect(cond(intent(get('file_name=ilike."*pass*"')).where[0]).value).toBe("*pass*"); // quoted = literal
  });

  it("rejects unknown columns and operators rather than dropping them", () => {
    expect(error(get("nope=eq.1")).code).toBe("42703");
    expect(error(get("file_name=fts.hello")).details).toMatch(/operator 'fts'/);
    expect(error(get("file_name=eq")).code).toBe("PGRST100");
    expect(error(get("instruments.order=id.asc")).details).toMatch(/referenced-table/);
  });
});

describe("or= groups", () => {
  it("parses the flat search form (2 real call sites)", async () => {
    const q = intent(await sent((db) => db.from("candidate_profiles").select("*")
      .or("first_name.ilike.%ali%,last_name.ilike.%ali%")));
    expect(group(q.where[0])).toEqual({
      kind: "or",
      children: [
        { kind: "cmp", column: "first_name", op: "ilike", value: "%ali%" },
        { kind: "cmp", column: "last_name", op: "ilike", value: "%ali%" },
      ],
    });
  });

  it("parses a nested and() — academy/me route", async () => {
    const q = intent(await sent((db) => db.from("phase_slots").select("*")
      .or("org_id.eq.11111111-1111-4111-8111-111111111111,and(org_id.is.null,phase.eq.bearbeitung)")));
    expect(group(q.where[0])).toEqual({
      kind: "or",
      children: [
        { kind: "cmp", column: "org_id", op: "eq", value: "11111111-1111-4111-8111-111111111111" },
        {
          kind: "and",
          children: [
            { kind: "cmp", column: "org_id", op: "is", value: null },
            { kind: "cmp", column: "phase", op: "eq", value: "bearbeitung" },
          ],
        },
      ],
    });
  });

  it("parses an in.() list inside a group without splitting on its commas", async () => {
    // lib/assistantTools.ts:3809 — org scoping for slots
    const q = intent(await sent((db) => db.from("phase_slots").select("*").or("org_id.is.null,org_id.in.(a,b)")));
    const g = group(q.where[0]);
    expect(g.children).toHaveLength(2);
    expect(cond(g.children[1])).toEqual({ kind: "cmp", column: "org_id", op: "in", value: ["a", "b"] });
  });

  it("handles deep nesting, not.<op> leaves, and refuses a negated group", () => {
    const q = intent(get("or=(status.eq.approved,and(status.eq.pending,or(rotation.gt.0,rotation.not.is.null)))"));
    const g = group(q.where[0]);
    const inner = group(group(g.children[1]).children[1]);
    expect(inner.kind).toBe("or");
    expect(cond(inner.children[1])).toMatchObject({ column: "rotation", op: "is", value: null, negate: true });
    // two .or() calls append two params — they AND together, like PostgREST
    const two = intent(get("or=(status.eq.a,status.eq.b)&or=(rotation.eq.0,rotation.eq.90)"));
    expect(two.where.map((w) => group(w).kind)).toEqual(["or", "or"]);
    expect(error(get("or=(not.and(status.eq.a,status.eq.b))")).details).toMatch(/negated group/);
    expect(error(get("or=(status.eq.a,)")).code).toBe("PGRST100");
    expect(error(get("or=(nope.eq.a)")).code).toBe("42703");
  });
});

describe("modifiers", () => {
  it("reads order, including desc and both nulls positions", async () => {
    const q = intent(await sent((db) => db.from("documents").select("*")
      .order("uploaded_at", { ascending: false })
      .order("file_name", { nullsFirst: true })
      .order("id")));
    expect(q.order).toEqual([
      { column: "uploaded_at", ascending: false },
      { column: "file_name", ascending: true, nullsFirst: true },
      { column: "id", ascending: true },
    ]);
    expect(intent(get("order=status.desc.nullslast")).order).toEqual([
      { column: "status", ascending: false, nullsFirst: false },
    ]);
    // No nulls modifier → left undefined so the SQL builder can apply Postgres' default.
    expect(intent(get("order=status.asc")).order[0].nullsFirst).toBeUndefined();
    expect(error(get("order=status.sideways")).code).toBe("PGRST100");
    expect(error(get("order=nope.asc")).code).toBe("42703");
  });

  it("reads limit, and range() as the offset+limit pair the client really sends", async () => {
    const q = intent(await sent((db) => db.from("documents").select("*").order("id").range(100, 199)));
    expect([q.offset, q.limit]).toEqual([100, 100]);
    expect(intent(await sent((db) => db.from("documents").select("*").limit(5))).limit).toBe(5);
    expect(error(get("limit=-1")).code).toBe("PGRST100");
    expect(error(get("offset=abc")).code).toBe("PGRST100");
  });

  it("also honours a Range header (PostgREST does; postgrest-js never sends one)", () => {
    expect([intent(get("", { Range: "0-9" })).offset, intent(get("", { Range: "0-9" })).limit]).toEqual([0, 10]);
    // explicit params win over the header
    const q = intent(get("limit=3&offset=6", { Range: "0-9" }));
    expect([q.offset, q.limit]).toEqual([6, 3]);
  });

  it("maps .single() to singleObject, and leaves .maybeSingle() a plain list read", async () => {
    const one = intent(await sent((db) => db.from("documents").select("*").eq("id", "d1").single()));
    expect(one.singleObject).toBe(true);
    expect(one.requireExactlyOne).toBe(true);
    // postgrest-js #361: maybeSingle sends NOTHING extra — it counts rows client-side.
    const maybe = intent(await sent((db) => db.from("documents").select("*").eq("id", "d1").maybeSingle()));
    expect(maybe.singleObject).toBeUndefined();
    expect(maybe.head).toBeUndefined();
  });

  it("maps count:'exact' + head:true to a HEAD count", async () => {
    const q = intent(await sent((db) => db.from("documents").select("id", { count: "exact", head: true })
      .not("drive_file_id", "is", null)));
    expect(q).toMatchObject({ action: "select", head: true, count: "exact", returning: "representation" });
    const noHead = intent(await sent((db) => db.from("documents").select("id", { count: "exact" })));
    expect(noHead.count).toBe("exact");
    expect(noHead.head).toBeUndefined();
  });
});

describe("mutations", () => {
  it("insert: single object, bulk array, and returning vs minimal", async () => {
    const minimal = intent(await sent((db) => db.from("notifications").insert({ user_id: "u1", doc_id: "d1", doc_name: "n", doc_type: "t", action: "approved" })));
    expect(minimal).toMatchObject({ action: "insert", returning: "minimal" });
    expect(minimal.values).toEqual([{ user_id: "u1", doc_id: "d1", doc_name: "n", doc_type: "t", action: "approved" }]);

    const bulk = intent(await sent((db) => db.from("notifications")
      .insert([{ user_id: "u1", action: "approved" }, { user_id: "u2", action: "rejected" }]).select()));
    expect(bulk.action).toBe("insert");
    expect(bulk.values).toHaveLength(2);
    expect(bulk.returning).toBe("representation");
    expect(bulk.select).toBe("*"); // `.select()` with no args = every column
  });

  it("upsert: resolution header decides the action, on_conflict carries the target", async () => {
    const merge = intent(await sent((db) => db.from("candidate_profiles")
      .upsert({ user_id: "u1", first_name: "Ali" }, { onConflict: "user_id" }).select().single()));
    expect(merge).toMatchObject({ action: "upsert", onConflict: ["user_id"], ignoreDuplicates: false, singleObject: true });

    const ignore = intent(await sent((db) => db.from("organization_members")
      .upsert({ org_id: "o1", sub_admin_email: "a@b.c" }, { onConflict: "org_id,sub_admin_email", ignoreDuplicates: true })));
    expect(ignore).toMatchObject({ action: "upsert", onConflict: ["org_id", "sub_admin_email"], ignoreDuplicates: true });

    // No onConflict → left unset on purpose; the builder falls back to the PK.
    const pk = intent(await sent((db) => db.from("documents").upsert({ id: "d1", user_id: "u1" })));
    expect(pk.action).toBe("upsert");
    expect(pk.onConflict).toBeUndefined();

    const badTarget = parseParts({
      method: "POST", url: `${BASE}/documents?on_conflict=nope`,
      headers: { Prefer: "resolution=merge-duplicates" }, body: { id: "d1" },
    }, registry);
    expect(error(badTarget).code).toBe("42703");
  });

  it("update and delete keep their filters, and only return rows when .select() was chained", async () => {
    const upd = intent(await sent((db) => db.from("documents").update({ status: "approved" })
      .eq("id", "d1").is("superseded_at", null).select("id")));
    expect(upd).toMatchObject({ action: "update", returning: "representation" });
    expect(upd.values).toEqual([{ status: "approved" }]);
    expect(upd.where).toHaveLength(2);

    const del = intent(await sent((db) => db.from("notifications").delete().eq("user_id", "u1")));
    expect(del).toMatchObject({ action: "delete", returning: "minimal" });
    expect(del.values).toBeUndefined();
    expect(cond(del.where[0]).value).toBe("u1");
  });

  it("flags a column the table doesn't have with PGRST204 so writes can degrade gracefully", async () => {
    const e = error(await sent((db) => db.from("documents").insert({ user_id: "u1", column_from_a_future_migration: 1 })));
    expect(e.code).toBe("PGRST204");
    expect(e.status).toBe(400);
    expect(e.message).toMatch(/schema cache/);
  });

  it("rejects an unreadable body without throwing", async () => {
    const bad = await parseRequest(
      new Request(`${BASE}/documents`, { method: "POST", body: "not json", headers: { "Content-Type": "application/json" } }),
      registry,
    );
    expect(error(bad).code).toBe("PGRST102");
    const empty = await parseRequest(new Request(`${BASE}/documents`, { method: "POST" }), registry);
    expect(error(empty).code).toBe("PGRST102");
    // an UPDATE body must be one object, not an array
    expect(error(parseParts({ method: "PATCH", url: `${BASE}/documents`, headers: {}, body: [{ status: "a" }] }, registry)).code).toBe("PGRST102");
  });
});

describe("routing and failure modes", () => {
  it("resolves the table from the path and 404s an unknown one with PGRST205", () => {
    expect(intent(get("select=*", {}, "candidate_profiles")).table).toBe("candidate_profiles");
    const e = error(get("select=*", {}, "table_from_an_unrun_migration"));
    expect(e.code).toBe("PGRST205");
    expect(e.status).toBe(404);
    expect(e.message).toMatch(/schema cache/);
  });

  it("refuses rpc and unknown methods instead of mis-parsing them", () => {
    expect(error(parseParts({ method: "POST", url: `${BASE}/rpc/claim_upload_key`, headers: {}, body: {} }, registry)).details)
      .toMatch(/rpc/);
    expect(error(parseParts({ method: "PUT", url: `${BASE}/documents`, headers: {} }, registry)).status).toBe(405);
  });

  it("never throws — every bad input comes back as a PostgrestError value", () => {
    for (const q of ["user_id=", "user_id=eq", "or=", "or=(", "limit=", "select=:", "user_id=in.a,b"]) {
      const out = get(q);
      expect(isPgrestError(out)).toBe(true);
      expect(typeof error(out).code).toBe("string");
      expect(error(out).status).toBeGreaterThanOrEqual(400);
    }
  });

  it("does not mistake an inherited Object key for a table or a column", () => {
    // The registry and the JSON body are both JSON.parse output, so they inherit
    // Object.prototype: a bare `columns[name]` lookup says YES to `constructor`,
    // `__proto__`, `toString`… Every one of these used to escape the gate — the
    // first two by THROWING (registry["constructor"].columns is undefined), the
    // rest by reaching the SQL builder as a column the table never had.
    expect(error(get("select=id", {}, "constructor")).code).toBe("PGRST205");
    expect(error(get("select=*", {}, "__proto__")).code).toBe("PGRST205");
    expect(error(get("constructor=eq.1")).code).toBe("42703");
    expect(error(get("__proto__=eq.1")).code).toBe("42703");
    expect(error(get("select=toString")).code).toBe("42703");
    expect(error(get("order=valueOf.asc")).code).toBe("42703");
    expect(error(get("or=(hasOwnProperty.eq.1)")).code).toBe("42703");
    // write paths: an inherited key must degrade like any other unknown column.
    // Built with JSON.parse, like the real body — an object LITERAL `{__proto__: 1}`
    // sets the prototype instead of making a key, so it wouldn't test anything.
    const wireBody = JSON.parse('{"__proto__": 1, "constructor": 2}');
    expect(error(parseParts({ method: "POST", url: `${BASE}/documents`, headers: {}, body: wireBody }, registry)).code)
      .toBe("PGRST204");
    expect(error(parseParts({
      method: "POST", url: `${BASE}/documents?on_conflict=constructor`,
      headers: { Prefer: "resolution=merge-duplicates" }, body: { id: "d1" },
    }, registry)).code).toBe("42703");
  });

  it("answers a malformed percent-escape in the path instead of throwing", () => {
    // url.pathname keeps its escapes; decodeURIComponent("%zz") throws a URIError,
    // which in the Worker is a 500 out of a parser that promises never to throw.
    const e = error(parseParts({ method: "GET", url: `${BASE}/%zz?select=*`, headers: {} }, registry));
    expect(e.code).toBe("PGRST205");
    expect(e.status).toBe(404);
  });

  it("accepts a path-only url and case-insensitive headers", () => {
    const q = intent(parseParts(
      { method: "GET", url: "/rest/v1/documents?select=id", headers: { accept: "application/vnd.pgrst.object+json" } },
      registry,
    ));
    expect(q.table).toBe("documents");
    expect(q.singleObject).toBe(true);
  });
});
