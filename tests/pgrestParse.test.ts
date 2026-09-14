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
 * text (phone), numeric (commission_eur) or uuid (user_id) is what makes the
 * decoding decisions meaningful. Every operand is typed by its column's Postgres
 * input function now, so ids here are real-shaped uuids — `u1` on a uuid column
 * is a 22P02 on Supabase, and so it is here.
 *
 * Wherever a test pins an error body or a grammar decision, the comment names
 * what the live Supabase project answered for that exact request.
 */
const registry = JSON.parse(fs.readFileSync("d1/types.json", "utf8")) as Registry;

const BASE = "http://d1.local/rest/v1";

const U1 = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const U2 = "5a1f9c3e-2b7d-4e8a-b6c4-9d0e1f2a3b4c";
const DOC = "c56a4180-65aa-42ec-a945-5fd21dec0538";
const LINK = "e4eaaaf2-d142-41e1-b3e4-080027620cdd";

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

/**
 * One `key=value` parameter, percent-encoded. Needed whenever a value holds `%`:
 * `%be` in a raw query string is the byte 0xBE, not a wildcard and two letters.
 */
const enc = (key: string, value: string) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;

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
      { column: "cv_draft", alias: "cv_langs", jsonPath: [{ arrow: "->", key: "langs" }] },
    ]);
  });

  it("reads an arrow path step by step: `->` apart from `->>`, keys apart from indexes", () => {
    const sel = (s: string, table = "candidate_profiles") => intent(get(`select=${encodeURIComponent(s)}`, {}, table)).select;
    expect(sel("cv_draft->>langs")).toEqual([{ column: "cv_draft", jsonPath: [{ arrow: "->>", key: "langs" }] }]);
    expect(sel("cv_draft->langs->-1->>level")).toEqual([{ column: "cv_draft", jsonPath: [
      { arrow: "->", key: "langs" }, { arrow: "->", index: -1 }, { arrow: "->>", key: "level" },
    ] }]);
    // `"1"` is a key and `01` an index; `1a` and `+0` are keys; a key keeps inner spaces and dashes.
    expect(sel('week->"1",b:week->01,week->1a,week->+0,week->a b-c', "booking_availability")).toEqual([
      { column: "week", jsonPath: [{ arrow: "->", key: "1" }] },
      { column: "week", alias: "b", jsonPath: [{ arrow: "->", index: 1 }] },
      { column: "week", jsonPath: [{ arrow: "->", key: "1a" }] },
      { column: "week", jsonPath: [{ arrow: "->", key: "+0" }] },
      { column: "week", jsonPath: [{ arrow: "->", key: "a b-c" }] },
    ]);
    // `*` beside other items is every column plus the rest; alone it stays "*".
    expect(sel("*,x:cv_draft->langs")).toEqual([{ column: "*" }, { column: "cv_draft", alias: "x", jsonPath: [{ arrow: "->", key: "langs" }] }]);
    expect(sel("*")).toBe("*");
  });

  it("refuses an arrow Postgres has no operator for, or an index past int4, with Supabase's body", () => {
    expect(error(get("select=key,value->>0->x", {}, "app_settings"))).toEqual({
      code: "42883", message: "operator does not exist: text -> unknown", details: null, status: 404,
      hint: "No operator matches the given name and argument types. You might need to add explicit type casts.",
    });
    expect(error(get("select=a:order_keys->>0->>1", {}, "phase_doc_order")).message).toBe("operator does not exist: text ->> integer");
    // the missing operator is found before the overflowing index after it
    expect(error(get("select=a:order_keys->>0->2147483648", {}, "phase_doc_order")).message).toBe("operator does not exist: text -> integer");
    expect(error(get("select=a:order_keys->2147483648", {}, "phase_doc_order"))).toMatchObject({
      code: "22003", message: 'value "+2147483648" is out of range for type integer', status: 400,
    });
    expect(error(get("select=a:order_keys->-2147483649", {}, "phase_doc_order")).message).toBe('value "-2147483649" is out of range for type integer');
    expect(intent(get("select=a:order_keys->2147483647", {}, "phase_doc_order")).select)
      .toEqual([{ column: "order_keys", alias: "a", jsonPath: [{ arrow: "->", index: 2147483647 }] }]);
    // a column that doesn't exist is reported before any arrow after it
    expect(error(get("select=nope->2147483648,key->>0->x", {}, "app_settings")).code).toBe("42703");
  });

  it("reports a malformed select the way PostgREST's parser does", () => {
    expect(error(get("select=key,value->,key", {}, "app_settings"))).toMatchObject({
      code: "PGRST100", status: 400,
      message: '"failed to parse select parameter (key,value->,key)" (line 1, column 12)',
      details: 'unexpected "," expecting "-", digit or any non reserved character different from: .,>()',
    });
    expect(error(get("select=a:order_keys->", {}, "phase_doc_order"))).toMatchObject({
      message: '"failed to parse select parameter (a:order_keys->)" (line 1, column 15)',
      details: 'unexpected end of input expecting "-", digit or any non reserved character different from: .,>()',
    });
    expect(error(get("select=id,x:value->-x", {}, "classroom_events"))).toMatchObject({
      message: '"failed to parse select parameter (id,x:value->-x)" (line 1, column 14)',
      details: 'unexpected "x" expecting digit',
    });
    expect(error(get("select=key,value->(x", {}, "app_settings")).details)
      .toBe('unexpected "(" expecting "-", digit or any non reserved character different from: .,>()');
    expect(error(get('select=a:order_keys->"a"b', {}, "phase_doc_order"))).toMatchObject({
      message: '"failed to parse select parameter (a:order_keys->"a"b)" (line 1, column 18)',
      details: `unexpected 'b' expecting "->>", "->", "::", ".", ")", "," or end of input`,
    });
    expect(error(get("select=id,"))).toMatchObject({
      message: '"failed to parse select parameter (id,)" (line 1, column 4)',
      details: 'unexpected end of input expecting "...", field name (* or [a..z0..9_$]), "*" or "count()"',
    });
    // syntax is judged before the table is looked for (live: this is not a PGRST205)
    expect(error(get("select=a->", {}, "nosuchtable")).code).toBe("PGRST100");
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
      .eq("user_id", U1).neq("status", "rejected")
      .gt("rotation", 1).gte("rotation", 2).lt("rotation", 3).lte("rotation", 4)
      .like("file_name", "%pass%").ilike("file_type", "%reisepass%")));
    expect(q.where.map((w) => [cond(w).column, cond(w).op, cond(w).value])).toEqual([
      ["user_id", "eq", U1], ["status", "neq", "rejected"],
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

  it("types every operand with the column's Postgres input function", async () => {
    // uuid_in ignores case and prints lowercase, the only spelling the copy holds.
    // Live: the upper-case and the braced spelling of a document id both find it.
    expect(cond(intent(await sent((db) => db.from("documents").select("id").eq("id", DOC.toUpperCase()))).where[0]).value).toBe(DOC);
    expect(cond(intent(get(`id=eq.{${DOC}}`)).where[0]).value).toBe(DOC);
    // A value the type refuses is the 400 Supabase answers, not 200 + [] (all live bodies).
    expect(error(get("id=eq.not-a-uuid"))).toEqual({
      code: "22P02", status: 400, details: null, hint: null, message: 'invalid input syntax for type uuid: "not-a-uuid"',
    });
    expect(error(get("uploaded_by_admin=eq.maybe")).message).toBe('invalid input syntax for type boolean: "maybe"');
    // `Number("")` is 0: this used to return every rotation-0 document.
    expect(error(get("rotation=eq.")).message).toBe('invalid input syntax for type integer: ""');
    expect(error(get("uploaded_at=gte.not-a-date"))).toMatchObject({
      code: "22007", message: 'invalid input syntax for type timestamp with time zone: "not-a-date"',
    });
    // A space-separated UTC timestamp is the same instant to Postgres; the copy
    // stores it with a `T`, and a space sorts below `T` (eq missed, gte over-matched).
    expect(cond(intent(get(enc("uploaded_at", "eq.2026-09-12 06:28:29.686587+00:00"))).where[0]).value)
      .toBe("2026-09-12T06:28:29.686587+00:00");
  });

  it("takes a top-level value literally — quotes, commas and spaces included", () => {
    // Live: `status=eq."approved"` matches no document and `neq."approved"` all of
    // them — PostgREST compares the ten characters, quotes and all.
    expect(cond(intent(get('status=eq."approved"')).where[0]).value).toBe('"approved"');
    expect(cond(intent(get("file_name=eq.%22a,b(c)%22")).where[0]).value).toBe('"a,b(c)"');
    expect(cond(intent(get("file_name=eq.%20John%20")).where[0]).value).toBe(" John ");
    // …while a list item and a logic-tree value ARE unquoted (live: both match).
    expect(cond(intent(get(enc("file_type", 'in.("a,b",c)'))).where[0]).value).toEqual(["a,b", "c"]);
    expect(group(intent(get(enc("or", '(file_type.eq."a,b",file_type.eq.c)'))).where[0]).children.map((c) => cond(c).value))
      .toEqual(["a,b", "c"]);
  });

  it("reads `null` as four letters for every operator but `is`", async () => {
    // Live: `uploaded_at=eq.null` is a 22007 and `user_id=in.(null)` a 22P02 — the
    // word goes to the column's input function like any other — while on a text
    // column `file_type=neq.null` returns every row (none holds the text "null").
    expect(error(await sent((db) => db.from("documents").select("*").eq("superseded_at", null as never)))).toMatchObject({
      code: "22007", status: 400, message: 'invalid input syntax for type timestamp with time zone: "null"',
    });
    expect(error(get("user_id=in.(null)")).message).toBe('invalid input syntax for type uuid: "null"');
    expect(cond(intent(get("file_type=neq.null")).where[0])).toMatchObject({ op: "neq", value: "null" });
  });

  it("reads is.null / is.true, their not. negations, and PostgREST's is keywords", async () => {
    const q = intent(await sent((db) => db.from("documents").select("*")
      .is("superseded_at", null).not("drive_file_id", "is", null)
      .not("uploaded_by_admin", "is", true)));
    expect(q.where).toEqual([
      { kind: "cmp", column: "superseded_at", op: "is", value: null },
      { kind: "cmp", column: "drive_file_id", op: "is", value: null, negate: true },
      { kind: "cmp", column: "uploaded_by_admin", op: "is", value: true, negate: true },
    ]);
    // The keywords are case-insensitive, `not_null` is one of them, and a double
    // negation cancels (live: all three answer like their plain forms).
    expect(cond(intent(get("superseded_at=is.NULL")).where[0])).toEqual({ kind: "cmp", column: "superseded_at", op: "is", value: null });
    expect(cond(intent(get("superseded_at=is.not_null")).where[0])).toEqual({
      kind: "cmp", column: "superseded_at", op: "is", value: null, negate: true,
    });
    expect(cond(intent(get("superseded_at=not.is.not_null")).where[0]).negate).toBeUndefined();
    // IS UNKNOWN on a boolean is IS NULL; on any other type it is Postgres' 42804 (live).
    expect(cond(intent(get("uploaded_by_admin=is.unknown")).where[0])).toEqual({ kind: "cmp", column: "uploaded_by_admin", op: "is", value: null });
    expect(error(get("file_type=is.true"))).toMatchObject({ code: "42804", message: "argument of IS TRUE must be type boolean, not type text" });
    // `is.not.null` is NOT PostgREST grammar, though it looks like it (live: this exact body).
    expect(error(get("superseded_at=is.not.null"))).toMatchObject({
      code: "PGRST100",
      message: '"failed to parse filter (is.not.null)" (line 1, column 7)',
      details: 'unexpected "." expecting isVal: (null, not_null, true, false, unknown)',
    });
    expect(error(get("uploaded_by_admin=is.nul"))).toMatchObject({
      message: '"failed to parse filter (is.nul)" (line 1, column 7)',
      details: "unexpected end of input expecting isVal: (null, not_null, true, false, unknown)",
    });
    expect(error(get("superseded_at=is.maybe")).code).toBe("PGRST100");
  });

  it("reads in-lists, including quoted commas, de-duped values and the empty list", async () => {
    const q = intent(await sent((db) => db.from("documents").select("*").in("user_id", [U1, U2, U1])));
    expect(cond(q.where[0]).value).toEqual([U1, U2]); // the client de-dupes

    // postgrest-js double-quotes any value containing , ( ) — the split must respect that
    const quoted = intent(await sent((db) => db.from("documents").select("*").in("file_type", ["Diplôme (copie)", "x,y"])));
    expect(cond(quoted.where[0]).value).toEqual(["Diplôme (copie)", "x,y"]);

    // `.in("id", [])` → `in.()`: an empty match, never a parse error, and not typed
    expect(cond(intent(await sent((db) => db.from("documents").select("*").in("user_id", []))).where[0]).value).toEqual([]);

    const notIn = intent(get(`user_id=not.in.(${U1},${U2})`));
    expect(cond(notIn.where[0])).toEqual({ kind: "cmp", column: "user_id", op: "in", value: [U1, U2], negate: true });

    // Items go through uuid_in one by one: upper case is the same uuid (live: 1 row),
    // and one bad item fails the whole filter (live: the 22P02 names it).
    expect(cond(intent(get(`id=in.(${DOC.toUpperCase()})`)).where[0]).value).toEqual([DOC]);
    expect(error(get(`id=in.(${DOC},not-a-uuid)`)).message).toBe('invalid input syntax for type uuid: "not-a-uuid"');

    // list items are decoded per column type too
    expect(cond(intent(await sent((db) => db.from("documents").select("*").in("rotation", [0, 90]))).where[0]).value)
      .toEqual([0, 90]);

    // An item runs to the next `,` or `)`, and what follows the list is ignored
    // (live: `first_name=in.(<name>,a)b)` finds that candidate).
    expect(cond(intent(get("file_type=in.(a,b)c)")).where[0]).value).toEqual(["a", "b"]);
  });

  it("leaves a bigint beyond 2^53 as text so it can't round", () => {
    // assistant_chat_turns.id is bigint; SQLite applies the column's numeric
    // affinity to a bound string, so the comparison still works — losing digits
    // to a float would not.
    const big = intent(get("id=eq.9007199254740993", {}, "assistant_chat_turns"));
    expect(cond(big.where[0]).value).toBe("9007199254740993");
    expect(cond(intent(get("id=eq.42", {}, "assistant_chat_turns")).where[0]).value).toBe(42);
  });

  it("reads array literals for text[] containment, and refuses jsonb containment by name", () => {
    expect(cond(intent(get("uploaded_keys=cs.{a,b}", {}, "upload_links")).where[0]).value).toEqual(["a", "b"]);
    // `.contains(col, [])` sends `cs.{}` — the empty array, contained in every
    // array (live: every upload_links row). It used to be JSON.parse'd into an
    // object and matched no row at all.
    expect(cond(intent(get("uploaded_keys=cs.{}", {}, "upload_links")).where[0]).value).toEqual([]);
    // jsonb `@>` is recursive key/value containment; nothing here filters jsonb
    // that way, so it is refused loudly instead of answered with array SQL, which
    // found nothing where Supabase found rows.
    const jsonb = error(get(enc("cv_draft", 'cs.{"langs":1}'), {}, "candidate_profiles"));
    expect(jsonb.code).toBe("PGRST100");
    expect(jsonb.details).toMatch(/jsonb containment/);
    // A malformed literal is worded the way array_in words it (live body).
    expect(error(get("doc_keys=cs.{a}x", {}, "upload_links"))).toMatchObject({
      code: "22P02", message: 'malformed array literal: "{a}x"', details: "Junk after closing right brace.",
    });
  });

  it("reads the one array-containment filter in the codebase", async () => {
    // app/api/portal/u/[token]/route.ts:169 — the single-use upload link claim.
    const q = intent(await sent((db) => db.from("upload_links").update({ uploaded_keys: ["passport"] })
      .eq("id", LINK).is("used_at", null).not("uploaded_keys", "cs", "{passport}").select("id")));
    expect(q.action).toBe("update");
    expect(cond(q.where[0]).value).toBe(LINK);
    expect(cond(q.where[2])).toEqual({ kind: "cmp", column: "uploaded_keys", op: "cs", value: ["passport"], negate: true });
  });

  it("accepts `*` as a like wildcard, the way PostgREST does", () => {
    expect(cond(intent(get("file_name=ilike.*pass*")).where[0]).value).toBe("%pass%");
    // A quoted top-level pattern keeps its quotes, but `*` still becomes `%`:
    // PostgREST maps it over the whole operand (live: `ilike."*PASS*"` matches nothing).
    expect(cond(intent(get('file_name=ilike."*pass*"')).where[0]).value).toBe('"%pass%"');
  });

  it("reads (any)/(all) quantifiers", () => {
    expect(cond(intent(get(enc("file_type", "like(all).{%Noten%,%bersicht%}"))).where[0])).toEqual({
      kind: "cmp", column: "file_type", op: "like", quant: "all", value: ["%Noten%", "%bersicht%"],
    });
    // `eq(any)` is exactly `in`, NULL elements and the empty list included.
    expect(cond(intent(get(enc("file_type", "eq(any).{a,b}"))).where[0])).toEqual({ kind: "cmp", column: "file_type", op: "in", value: ["a", "b"] });
    // Elements are typed (live: 22P02), and `*` becomes `%` before the operand is
    // read as an array (live: the error names "%Noten%").
    expect(error(get(enc("id", "eq(any).{not-a-uuid}"))).message).toBe('invalid input syntax for type uuid: "not-a-uuid"');
    expect(error(get(enc("file_type", "like(any).*Noten*")))).toMatchObject({
      code: "22P02", message: 'malformed array literal: "%Noten%"', details: 'Array value must start with "{" or dimension information.',
    });
  });

  it("rejects unknown columns and operators rather than dropping them", () => {
    expect(error(get("nope=eq.1")).code).toBe("42703");
    expect(error(get("file_name=fts.hello")).details).toMatch(/operator 'fts'/);
    expect(error(get("file_name=eq")).code).toBe("PGRST100");
    expect(error(get("instruments.order=id.asc")).details).toMatch(/referenced-table/);
  });

  it("reports a bad operator at the position PostgREST reports it", () => {
    // Parsec reports a failed operator name where it STARTED, so only a complete
    // name moves the error forward. Every body below is the live one.
    expect(error(get("file_type=foo.x"))).toMatchObject({
      code: "PGRST100", message: '"failed to parse filter (foo.x)" (line 1, column 1)',
      details: 'unexpected "f" expecting "not" or operator (eq, gt, ...)',
    });
    expect(error(get("file_type=not.foo.x"))).toMatchObject({
      message: '"failed to parse filter (not.foo.x)" (line 1, column 5)', details: 'unexpected "f" expecting operator (eq, gt, ...)',
    });
    expect(error(get("file_type=eqx.x"))).toMatchObject({
      message: '"failed to parse filter (eqx.x)" (line 1, column 3)', details: 'unexpected "x" expecting operator (eq, gt, ...)',
    });
    expect(error(get("file_type=eq"))).toMatchObject({
      message: '"failed to parse filter (eq)" (line 1, column 3)', details: "unexpected end of input expecting operator (eq, gt, ...)",
    });
    expect(error(get(enc("file_type", "neq(any).{a}")))).toMatchObject({
      message: '"failed to parse filter (neq(any).{a})" (line 1, column 4)', details: 'unexpected "(" expecting operator (eq, gt, ...)',
    });
  });

  it("answers operators no column here supports with Postgres' own error", () => {
    // Checked live against all eleven column types.
    expect(error(get(enc("id", "sl.a")))).toEqual({
      code: "42883", status: 404, details: null, message: "operator does not exist: uuid << unknown",
      hint: "No operator matches the given name and argument types. You might need to add explicit type casts.",
    });
    expect(error(get(enc("uploaded_at", "adj.a"))).message).toBe("operator does not exist: timestamp with time zone -|- unknown");
    expect(error(get(enc("rotation", "nxr.a"))).message).toBe("operator does not exist: integer &< unknown");
    expect(error(get(enc("doc_keys", "sr.{a}"), {}, "upload_links")).message).toBe("operator does not exist: text[] >> unknown");
    expect(error(get(enc("id", "fts.a")))).toEqual({
      code: "42883", status: 404, details: null, message: "function to_tsvector(uuid) does not exist",
      hint: "No function matches the given name and argument types. You might need to add explicit type casts.",
    });
    expect(error(get(enc("id", "fts(simple).a"))).message).toBe("function to_tsvector(unknown, uuid) does not exist");
    // Refused by name: `<<` on an integer is a bit shift whose failure is worded by
    // its place in the tree, and text/jsonb really can be searched on Supabase.
    expect(error(get(enc("rotation", "sl.1"))).details).toMatch(/^d1-adapter: operator 'sl' on integer/);
    expect(error(get(enc("file_type", "match.^Noten"))).details).toMatch(/^d1-adapter: operator 'match'/);
    expect(error(get(enc("cv_draft", "fts.a"), {}, "candidate_profiles")).details).toMatch(/^d1-adapter: operator 'fts'/);
  });

  it("refuses a json-path filter by name, never as the 42703 that means 'migration not run'", () => {
    const top = error(get(enc("vaccines->>masern", "eq.done"), {}, "candidate_status"));
    const inTree = error(get(enc("or", "(cv_draft->>driverLicense.eq.unset,user_id.is.null)"), {}, "candidate_profiles"));
    for (const e of [top, inTree]) {
      expect(e.code).toBe("PGRST100");
      expect(e.details).toMatch(/json path filter/);
    }
    // The key is read as a field name and what follows it is ignored
    // (live: a 42703 for the column `file_type-`).
    expect(error(get(enc("file_type- >x", "eq.a"))).message).toBe("column documents.file_type- does not exist");
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
    const q = intent(await sent((db) => db.from("phase_slots").select("*").or(`org_id.is.null,org_id.in.(${U1},${U2})`)));
    const g = group(q.where[0]);
    expect(g.children).toHaveLength(2);
    expect(cond(g.children[1])).toEqual({ kind: "cmp", column: "org_id", op: "in", value: [U1, U2] });
  });

  it("handles deep nesting, not.<op> leaves and negated groups", () => {
    const q = intent(get("or=(status.eq.approved,and(status.eq.pending,or(rotation.gt.0,rotation.not.is.null)))"));
    const g = group(q.where[0]);
    const inner = group(group(g.children[1]).children[1]);
    expect(inner.kind).toBe("or");
    expect(cond(inner.children[1])).toMatchObject({ column: "rotation", op: "is", value: null, negate: true });
    // two .or() calls append two params — they AND together, like PostgREST
    const two = intent(get("or=(status.eq.a,status.eq.b)&or=(rotation.eq.0,rotation.eq.90)"));
    expect(two.where.map((w) => group(w).kind)).toEqual(["or", "or"]);
    // Negated groups are PostgREST grammar and work live, both as `not.and(…)`
    // inside a tree and as a `not.or=` parameter.
    expect(group(intent(get("or=(not.and(status.eq.a,status.eq.b))")).where[0]).children[0]).toEqual({
      kind: "and", negate: true,
      children: [
        { kind: "cmp", column: "status", op: "eq", value: "a" },
        { kind: "cmp", column: "status", op: "eq", value: "b" },
      ],
    });
    expect(group(intent(get("not.or=(status.eq.a,status.eq.b)")).where[0])).toMatchObject({ kind: "or", negate: true });
    expect(error(get("or=(status.eq.a,)")).code).toBe("PGRST100");
    expect(error(get("or=(nope.eq.a)")).code).toBe("42703");
  });

  it("ends a tree value at the first `,` or `)`, as PostgREST does — parens are not balanced", () => {
    // The admin candidate search (app/api/portal/admin/classroom/candidates/route.ts)
    // sends `%${q}%` without escaping parens. Live, a term like `a)` returns 23
    // candidates: the value stops at `)`, which closes the group, and the rest of
    // the parameter is ignored.
    const q = intent(get(enc("or", "(first_name.ilike.%a)%,last_name.ilike.%a)%)"), {}, "candidate_profiles"));
    expect(group(q.where[0])).toEqual({ kind: "or", children: [{ kind: "cmp", column: "first_name", op: "ilike", value: "%a" }] });
    // Inside and() the early `)` closes and(), and text before the next `,` / `)`
    // is a parse error — live, with this exact body.
    expect(error(get(enc("or", "(and(first_name.ilike.%a)b),last_name.ilike.%a)"), {}, "candidate_profiles"))).toMatchObject({
      code: "PGRST100",
      message: '"failed to parse logic tree ((and(first_name.ilike.%a)b),last_name.ilike.%a))" (line 1, column 28)',
      details: 'unexpected "b" expecting "," or ")"',
    });
    expect(error(get(enc("or", "(first_name.ilike.%a"), {}, "candidate_profiles"))).toMatchObject({
      message: '"failed to parse logic tree ((first_name.ilike.%a)" (line 1, column 23)',
      details: 'unexpected end of input expecting "," or ")"',
    });
    // A value that opens with a quote is unquoted only when that quote closes the
    // item; a backslash escapes any character; braces are kept whole (all live).
    const value = (v: string) =>
      cond(group(intent(get(enc("or", `(first_name.eq.${v},first_name.eq.zz)`), {}, "candidate_profiles")).where[0]).children[0]).value;
    expect(value('"AB"')).toBe("AB");
    expect(value('"AB"x')).toBe('"AB"x');
    expect(value('"A\\B"')).toBe("AB");
    expect(value('"a,b"')).toBe("a,b");
    expect(value("{a,b}")).toBe("{a,b}");
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
  });

  it("reads limit/offset as PostgREST does: ignores what it can't read, 416s a negative window", () => {
    // live: limit=-1 → 416; offset=abc → every row; limit=abc&offset=5 → 416
    // (tests/pgrestRange.test.ts pins the whole grammar)
    expect(error(get("limit=-1"))).toEqual({
      code: "PGRST103", message: "Requested range not satisfiable", details: "Limit should be greater than or equal to zero.", hint: null, status: 416,
    });
    const ignored = intent(get("offset=abc"));
    expect([ignored.offset, ignored.limit]).toEqual([undefined, undefined]);
    expect(error(get("limit=abc&offset=5")).code).toBe("PGRST103");
    const hex = intent(get("limit=0x3&offset=(5)"));
    expect([hex.offset, hex.limit]).toEqual([5, 3]);
    // a range error outranks the table, the columns and the operands, but not a syntax error
    expect(error(get("select=nope&id=eq.bad&limit=-1", {}, "nosuchtable")).code).toBe("PGRST103");
    expect(error(get("or=(&limit=-1")).code).toBe("PGRST100");
    // an offset past 2^53 travels exactly, for the 22003 and the 416 message that quote it
    expect(intent(get("offset=99999999999999999999"))).toMatchObject({ offset: Number.MAX_SAFE_INTEGER, offsetText: "99999999999999999999" });
  });

  it("also honours a Range header on GET (PostgREST does; postgrest-js never sends one)", () => {
    expect([intent(get("", { Range: "0-9" })).offset, intent(get("", { Range: "0-9" })).limit]).toEqual([undefined, 10]);
    // the query-string window is intersected with the header's
    const q = intent(get("limit=3&offset=6", { Range: "0-9" }));
    expect([q.offset, q.limit]).toEqual([6, 3]);
    expect(error(get("", { Range: "5-2" })).details)
      .toBe("The lower boundary must be lower than or equal to the upper boundary in the Range header.");
    // a HEAD ignores it (live: HEAD with Range 5-2 is a 200 over every row)
    const head = intent(parseParts({ method: "HEAD", url: `${BASE}/documents?select=id`, headers: { Range: "5-2" } }, registry));
    expect([head.offset, head.limit]).toEqual([undefined, undefined]);
  });

  it("maps .single() to singleObject, and leaves .maybeSingle() a plain list read", async () => {
    const one = intent(await sent((db) => db.from("documents").select("*").eq("id", DOC).single()));
    expect(one.singleObject).toBe(true);
    expect(one.requireExactlyOne).toBe(true);
    // postgrest-js #361: maybeSingle sends NOTHING extra — it counts rows client-side.
    const maybe = intent(await sent((db) => db.from("documents").select("*").eq("id", DOC).maybeSingle()));
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
      .eq("id", DOC).is("superseded_at", null).select("id")));
    expect(upd).toMatchObject({ action: "update", returning: "representation" });
    expect(upd.values).toEqual([{ status: "approved" }]);
    expect(upd.where).toHaveLength(2);

    const del = intent(await sent((db) => db.from("notifications").delete().eq("user_id", U1)));
    expect(del).toMatchObject({ action: "delete", returning: "minimal" });
    expect(del.values).toBeUndefined();
    expect(cond(del.where[0]).value).toBe(U1);
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
    for (const q of ["user_id=", "user_id=eq", "or=", "or=(", "limit=-1", "select=:", "user_id=in.a,b"]) {
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
