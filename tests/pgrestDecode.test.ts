import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { decodeRows, decodeValue, encodeValue, isInternalSqlKey, jsonbText, jsonPathValue, selectOutputKey, sqlArrowKeys } from "@/lib/d1/pgrest/decode";
import { buildSql } from "@/lib/d1/pgrest/buildSql";
import type { BuiltQuery, JsonOp, PgType, QueryIntent, Registry, SelectItem } from "@/lib/d1/pgrest/types";

/**
 * The PostgREST→D1 value codec (Supabase → D1 migration, step 3).
 *
 * The bar is behavioural, not cosmetic: a row that came out of Supabase as
 * `{ uploaded_by_admin: true, doc_keys: ["cv"] }` must come out of D1 the same
 * way, or every `=== true` and every `.map()` in the portal changes meaning.
 * So the tests use the REAL d1/types.json registry and the real column shapes
 * from `documents`, `upload_links`, `messages` and `candidate_profiles`.
 */

const REGISTRY = JSON.parse(fs.readFileSync("d1/types.json", "utf8")) as Registry;

/** A QueryIntent with only the fields decodeRows() reads spelled out. */
function intent(over: Partial<QueryIntent> & { table: string; select: SelectItem[] | "*" }): QueryIntent {
  return { action: "select", where: [], order: [], returning: "representation", ...over };
}
/** A select item; `key` makes it the arrow item `alias:column->key`. */
const col = (column: string, alias?: string, key?: string): SelectItem =>
  key ? { column, alias, jsonPath: [{ arrow: "->", key }] } : alias ? { column, alias } : { column };

/* ───────────────────────────── decodeValue ───────────────────────────── */

describe("decodeValue — boolean (stored 0/1)", () => {
  it("turns SQLite 0/1 back into false/true", () => {
    expect(decodeValue(1, "boolean")).toBe(true);
    expect(decodeValue(0, "boolean")).toBe(false);
  });
  it("keeps NULL as null — a nullable flag is not `false`", () => {
    expect(decodeValue(null, "boolean")).toBe(null);
    expect(decodeValue(undefined, "boolean")).toBe(null);
  });
  it("accepts the Postgres string literals a hand-run UPDATE could leave behind", () => {
    for (const v of ["true", "t", "TRUE", "yes", "on", "1"]) expect(decodeValue(v, "boolean")).toBe(true);
    for (const v of ["false", "f", "no", "off", "0"]) expect(decodeValue(v, "boolean")).toBe(false);
  });
  it("passes an unrecognisable value through instead of inventing false", () => {
    expect(decodeValue("maybe", "boolean")).toBe("maybe");
  });
});

describe("decodeValue — numbers", () => {
  it("returns integer / bigint / numeric as JSON numbers", () => {
    expect(decodeValue(0, "integer")).toBe(0);
    expect(decodeValue(90, "integer")).toBe(90);           // documents.rotation
    expect(decodeValue(9007199254740991, "bigint")).toBe(9007199254740991);
    expect(decodeValue(250.5, "numeric")).toBe(250.5);     // affiliate_earnings.amount_eur
  });
  it("coerces a numeric-looking string (SQLite affinity can hand one back)", () => {
    expect(decodeValue("42", "integer")).toBe(42);
    expect(decodeValue("10.25", "numeric")).toBe(10.25);
  });
  it("leaves a non-numeric value alone rather than emitting NaN", () => {
    expect(decodeValue("n/a", "integer")).toBe("n/a");
  });
});

describe("decodeValue — jsonb and arrays (stored as JSON text)", () => {
  it("parses objects and arrays", () => {
    expect(decodeValue('{"langs":[{"name":"Deutsch"}]}', "jsonb")).toEqual({ langs: [{ name: "Deutsch" }] });
    expect(decodeValue('["cv_de","passport"]', "text[]")).toEqual(["cv_de", "passport"]);
    expect(decodeValue("[]", "uuid[]")).toEqual([]);
  });
  it("parses JSON scalars stored in a jsonb column", () => {
    expect(decodeValue('"abc"', "jsonb")).toBe("abc");
    expect(decodeValue("42", "jsonb")).toBe(42);
    expect(decodeValue("true", "jsonb")).toBe(true);
    // JSON null and SQL NULL are indistinguishable over PostgREST too.
    expect(decodeValue("null", "jsonb")).toBe(null);
    expect(decodeValue(null, "jsonb")).toBe(null);
  });
  it("returns invalid JSON as the raw string — one bad row must not 500 the page", () => {
    expect(decodeValue("{a,b}", "text[]")).toBe("{a,b}");   // Postgres array literal, not JSON
    expect(decodeValue("", "jsonb")).toBe("");
    expect(decodeValue("{oops", "jsonb")).toBe("{oops");
  });
  it("passes a non-string through (SQLite may already have a number)", () => {
    expect(decodeValue(7, "jsonb")).toBe(7);
  });
});

describe("decodeValue — text-shaped types are byte-identical", () => {
  it("never re-formats uuid / text / date / timestamptz", () => {
    const uuid = "11111111-1111-4111-8111-111111111111";
    expect(decodeValue(uuid, "uuid")).toBe(uuid);
    expect(decodeValue("Ärztin", "text")).toBe("Ärztin");
    expect(decodeValue("2026-09-11", "date")).toBe("2026-09-11");
    // Both fraction shapes live in the copy: trailing-zero-trimmed from the
    // PostgREST export, 6-digit from D1's own column DEFAULT.
    expect(decodeValue("2026-09-11T17:25:01.155+00:00", "timestamptz")).toBe("2026-09-11T17:25:01.155+00:00");
    expect(decodeValue("2026-09-11T17:25:01.155000+00:00", "timestamptz")).toBe("2026-09-11T17:25:01.155000+00:00");
    expect(decodeValue("2026-09-11T17:25:01+00:00", "timestamptz")).toBe("2026-09-11T17:25:01+00:00");
  });
  it("passes a value through untyped when the registry does not know the column", () => {
    expect(decodeValue(1, undefined)).toBe(1);
    expect(decodeValue("x", undefined)).toBe("x");
    expect(decodeValue(null, undefined)).toBe(null);
  });
});

/* ──────────────────────────── selectOutputKey ──────────────────────────── */

describe("selectOutputKey", () => {
  it("uses the alias, else the last KEY of an arrow path (indexes skipped), else the column", () => {
    expect(selectOutputKey(col("user_id"))).toBe("user_id");
    expect(selectOutputKey(col("cv_draft", "cv_langs", "langs"))).toBe("cv_langs");
    expect(selectOutputKey({ column: "cv_draft", jsonPath: [{ arrow: "->", key: "langs" }] })).toBe("langs");
    expect(selectOutputKey({ column: "cv_draft", jsonPath: [{ arrow: "->", key: "a" }, { arrow: "->>", key: "b" }] })).toBe("b");
    // live: `cv_draft->langs->0` comes back under `langs`, and `cv_draft->0` under `cv_draft`
    expect(selectOutputKey({ column: "cv_draft", jsonPath: [{ arrow: "->", key: "langs" }, { arrow: "->", index: 0 }] })).toBe("langs");
    expect(selectOutputKey({ column: "cv_draft", jsonPath: [{ arrow: "->", index: 0 }] })).toBe("cv_draft");
  });
});

/* ───────────────────────────── decodeRows ───────────────────────────── */

describe("decodeRows — explicit select list", () => {
  const it_ = intent({
    table: "documents",
    select: [col("id"), col("file_type"), col("rotation"), col("uploaded_by_admin"), col("superseded_at")],
  });

  it("types every column and keeps the requested order", () => {
    const out = decodeRows(
      [{ id: "d1", file_type: "passport", rotation: 90, uploaded_by_admin: 1, superseded_at: null }],
      it_, REGISTRY,
    );
    expect(out).toEqual([{ id: "d1", file_type: "passport", rotation: 90, uploaded_by_admin: true, superseded_at: null }]);
    expect(Object.keys(out[0])).toEqual(["id", "file_type", "rotation", "uploaded_by_admin", "superseded_at"]);
  });

  it("follows the select order even when D1 returns the keys in another order", () => {
    const out = decodeRows([{ uploaded_by_admin: 0, rotation: 0, superseded_at: null, file_type: "cv_de", id: "d2" }], it_, REGISTRY);
    expect(Object.keys(out[0])).toEqual(["id", "file_type", "rotation", "uploaded_by_admin", "superseded_at"]);
    expect(out[0].uploaded_by_admin).toBe(false);
  });

  it("drops columns D1 returned that were not asked for (PostgREST returns only the select list)", () => {
    const out = decodeRows([{ id: "d3", file_type: null, rotation: 0, uploaded_by_admin: 0, superseded_at: null, r2_key: "secret/key" }], it_, REGISTRY);
    expect("r2_key" in out[0]).toBe(false);
  });

  it("returns [] for an empty result (head:true count requests included)", () => {
    expect(decodeRows([], intent({ table: "documents", select: "*", head: true, count: "exact" }), REGISTRY)).toEqual([]);
  });
});

describe("decodeRows — aliases", () => {
  it("returns an aliased column under the alias, read from the column buildSql named it after", () => {
    const out = decodeRows([{ uploaded_by_admin: 1 }], intent({ table: "documents", select: [col("uploaded_by_admin", "flag")] }), REGISTRY);
    expect(out).toEqual([{ flag: true }]);
  });
  it("never reads a value under the alias: that name is caller text, and could be one of the adapter's", () => {
    // `select=id,rowid$:slug` once overwrote read.ts's rowid; nothing in a row is named by an alias now.
    const out = decodeRows([{ flag: 1, "rowid$": 7 }], intent({ table: "documents", select: [col("uploaded_by_admin", "flag"), col("file_type", "rowid$")] }), REGISTRY);
    expect(out).toEqual([{ flag: null, "rowid$": null }]);
  });
  it("emits null (not a missing property) when neither key is present", () => {
    const out = decodeRows([{ something_else: 1 }], intent({ table: "documents", select: [col("file_type")] }), REGISTRY);
    expect(out).toEqual([{ file_type: null }]);
    expect("file_type" in out[0]).toBe(true);
  });
  it("keeps an alias named __proto__, which plain assignment would swallow", () => {
    // `select=__proto__:file_type` is a legal PostgREST request and the alias comes
    // off the wire, so a client picks this name. `out["__proto__"] = v` runs the
    // prototype setter instead of creating a property: the key would silently
    // disappear from the JSON body (or re-prototype the row for an object value).
    // The fixtures go through JSON.parse for the same reason — `{ __proto__: x }`
    // in a literal is the prototype, not a column.
    const out = decodeRows([{ file_type: "passport" }], intent({ table: "documents", select: [col("file_type", "__proto__")] }), REGISTRY);
    expect(Object.prototype.hasOwnProperty.call(out[0], "__proto__")).toBe(true);
    expect(JSON.stringify(out[0])).toBe('{"__proto__":"passport"}');   // what PostgREST sends

    // An object value must not end up as the row's prototype either.
    const objValue = decodeRows([{ cv_draft: '{"is_admin":true}' }], intent({ table: "candidate_profiles", select: [col("cv_draft", "__proto__")] }), REGISTRY);
    expect(Object.getPrototypeOf(objValue[0])).toBe(Object.prototype);
    expect(JSON.stringify(objValue[0])).toBe('{"__proto__":{"is_admin":true}}');
  });
});

describe("decodeRows — the one json-path alias, cv_langs:cv_draft->langs", () => {
  // Real call sites: app/api/portal/admin/b2-overview, lib/candidateSearchData,
  // lib/assistantTools — all feed the result straight into germanSummary({langs}).
  const it_ = intent({
    table: "candidate_profiles",
    select: [col("user_id"), col("b2_stage"), col("cv_draft", "cv_langs", "langs")],
  });
  const langs = [{ name: "Deutsch", level: "B2", detail: { written: "yes" } }];

  it("reads the sub-tree the SQL walk hands back, under the alias", () => {
    // buildSql walks the path's keys in SQL and names the value they land on `sel$<position>`.
    const out = decodeRows([{ user_id: "u1", b2_stage: "b2_passed", "sel$2": JSON.stringify(langs) }], it_, REGISTRY);
    expect(out).toEqual([{ user_id: "u1", b2_stage: "b2_passed", cv_langs: langs }]);
  });
  it("reads a mutation's RETURNING the same way: one rule, whatever the statement", () => {
    const out = decodeRows([{ user_id: "u1", b2_stage: "b2_passed", "sel$2": JSON.stringify(langs) }], { ...it_, action: "update" }, REGISTRY);
    expect(out).toEqual([{ user_id: "u1", b2_stage: "b2_passed", cv_langs: langs }]);
  });
  it("gives null for a missing path — the callers branch on `!== undefined`, so null must not be dropped", () => {
    const out = decodeRows([{ user_id: "u1", b2_stage: null, "sel$2": null }], it_, REGISTRY);
    expect(out[0].cv_langs).toBe(null);
    expect("cv_langs" in out[0]).toBe(true);
  });
  it("names an un-aliased path after its last key, and keeps a star's columns beside it", () => {
    const select: SelectItem[] = [{ column: "*" }, { column: "cv_draft", jsonPath: [{ arrow: "->", key: "langs" }, { arrow: "->", index: 0 }] }];
    const draft = JSON.stringify({ langs: [{ name: "Deutsch" }] });
    // SQL walked `langs`; the index is taken here, from what it landed on.
    const out = decodeRows([{ user_id: "u1", cv_draft: draft, "sel$1": JSON.stringify([{ name: "Deutsch" }]) }], intent({ table: "candidate_profiles", select }), REGISTRY)[0];
    expect(out).toEqual({ user_id: "u1", cv_draft: { langs: [{ name: "Deutsch" }] }, langs: { name: "Deutsch" } });
  });
  it("walks in SQL only the leading keys SQLite can spell, on a column that holds JSON", () => {
    const item = (column: string, ...steps: (string | number)[]): SelectItem => ({
      column, jsonPath: steps.map((s) => (typeof s === "number" ? { arrow: "->" as const, index: s } : { arrow: "->>" as const, key: s })),
    });
    const keys = (column: string, table: string, ...steps: (string | number)[]) => sqlArrowKeys(item(column, ...steps), REGISTRY[table].columns[column].pg);
    expect(keys("cv_draft", "candidate_profiles", "langs", "x", 0, "name")).toEqual(["langs", "x"]);
    expect(keys("cv_draft", "candidate_profiles", "", "a.b", "😀")).toEqual(["", "a.b", "😀"]);
    expect(keys("cv_draft", "candidate_profiles", "a", 'b"c', "d")).toEqual(["a"]);
    expect(keys("cv_draft", "candidate_profiles", "a\\b")).toEqual([]);
    expect(keys("cv_draft", "candidate_profiles", "a\x01")).toEqual([]);
    expect(keys("cv_draft", "candidate_profiles", "\ud800")).toEqual([]);                  // a lone surrogate
    expect(keys("doc_keys", "upload_links", "x")).toEqual(["x"]);                           // text[]
    expect(keys("first_name", "candidate_profiles", "x")).toEqual([]);                      // text: nothing to leave behind
  });
  it("never falls back to the source column — that would return the whole CV draft", () => {
    // The alias fallback exists for plain columns. For a json path the source
    // column holds the ENTIRE draft (name, address, signature…), so handing it
    // back under `cv_langs` would both break germanSummary({langs}) and leak far
    // more of the candidate than the query asked for. PostgREST returns null.
    const draft = { langs: [{ name: "Deutsch" }], address: "Rue X 12, Casablanca", saved_signature: "data:image/png;…" };
    const out = decodeRows(
      [{ user_id: "u1", cv_draft: JSON.stringify(draft) }],
      intent({ table: "candidate_profiles", select: [col("user_id"), col("cv_draft", "cv_langs", "langs")] }),
      REGISTRY,
    );
    expect(out).toEqual([{ user_id: "u1", cv_langs: null }]);
  });

  it("does NOT decode the sub-tree as the parent column's type by accident", () => {
    // cv_draft is jsonb; a path that lands on a boolean must stay a boolean,
    // not be run through the boolean 0/1 rules.
    const out = decodeRows([{ "sel$0": "false" }], intent({ table: "candidate_profiles", select: [col("cv_draft", "cv_langs", "langs")] }), REGISTRY);
    expect(out[0].cv_langs).toBe(false);
  });
});

describe("jsonPathValue — `->` and `->>` as Postgres answers them", () => {
  // Every expectation is the live Supabase answer for the same select.
  const k = (key: string, arrow: "->" | "->>" = "->"): JsonOp => ({ arrow, key });
  const n = (index: number, arrow: "->" | "->>" = "->"): JsonOp => ({ arrow, index });
  const draft = JSON.stringify({
    postalCode: "51000", city: "EL HAJEB", zero: 0, off: false,
    langs: [{ name: "Arabisch", level: "Muttersprache" }, { name: "Deutsch", level: "B2" }],
  });

  it("keeps a JSON string a string, even one that looks like a number", () => {
    // cv_draft->postalCode is "51000"; json_extract + JSON.parse made it the number 51000.
    expect(jsonPathValue(draft, "jsonb", [k("postalCode")])).toBe("51000");
    expect(jsonPathValue(draft, "jsonb", [k("postalCode", "->>")])).toBe("51000");
    expect(jsonPathValue(draft, "jsonb", [k("zero")])).toBe(0);
    expect(jsonPathValue(draft, "jsonb", [k("off")])).toBe(false);
  });

  it("answers `->>` with TEXT: jsonb's own rendering of an object or array", () => {
    expect(jsonPathValue(draft, "jsonb", [k("langs", "->>")]))
      .toBe('[{"name": "Arabisch", "level": "Muttersprache"}, {"name": "Deutsch", "level": "B2"}]');
    expect(jsonPathValue(draft, "jsonb", [k("langs"), n(0, "->>")])).toBe('{"name": "Arabisch", "level": "Muttersprache"}');
    expect(jsonPathValue(draft, "jsonb", [k("zero", "->>")])).toBe("0");
    expect(jsonPathValue(draft, "jsonb", [k("off", "->>")])).toBe("false");
    // booking_availability: week->>"1" is the string ["09:00-13:00", "14:00-18:00"]
    expect(jsonPathValue('{"1":["09:00-13:00","14:00-18:00"]}', "jsonb", [k("1", "->>")])).toBe('["09:00-13:00", "14:00-18:00"]');
    expect(jsonPathValue('{"a":null}', "jsonb", [k("a", "->>")])).toBe(null);
  });

  it("indexes arrays from either end, and reads a scalar as a one-element array", () => {
    expect(jsonPathValue(draft, "jsonb", [k("langs"), n(-1), k("level")])).toBe("B2");
    expect(jsonPathValue(draft, "jsonb", [k("langs"), n(-3)])).toBe(null);
    expect(jsonPathValue(draft, "jsonb", [k("langs"), n(2)])).toBe(null);
    // cv_draft->city->0 and ->-1 are the city; ->1 is null
    expect(jsonPathValue(draft, "jsonb", [k("city"), n(0)])).toBe("EL HAJEB");
    expect(jsonPathValue(draft, "jsonb", [k("city"), n(-1)])).toBe("EL HAJEB");
    expect(jsonPathValue(draft, "jsonb", [k("city"), n(1)])).toBe(null);
    // an object has no index, an array has no key
    expect(jsonPathValue(draft, "jsonb", [n(0)])).toBe(null);
    expect(jsonPathValue(draft, "jsonb", [k("langs"), k("name")])).toBe(null);
  });

  it("starts from to_jsonb(col) for a column that is not JSON — null, never a 500", () => {
    // first_name->a is null; app_settings value->0 is "hold"; phase_slots position->0
    // is 8 and ->>0 "8"; documents uploaded_by_admin->>0 is "true", uploaded_at->0 the timestamp.
    expect(jsonPathValue("Yassine", "text", [k("a")])).toBe(null);
    expect(jsonPathValue("hold", "text", [n(0)])).toBe("hold");
    expect(jsonPathValue(8, "integer", [n(0)])).toBe(8);
    expect(jsonPathValue(8, "integer", [n(0, "->>")])).toBe("8");
    expect(jsonPathValue(1, "boolean", [n(0, "->>")])).toBe("true");
    expect(jsonPathValue("2026-08-04T15:11:21.452251+00:00", "timestamptz", [n(0)])).toBe("2026-08-04T15:11:21.452251+00:00");
    expect(jsonPathValue('["zusatzblatt_a","langcert","tls_bestaetigungstermin"]', "text[]", [n(-1)])).toBe("tls_bestaetigungstermin");
    expect(jsonPathValue(null, "jsonb", [k("langs")])).toBe(null);
  });
});

describe("jsonbText", () => {
  it("prints the way jsonb's output function does", () => {
    expect(jsonbText({ bb: 1, a: [1, "x", null, true], ccc: {} })).toBe('{"a": [1, "x", null, true], "bb": 1, "ccc": {}}');
    expect(jsonbText(JSON.parse('{"b":1,"10":2,"a":3}'))).toBe('{"a": 3, "b": 1, "10": 2}');   // shorter keys first, then bytes
    expect(jsonbText(1e-7)).toBe("0.0000001");
    expect(jsonbText(1e21)).toBe("1000000000000000000000");
    expect(jsonbText("a\"b\n")).toBe('"a\\"b\\n"');
  });
});

describe("decodeRows — select '*'", () => {
  it("follows the registry's column order and types every column", () => {
    const row = {
      // deliberately shuffled relative to the table definition
      doc_keys: '["cv_de","passport"]',
      uploaded_keys: "[]",
      id: "l1",
      token_hash: "abc",
      candidate_user_id: "u1",
      created_by: "admin@x.de",
      expires_at: "2026-09-12T10:00:00+00:00",
      used_at: null,
      revoked_at: null,
      created_at: "2026-09-11T17:25:01.155+00:00",
    };
    const out = decodeRows([row], intent({ table: "upload_links", select: "*" }), REGISTRY);
    expect(Object.keys(out[0])).toEqual(Object.keys(REGISTRY.upload_links.columns));
    expect(out[0].doc_keys).toEqual(["cv_de", "passport"]);
    expect(out[0].uploaded_keys).toEqual([]);
    expect(out[0].used_at).toBe(null);
  });

  it("includes generated columns, as PostgREST's select=* does", () => {
    // messages.has_attachment is GENERATED ALWAYS … STORED (0/1 in D1).
    const out = decodeRows([{ has_attachment: 1 }], intent({ table: "messages", select: "*" }), REGISTRY);
    expect(out[0].has_attachment).toBe(true);
  });

  it("keeps a column the registry has not caught up with, untyped, at the end", () => {
    const out = decodeRows(
      [{ id: "d1", brand_new_column: 1 }],
      intent({ table: "documents", select: "*" }), REGISTRY,
    );
    expect(out[0].id).toBe("d1");
    expect(out[0].brand_new_column).toBe(1);           // passed through, not guessed as boolean
    expect(Object.keys(out[0])).toEqual(["id", "brand_new_column"]);
  });

  it("falls back to the row's own shape for a table missing from the registry", () => {
    const out = decodeRows([{ a: 1, b: "x" }], intent({ table: "not_in_types_json", select: "*" }), REGISTRY);
    expect(out).toEqual([{ a: 1, b: "x" }]);
  });

  it("does not lose a column whose name collides with Object.prototype", () => {
    // `"constructor" in {}` is true — an `in` check here would drop the column.
    const out = decodeRows([{ constructor: "x", toString: 1 }], intent({ table: "not_in_types_json", select: "*" }), REGISTRY);
    expect(Object.keys(out[0])).toEqual(["constructor", "toString"]);
    expect(out[0].constructor).toBe("x");
  });

  it("is what a mutation with no .select() columns uses (returning=*)", () => {
    const out = decodeRows(
      [{ id: "d1", uploaded_by_admin: 1 }],
      intent({ action: "insert", table: "documents", select: "*", returning: "representation" }), REGISTRY,
    );
    expect(out[0].uploaded_by_admin).toBe(true);
  });

  it("treats an empty select list as '*' too — `?select=` means every column", () => {
    // Belt-and-braces: a bare `.select()` after a mutation must never degrade to
    // rows of `{}`, which would break every caller reading back an inserted id.
    const out = decodeRows([{ id: "d1", uploaded_by_admin: 0 }], intent({ table: "documents", select: [] }), REGISTRY);
    expect(out).toEqual([{ id: "d1", uploaded_by_admin: false }]);
  });
});

/* ───────────────────────────── encodeValue ───────────────────────────── */

describe("encodeValue", () => {
  it("binds booleans as 0/1 — SQLite has no boolean type", () => {
    expect(encodeValue(true, "boolean")).toBe(1);
    expect(encodeValue(false, "boolean")).toBe(0);
    expect(encodeValue("true", "boolean")).toBe(1);
    expect(encodeValue("f", "boolean")).toBe(0);
    expect(encodeValue(null, "boolean")).toBe(null);
  });
  it("serialises jsonb / text[] / uuid[] exactly like d1/export-data.mjs did", () => {
    expect(encodeValue({ langs: [] }, "jsonb")).toBe('{"langs":[]}');
    expect(encodeValue(["cv_de"], "text[]")).toBe('["cv_de"]');
    expect(encodeValue([], "uuid[]")).toBe("[]");
    // A JS string on a jsonb column is a JSON string, quotes and all.
    expect(encodeValue("abc", "jsonb")).toBe('"abc"');
  });
  it("binds numbers, and drops non-finite ones like the importer did", () => {
    expect(encodeValue(90, "integer")).toBe(90);
    expect(encodeValue("90", "integer")).toBe(90);
    expect(encodeValue(250.5, "numeric")).toBe(250.5);
    expect(encodeValue(Number.NaN, "numeric")).toBe(null);
    expect(encodeValue(Infinity, "bigint")).toBe(null);
    expect(encodeValue("n/a", "integer")).toBe("n/a");   // stays unmatched, never `= NULL`
  });
  it("normalises a Z-suffixed timestamp to the stored offset form", () => {
    // Same instant to Postgres, different TEXT to SQLite — and every stored row
    // uses `+00:00`, so an unfixed `Z` would silently match nothing.
    expect(encodeValue("2026-09-11T17:25:01.155Z", "timestamptz")).toBe("2026-09-11T17:25:01.155+00:00");
    expect(encodeValue("2026-09-11T17:25:01Z", "timestamptz")).toBe("2026-09-11T17:25:01+00:00");
  });
  it("trims the trailing zeros Postgres trims, so a `.150` bound still matches", () => {
    // Postgres prints 150 ms as `.15` and 100 ms as `.1`; the imported rows carry
    // that form. `new Date().toISOString()` always pads to three digits, so ~10% of
    // the timestamps the call sites bind (lib/assistantWrites.ts:190,
    // lib/assistantChatHistory.ts:84) end in a zero — left untrimmed they would
    // never equal their own row, and would sort on the wrong side of it.
    expect(encodeValue("2026-09-11T17:25:01.150Z", "timestamptz")).toBe("2026-09-11T17:25:01.15+00:00");
    expect(encodeValue("2026-09-11T17:25:01.100Z", "timestamptz")).toBe("2026-09-11T17:25:01.1+00:00");
    expect(encodeValue("2026-09-11T17:25:01.000Z", "timestamptz")).toBe("2026-09-11T17:25:01+00:00");
    expect(encodeValue(new Date("2026-09-11T17:25:01.150Z"), "timestamptz")).toBe("2026-09-11T17:25:01.15+00:00");
    // Round-tripping the exact string the export wrote is still the identity.
    expect(encodeValue("2026-09-11T17:25:01.15+00:00", "timestamptz")).toBe("2026-09-11T17:25:01.15+00:00");
  });
  it("never rewrites the fraction digits of an already-offset timestamp", () => {
    for (const v of ["2026-09-11T17:25:01.155+00:00", "2026-09-11T17:25:01.155000+00:00", "2026-09-11T17:25:01+00:00"]) {
      expect(encodeValue(v, "timestamptz")).toBe(v);
    }
  });
  it("leaves a partial date bound as-is — a bare day is already a correct lexical bound", () => {
    expect(encodeValue("2026-09-01", "timestamptz")).toBe("2026-09-01");
    expect(encodeValue("2026-09-%", "timestamptz")).toBe("2026-09-%");
  });
  it("renders a Date the way PostgREST renders timestamptz (trailing zeros trimmed)", () => {
    expect(encodeValue(new Date("2026-09-11T17:25:01.155Z"), "timestamptz")).toBe("2026-09-11T17:25:01.155+00:00");
    expect(encodeValue(new Date("2026-09-11T17:25:01.000Z"), "timestamptz")).toBe("2026-09-11T17:25:01+00:00");
    expect(encodeValue(new Date("2026-09-11T17:25:01.155Z"), "date")).toBe("2026-09-11");
    expect(encodeValue("2026-09-11T17:25:01.155Z", "date")).toBe("2026-09-11");
  });
  it("spells a number or boolean bound to a text/uuid column the way Postgres reads it", () => {
    // Bound as the JS value, D1's HTTP API sends every number as a REAL and TEXT
    // affinity stores it as `5.0` (and `true` → 1 → `1.0`). Postgres reads the
    // JSON literal: `5`, `true`. An object would otherwise bind as "[object Object]".
    expect(encodeValue(123, "text")).toBe("123");
    expect(encodeValue(2.5, "text")).toBe("2.5");
    expect(encodeValue(true, "text")).toBe("true");
    expect(encodeValue(false, "uuid")).toBe("false");
    expect(encodeValue(Number.NaN, "text")).toBe(null);
    expect(encodeValue("123", "text")).toBe("123");
    expect(encodeValue({ a: 1 }, "text")).toBe('{"a":1}');
  });
  it("keeps a bigint past 2^53 as its exact decimal string", () => {
    expect(encodeValue("9007199254740993", "bigint")).toBe("9007199254740993");
    expect(encodeValue("9007199254740991", "bigint")).toBe(9007199254740991);
    expect(encodeValue("9007199254740993", "numeric")).toBe(9007199254740992);
  });
  it("never throws on an Invalid Date — toISOString() would, and nothing here may", () => {
    // `JSON.stringify(new Date(NaN))` is null, so null is what would have gone to
    // Supabase on the wire anyway.
    for (const pg of ["timestamptz", "date", "text", undefined] as (PgType | undefined)[]) {
      expect(encodeValue(new Date("not a date"), pg)).toBe(null);
    }
  });
  it("binds an unknown column's value safely (stale registry)", () => {
    expect(encodeValue(true, undefined)).toBe(1);
    expect(encodeValue({ a: 1 }, undefined)).toBe('{"a":1}');
    expect(encodeValue(null, undefined)).toBe(null);
    expect(encodeValue("x", undefined)).toBe("x");
  });
});

/* ──────────────────────────── round trip ──────────────────────────── */

describe("encodeValue → decodeValue is lossless for every pg type", () => {
  const cases: [PgType, unknown][] = [
    ["boolean", true], ["boolean", false], ["boolean", null],
    ["integer", 0], ["integer", 90], ["integer", -3], ["integer", null],
    ["bigint", 9007199254740991], ["bigint", 1],
    ["numeric", 250.5], ["numeric", 0], ["numeric", -12.25],
    ["text", "Pflegekraft"], ["text", ""], ["text", "ä ö ü ß — ok"], ["text", null],
    ["uuid", "11111111-1111-4111-8111-111111111111"],
    ["date", "2026-09-11"], ["date", null],
    ["timestamptz", "2026-09-11T17:25:01.155+00:00"],
    ["timestamptz", "2026-09-11T17:25:01.155000+00:00"],
    ["timestamptz", "2026-09-11T17:25:01+00:00"],
    ["jsonb", { langs: [{ name: "Deutsch", level: "B2" }], nested: { deep: [1, 2, null] } }],
    ["jsonb", []], ["jsonb", {}], ["jsonb", "a string"], ["jsonb", 42], ["jsonb", true], ["jsonb", null],
    ["text[]", ["cv_de", "passport"]], ["text[]", []], ["text[]", [""]],
    ["uuid[]", ["11111111-1111-4111-8111-111111111111"]], ["uuid[]", []],
  ];
  for (const [pg, value] of cases) {
    it(`${pg}: ${JSON.stringify(value)}`, () => {
      expect(decodeValue(encodeValue(value, pg), pg)).toEqual(value);
    });
  }
});

/* ───────────────────── against a real SQLite ───────────────────── */

/**
 * tsc and hand-written fixtures cannot tell us what D1 *actually* hands back —
 * only running the statements can. Same escape hatch as tests/d1Schema.test.ts:
 * skipped on a Node without node:sqlite.
 */
type Db = { exec(sql: string): void; prepare(sql: string): { run(...a: unknown[]): unknown; get(...a: unknown[]): Record<string, unknown> | undefined } };
let DatabaseSync: (new (path: string) => Db) | null = null;
try { ({ DatabaseSync } = await import("node:sqlite") as unknown as { DatabaseSync: new (path: string) => Db }); } catch { /* older Node: skip */ }

describe.skipIf(!DatabaseSync)("decodeRows on values a real SQLite produces", () => {
  const draft = { langs: [{ name: "Deutsch", level: "B2" }], note: "hi", count: 7, done: false };
  const db = DatabaseSync ? new DatabaseSync(":memory:") : null;
  if (db) {
    // The storage classes d1/schema.sql uses: TEXT / INTEGER / REAL.
    db.exec(`create table documents (id TEXT, file_type TEXT, rotation INTEGER, uploaded_by_admin INTEGER, superseded_at TEXT)`);
    db.exec(`create table candidate_profiles (user_id TEXT, b2_stage TEXT, cv_draft TEXT)`);
    db.prepare(`insert into documents values (?,?,?,?,?)`).run("d1", "passport", 90, 1, null);
    db.prepare(`insert into candidate_profiles values (?,?,?)`).run("u1", "b2_passed", JSON.stringify(draft));
  }

  it("restores booleans/numbers/nulls from a plain SELECT", () => {
    const row = db!.prepare(`select "id","file_type","rotation","uploaded_by_admin","superseded_at" from documents`).get()!;
    expect(typeof row.uploaded_by_admin).toBe("number");            // what D1 really returns
    const out = decodeRows([row], intent({
      table: "documents",
      select: [col("id"), col("file_type"), col("rotation"), col("uploaded_by_admin"), col("superseded_at")],
    }), REGISTRY);
    expect(out).toEqual([{ id: "d1", file_type: "passport", rotation: 90, uploaded_by_admin: true, superseded_at: null }]);
  });

  it("walks the cv_langs key in SQL, and hands back only that sub-tree", () => {
    const sel = intent({ table: "candidate_profiles", select: [col("user_id"), col("cv_draft", "cv_langs", "langs")] });
    const q = buildSql(sel, REGISTRY) as BuiltQuery;
    const row = db!.prepare(q.sql).get(...q.params)!;
    expect(row["sel$1"]).toBe(JSON.stringify(draft.langs));          // the sub-tree, not the draft
    expect(decodeRows([row], sel, REGISTRY)).toEqual([{ user_id: "u1", cv_langs: draft.langs }]);
  });

  it("walks with `->`, which keeps JSON's types, where json_extract unquoted strings and turned false into 0", () => {
    const extracted = db!.prepare(`select json_extract("cv_draft",'$.note') as a, json_extract("cv_draft",'$.done') as c from candidate_profiles`).get()!;
    expect([extracted.a, extracted.c]).toEqual(["hi", 0]);
    const sel = intent({ table: "candidate_profiles", select: [col("cv_draft", "a", "note"), col("cv_draft", "b", "count"), col("cv_draft", "c", "done")] });
    const q = buildSql(sel, REGISTRY) as BuiltQuery;
    expect(decodeRows([db!.prepare(q.sql).get(...q.params)!], sel, REGISTRY)).toEqual([{ a: "hi", b: 7, c: false }]);
  });

  it("round-trips an encoded row through real storage", () => {
    const values = [
      encodeValue("11111111-1111-4111-8111-111111111111", "uuid"),
      encodeValue(["cv_de", "passport"], "text[]"),
      encodeValue(true, "boolean"),
      encodeValue(250.5, "numeric"),
      encodeValue(new Date("2026-09-11T17:25:01.155Z"), "timestamptz"),
    ];
    db!.exec(`create table rt (a TEXT, b TEXT, c INTEGER, d REAL, e TEXT)`);
    db!.prepare(`insert into rt values (?,?,?,?,?)`).run(...values);
    const row = db!.prepare(`select * from rt`).get()!;
    expect(decodeValue(row.a, "uuid")).toBe("11111111-1111-4111-8111-111111111111");
    expect(decodeValue(row.b, "text[]")).toEqual(["cv_de", "passport"]);
    expect(decodeValue(row.c, "boolean")).toBe(true);
    expect(decodeValue(row.d, "numeric")).toBe(250.5);
    expect(decodeValue(row.e, "timestamptz")).toBe("2026-09-11T17:25:01.155+00:00");
  });
});

describe("a full row survives the round trip", () => {
  it("encodes an upload_links row, decodes it, and gets the same values back", () => {
    const original = {
      id: "11111111-1111-4111-8111-111111111111",
      token_hash: "0f".repeat(32),
      candidate_user_id: "22222222-2222-4222-8222-222222222222",
      doc_keys: ["cv_de", "passport"],
      uploaded_keys: [],
      created_by: "admin@borivon.com",
      expires_at: "2026-09-12T10:00:00+00:00",
      used_at: null,
      revoked_at: null,
      created_at: "2026-09-11T17:25:01.155+00:00",
    };
    const columns = REGISTRY.upload_links.columns;
    const stored = Object.fromEntries(
      Object.entries(original).map(([k, v]) => [k, encodeValue(v, columns[k].pg)]),
    ) as Record<string, unknown>;
    // Everything really is a SQLite-bindable primitive on the way in.
    for (const v of Object.values(stored)) expect(["string", "number", "object"]).toContain(typeof v);

    expect(decodeRows([stored], intent({ table: "upload_links", select: "*" }), REGISTRY)[0]).toEqual(original);
  });
});

describe("the adapter's own SQL names", () => {
  it("are spelled like no column of any table, so a star's columns can never be mistaken for one", () => {
    const clashes = Object.entries(REGISTRY).flatMap(([t, m]) => Object.keys(m.columns).filter(isInternalSqlKey).map((c) => `${t}.${c}`));
    expect(clashes).toEqual([]);
    expect([isInternalSqlKey("sel$12"), isInternalSqlKey("rowid$"), isInternalSqlKey("json$1"), isInternalSqlKey("file_type")]).toEqual([true, true, false, false]);
  });
});
