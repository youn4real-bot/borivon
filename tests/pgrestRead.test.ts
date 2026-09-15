import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import { runSelect, type ReadResult, type Run } from "../lib/d1/pgrest/read";
import { parseParts, isPgrestError } from "../lib/d1/pgrest/parseRequest";
import { respond } from "../lib/d1/pgrest/respond";
import { SORT_ROW_LIMIT } from "../lib/d1/pgrest/buildSql";
import { compareText, sortRows } from "../lib/d1/pgrest/collate";
import type { JsonOp, PostgrestError, QueryIntent, Registry } from "../lib/d1/pgrest/types";

/**
 * Reads the adapter answers in more than one statement (lib/d1/pgrest/read.ts),
 * and the collation a text ORDER BY is sorted in (lib/d1/pgrest/collate.ts).
 *
 * The orderings asserted here are sequences live Supabase returned — the words
 * are the real ones (document labels, public authorities, cities), the lists
 * shortened. The statements run in a real SQLite against d1/schema.sql;
 * tests/d1ReadParity.test.ts compares the same behaviour against Supabase itself.
 */
const registry = JSON.parse(fs.readFileSync("d1/types.json", "utf8")) as Registry;
const U1 = "11111111-1111-4111-8111-111111111111";

function request(query: string, opts: { table?: string; method?: string; headers?: Record<string, string> } = {}): QueryIntent {
  const r = parseParts({ method: opts.method ?? "GET", url: `http://d1.local/rest/v1/${opts.table ?? "documents"}?${query}`, headers: opts.headers ?? {} }, registry);
  if (isPgrestError(r)) throw new Error(`${r.code}: ${r.message}`);
  return r;
}
function ok(r: ReadResult | PostgrestError): ReadResult {
  if ("code" in r) throw new Error(`${r.code}: ${r.message}`);
  return r;
}

describe("compareText — Postgres' text order, as the live project sorts it", () => {
  it("files an accented letter beside its base letter, not after Z", () => {
    expect(["PREFECTURE D'AIN CHOCK", "ZAGORA", "PRÉFECTURE CASABLANCA ANFA", "ALLI"].sort(compareText))
      .toEqual(["ALLI", "PRÉFECTURE CASABLANCA ANFA", "PREFECTURE D'AIN CHOCK", "ZAGORA"]);
    expect(["Baccalaureate", "b2_exam_confirmation", "Baccalauréat"].sort(compareText))
      .toEqual(["b2_exam_confirmation", "Baccalauréat", "Baccalaureate"]);
    expect(["TIFLET", "TÉTOUAN", "TETOUAN"].sort(compareText)).toEqual(["TETOUAN", "TÉTOUAN", "TIFLET"]);
  });

  it("puts punctuation before digits, and the lowercase one of two case-twins first", () => {
    expect(["ab4ab@x.com", "ab@x.com"].sort(compareText)).toEqual(["ab@x.com", "ab4ab@x.com"]);
    expect(["abitur_original.PDF", "abitur_original.pdf"].sort(compareText)).toEqual(["abitur_original.pdf", "abitur_original.PDF"]);
  });

  it("ties only identical strings, as varstr_cmp's strcmp fallback does", () => {
    expect(compareText("Lübeck", "Lübeck")).toBe(0);
    expect(compareText("a", "á")).not.toBe(0);
  });

  it("reverses the whole comparison on DESC, places NULLs as asked, and compares non-text keys as SQLite did", () => {
    const rows = [{ k: "b", n: 1 }, { k: null, n: 1 }, { k: "A", n: 2 }, { k: "a", n: 1 }, { k: "a", n: 2 }];
    expect(sortRows(rows, [{ key: "k", text: true, ascending: true, nullsFirst: false }, { key: "n", text: false, ascending: false, nullsFirst: true }])
      .map((r) => `${r.k}${r.n}`)).toEqual(["a2", "a1", "A2", "b1", "null1"]);
    expect(sortRows(rows, [{ key: "k", text: true, ascending: false, nullsFirst: true }, { key: "n", text: false, ascending: true, nullsFirst: false }])
      .map((r) => `${r.k}${r.n}`)).toEqual(["null1", "b1", "A2", "a1", "a2"]);
  });
});

type Db = { exec(sql: string): void; prepare(sql: string): { run(...a: unknown[]): unknown; all(...a: unknown[]): Record<string, unknown>[] } };
let DatabaseSync: (new (path: string) => Db) | null = null;
try { ({ DatabaseSync } = await import("node:sqlite") as unknown as { DatabaseSync: new (path: string) => Db }); }
catch { /* older Node without node:sqlite — the comparator tests above still run */ }

describe.skipIf(!DatabaseSync)("runSelect against the real D1 schema", () => {
  let run: Run;
  const TYPES = ["Baccalaureate", "abitur.PDF", "PREFECTURE D", "Baccalauréat", null, "b2_exam_confirmation", "PRÉFECTURE", "abitur.pdf"];
  const SORTED = ["abitur.pdf", "abitur.PDF", "b2_exam_confirmation", "Baccalauréat", "Baccalaureate", "PRÉFECTURE", "PREFECTURE D"];

  beforeAll(() => {
    const db = new DatabaseSync!(":memory:");
    db.exec(fs.readFileSync("d1/schema.sql", "utf8"));
    const doc = db.prepare(`INSERT INTO documents (id, user_id, file_name, file_path, file_type) VALUES (?,?,?,?,?)`);
    TYPES.forEach((t, i) => doc.run(`d${i}`, U1, `f${i}.pdf`, `p${i}`, t));
    // 1,100 rows: past Supabase's db-max-rows.
    db.prepare(`INSERT INTO rate_limits (bucket_key, window_start) SELECT 'k' || value, 0 FROM json_each(?)`)
      .run(JSON.stringify(Array.from({ length: 1100 }, (_, i) => i)));
    db.prepare(`INSERT INTO candidate_profiles (user_id, first_name, cv_draft, passport_confirmed_fields) VALUES (?, ?, ?, '{}')`)
      .run(U1, "Yassine", JSON.stringify({ postalCode: "51000", city: "EL HAJEB", langs: [{ name: "Deutsch", level: "B2" }] }));
    run = async (sql, params) => ({ results: db.prepare(sql).all(...(params as never[])), meta: {} });
  });

  it("orders a text column in Postgres' collation, with NULLs where Postgres puts them", async () => {
    const asc = ok(await runSelect(request("select=file_type&order=file_type.asc,id.asc"), registry, run));
    expect(asc.rows.map((r) => r.file_type)).toEqual([...SORTED, null]);
    const desc = ok(await runSelect(request("select=file_type&order=file_type.desc"), registry, run));
    expect(desc.rows.map((r) => r.file_type)).toEqual([null, ...[...SORTED].reverse()]);
    const nullsFirst = ok(await runSelect(request("select=file_type&order=file_type.asc.nullsfirst"), registry, run));
    expect(nullsFirst.rows.map((r) => r.file_type)).toEqual([null, ...SORTED]);
  });

  it("windows after sorting, fetches only that page, and counts every match", async () => {
    const intent = request("select=id,file_type&order=file_type.asc&offset=2&limit=3", { headers: { Prefer: "count=exact" } });
    const statements: string[] = [];
    const r = ok(await runSelect(intent, registry, (sql, params) => { statements.push(sql); return run(sql, params); }));
    expect(r.rows.map((x) => x.file_type)).toEqual(SORTED.slice(2, 5));
    expect(Object.keys(r.rows[0])).toEqual(["id", "file_type"]);          // rowid$ never reaches a caller
    expect([r.pageCount, r.total, statements.length]).toEqual([3, 8, 2]);  // keys, then the page by rowid
    const res = respond(r.rows, { count: r.total, pageCount: r.pageCount }, intent);
    expect([res.status, res.headers.get("content-range")]).toEqual([206, "2-4/8"]);
  });

  it("refuses to sort more matching rows than it holds in memory, rather than answer in another order", async () => {
    const huge: Run = async () => ({ results: Array.from({ length: SORT_ROW_LIMIT + 1 }, (_, i) => ({ "rowid$": i, "sort$0": "x" })), meta: {} });
    const r = await runSelect(request("select=id&order=file_type.asc"), registry, huge);
    expect("code" in r && r.code).toBe("54000");
  });

  it("counts beside the page, and works a HEAD's page out from the count", async () => {
    const page = ok(await runSelect(request("select=id&order=id.asc&limit=3", { headers: { Prefer: "count=exact" } }), registry, run));
    expect([page.rows.length, page.pageCount, page.total]).toEqual([3, 3, 8]);
    expect(ok(await runSelect(request("select=id&offset=6&limit=5", { method: "HEAD", headers: { Prefer: "count=exact" } }), registry, run)))
      .toEqual({ rows: [], pageCount: 2, total: 8 });
    expect(ok(await runSelect(request("select=id&offset=50", { method: "HEAD" }), registry, run))).toEqual({ rows: [], pageCount: 0 });
    // …which is how a HEAD past the end reaches its 416 (live: HEAD ?offset=5000 → 416, */761)
    const past = request("select=id&offset=50", { method: "HEAD", headers: { Prefer: "count=exact" } });
    const r = ok(await runSelect(past, registry, run));
    const res = respond(r.rows, { count: r.total, pageCount: r.pageCount }, past);
    expect([res.status, res.headers.get("content-range")]).toEqual([416, "*/8"]);
  });

  it("caps every read at 1000 rows, as Supabase's db-max-rows does", async () => {
    const rows = async (query: string, headers: Record<string, string> = {}) =>
      ok(await runSelect(request(query, { table: "rate_limits", headers }), registry, run)).rows;
    expect(await rows("select=bucket_key")).toHaveLength(1000);
    expect(await rows("select=bucket_key&limit=1500")).toHaveLength(1000);
    expect(await rows("select=bucket_key&limit=10")).toHaveLength(10);
    expect(await rows("select=bucket_key&offset=1050")).toHaveLength(50);
    expect(await rows("select=bucket_key", { Range: "0-1999" })).toHaveLength(1000);
    // the text-sort path too — and `k10` sorts before `k2`, as it does in Postgres
    const sorted = await rows("select=bucket_key&order=bucket_key.asc&limit=2000");
    expect([sorted.length, ...sorted.slice(0, 3).map((r) => r.bucket_key)]).toEqual([1000, "k0", "k1", "k10"]);
    const counted = request("select=bucket_key", { table: "rate_limits", headers: { Prefer: "count=exact" } });
    const c = ok(await runSelect(counted, registry, run));
    const res = respond(c.rows, { count: c.total, pageCount: c.pageCount }, counted);
    expect([res.status, res.headers.get("content-range")]).toEqual([206, "0-999/1100"]);
  });

  it("still hands lib/readAllRows.ts every row, one 1000-row page at a time", async () => {
    // The whole path — supabase-js, bvFetch, the text sort — with the cap in place.
    const { makeBvFetch } = await import("../lib/d1/bvFetch");
    const { readAllRows } = await import("../lib/readAllRows");
    const { createClient } = await import("@supabase/supabase-js");
    const db = createClient("http://127.0.0.1:9/", "test-key", {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        fetch: makeBvFetch({
          runner: { run: (sql, params = []) => run(sql, params) },
          passthrough: (async () => { throw new Error("offline: must never reach Supabase"); }) as unknown as typeof fetch,
        }),
      },
    });
    const pages: number[] = [];
    const all = await readAllRows<{ bucket_key: string }>((from, to) => {
      pages.push(from);
      return db.from("rate_limits").select("bucket_key").order("bucket_key").range(from, to);
    });
    expect(all.error).toBeNull();
    expect([all.data!.length, new Set(all.data!.map((r) => r.bucket_key)).size]).toEqual([1100, 1100]);
    expect(pages).toEqual([0, 1000]);
  });

  it("answers every request with a Response, never a rejection — a limit nested 100,000 parens deep included", async () => {
    const { makeBvFetch } = await import("../lib/d1/bvFetch");
    const bv = makeBvFetch({
      runner: { run: (sql, params = []) => run(sql, params) },
      passthrough: (async () => { throw new Error("offline: must never reach Supabase"); }) as unknown as typeof fetch,
    });
    const deep = 100_000;
    const get = (query: string) => bv(`http://127.0.0.1:9/rest/v1/rate_limits?select=bucket_key&order=bucket_key.asc&${query}`);
    const balanced = await get(`limit=${"(".repeat(deep)}2${")".repeat(deep)}`);
    expect([balanced.status, balanced.headers.get("content-range"), (await balanced.json()).length]).toEqual([200, "0-1/*", 2]);
    const unbalanced = await get(`limit=${"(".repeat(deep)}2`);
    expect([unbalanced.status, (await unbalanced.json()).length]).toEqual([200, 1000]);
    // A runner that fails in a way errors.ts has never seen still ends as PostgREST's error body.
    const broken = makeBvFetch({ runner: { run: async () => { throw Symbol("not an Error"); } }, passthrough: fetch });
    const res = await broken("http://127.0.0.1:9/rest/v1/rate_limits?select=bucket_key");
    expect([res.status, Object.keys(await res.json())]).toEqual([500, ["code", "details", "hint", "message"]]);
  });

  it("names SQL columns so no alias can collide with the adapter's own, on the text-sort path too", async () => {
    const rows = async (query: string) => ok(await runSelect(request(query), registry, run)).rows;
    // live: employers?select=id,rowid$:slug&order=name.asc&limit=3 is 3 rows; the adapter answered [].
    const page = await rows("select=id,rowid$:file_name,sort$0:file_type&order=file_type.asc,id.asc&limit=3");
    expect(page.map((r) => Object.keys(r).join())).toEqual(["id,rowid$,sort$0", "id,rowid$,sort$0", "id,rowid$,sort$0"]);
    expect(page.map((r) => r["sort$0"])).toEqual(SORTED.slice(0, 3));
    expect(page.every((r) => /^f\d\.pdf$/.test(String(r["rowid$"])))).toBe(true);
    // live: app_settings?select=key,json$2:key,v:value->x answers json$2 with the key, not another column.
    const [one] = await rows("select=file_type,json$2:file_name,sel$0:file_path,v:user_id->x,sel$3:file_name&file_name=eq.f1.pdf");
    expect(one).toEqual({ file_type: "abitur.PDF", "json$2": "f1.pdf", "sel$0": "p1", v: null, "sel$3": "f1.pdf" });
  });

  it("walks a JSON column's keys in SQL to exactly the value the JavaScript walk finds, moving only that value", async () => {
    const { jsonPathValue } = await import("../lib/d1/pgrest/decode");
    const db = new DatabaseSync!(":memory:");
    db.exec(fs.readFileSync("d1/schema.sql", "utf8"));
    // Every shape the real schema lets a jsonb column hold (its CHECK json_valid refuses the rest)…
    const stored = [
      { postalCode: "51000", city: "EL HAJEB", zero: 0, off: false, n: null, big: 1e21, small: 1e-7, u: "ü", "": "empty", "a]b": 1, $: 2, "\\": 3,
        'q"uote': 4, "\n": 5, "😀": { "a.b": 6 }, __proto__x: 7, esc: "a\"b\\c\x01\u2028/",
        langs: [{ name: "Deutsch", level: "B2" }, { name: "Arabisch", level: "Muttersprache" }], "a.b": { "x y": [1, [2, 3]] }, 1: ["09:00", "14:00"] },
      "just a string", 5, true, null, [], {}, [1, "2", null, { a: [true] }], [[[[[[[[[["deep"]]]]]]]]]],
      { a: { a: { a: { a: { a: { a: { a: { a: { a: { a: "ten keys down" } } } } } } } } } },
    ].map((v) => JSON.stringify(v));
    const id = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    const insert = db.prepare(`INSERT INTO candidate_profiles (user_id, cv_draft, passport_confirmed_fields) VALUES (?, ?, '{}')`);
    stored.forEach((s, i) => insert.run(id(i), s));
    // …and rows written around that CHECK (before it existed, or with it switched off), which
    // decodeValue reads as JSON strings: `->` on them raised "malformed JSON", a 500 for the read.
    db.exec("PRAGMA ignore_check_constraints = ON");
    for (const bad of ["not json at all", "", "{bad", '{"a":1,}']) insert.run(id(stored.push(bad) - 1), bad);
    db.exec("PRAGMA ignore_check_constraints = OFF");

    const statements: { sql: string; params: unknown[]; arrowBytes: number }[] = [];
    const counted: Run = async (sql, params) => {
      const results = db.prepare(sql).all(...(params as never[]));
      statements.push({ sql, params, arrowBytes: JSON.stringify(results.map((r) => r["sel$1"] ?? null)).length });
      return { results, meta: {} };
    };
    const k = (key: string, arrow: "->" | "->>" = "->"): JsonOp => ({ arrow, key });
    const n = (index: number, arrow: "->" | "->>" = "->"): JsonOp => ({ arrow, index });
    const keysDown = (count: number, last: "->" | "->>" = "->") => Array.from({ length: count }, (_, i) => k("a", i === count - 1 ? last : "->"));
    const paths: JsonOp[][] = [
      [k("postalCode")], [k("postalCode", "->>")], [k("zero")], [k("off", "->>")], [k("n")], [k("n", "->>")], [k("langs")], [k("langs", "->>")],
      [k("langs"), n(0)], [k("langs"), n(0, "->>")], [k("langs"), n(-1), k("level")], [k("langs"), n(-1), k("level", "->>")], [k("langs"), n(-3)],
      [k("langs"), n(2)], [k("city"), n(0)], [k("city"), n(-1)], [k("city"), n(1)], [k("city"), n(0, "->>")], [n(0)], [n(-1)], [n(1)], [n(0, "->>")],
      [n(3)], [n(3), k("a"), n(0)], [n(3), k("a"), n(-1, "->>")], [k("langs"), k("name")], [k("missing")], [k("missing"), n(0)], [k("big")], [k("big", "->>")],
      [k("small", "->>")], [k("u")], [k("a.b"), k("x y"), n(1), n(-1)], [k("a.b"), k("x y", "->>")], [k("1")], [k("1", "->>")], [k("1"), n(-1, "->>")],
      [k("")], [k("a]b")], [k("$")], [k("\\")], [k('q"uote')], [k("\n")], [k("😀"), k("a.b")], [k("__proto__x")], [k("esc")], [k("esc", "->>")],
      [k("langs"), k("\\"), n(0)], [k("n"), n(0)], [k("n"), n(-1, "->>")], [k("n"), n(1)], [k("postalCode"), n(0)], [k("postalCode"), n(-1, "->>")],
      keysDown(10), keysDown(10, "->>"), keysDown(9), [...keysDown(10), n(0)], [...keysDown(10), n(0, "->>")], keysDown(200),
    ];
    const problems: string[] = [];
    for (const ops of paths) {
      const base = request("select=user_id&order=user_id.asc", { table: "candidate_profiles" });
      const r = ok(await runSelect({ ...base, select: [{ column: "user_id" }, { column: "cv_draft", alias: "x", jsonPath: ops }] }, registry, counted));
      // SQL walks the leading keys it can spell, as one path; JavaScript walks from there.
      const lead: string[] = [];
      for (const op of ops) { if (!("key" in op) || /["\\\x00-\x1f]/.test(op.key)) break; lead.push(op.key); }
      const last = statements[statements.length - 1];
      const label = JSON.stringify(ops).slice(0, 120);
      const path = lead.length ? [`$${lead.map((key) => `."${key}"`).join("")}`] : [];
      // The params are the path, then the LIMIT runSelect caps every read with.
      if (JSON.stringify(last.params.slice(0, -1)) !== JSON.stringify(path) || last.sql.includes(`"cv_draft" AS`) === lead.length > 0) {
        problems.push(`${label}: SQL walked ${JSON.stringify(last.params).slice(0, 80)}, expected ${lead.length} keys`);
      }
      r.rows.forEach((row, i) => {
        const expected = jsonPathValue(stored[i], "jsonb", ops);
        if (JSON.stringify(row.x) !== JSON.stringify(expected)) problems.push(`${label} on row ${i}: ${JSON.stringify(row.x)} ≠ ${JSON.stringify(expected)}`);
      });
    }
    expect(problems).toEqual([]);
    // Only the landing value leaves the database: `->postalCode` moves a sliver of what the drafts hold.
    const draftBytes = stored.reduce((sum, s) => sum + s.length, 0);
    expect(statements[0].arrowBytes).toBeLessThan(draftBytes / 3);

    // A mutation's RETURNING is built by the same rule — here past D1's 100 parameters, where
    // fitParams packs every operand, the path included, into one JSON array.
    const { makeBvFetch } = await import("../lib/d1/bvFetch");
    const { createClient } = await import("@supabase/supabase-js");
    const client = createClient("http://127.0.0.1:9/", "test-key", {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: makeBvFetch({ runner: { run: (sql, params = []) => counted(sql, params) }, passthrough: (async () => { throw new Error("offline"); }) as unknown as typeof fetch }) },
    });
    const ids = stored.map((_, i) => id(i));
    const matchAll = [...ids, ...Array.from({ length: 100 - ids.length }, (_, i) => id(1000 + i))].map((u) => `user_id.eq.${u}`).join(",");
    const upd = await client.from("candidate_profiles").update({ first_name: "Probe" }).or(matchAll)
      .select("user_id,x:cv_draft->langs->-1->>level,y:cv_draft->postalCode,z:cv_draft->a->a->a");
    expect(upd.error).toBeNull();
    expect(statements[statements.length - 1].params).toHaveLength(1);                   // packed: SET + 100 operands + 3 paths
    // postgrest-js's select-string type parser cannot read `->-1->>level`; the rows are plain records.
    const byId = new Map(((upd.data ?? []) as unknown as Record<string, unknown>[]).map((row) => [row.user_id, row]));
    expect(byId.size).toBe(stored.length);
    for (const [i, s] of stored.entries()) {
      expect(byId.get(id(i)), `row ${i}`).toEqual({
        user_id: id(i),
        x: jsonPathValue(s, "jsonb", [k("langs"), n(-1), k("level", "->>")]),
        y: jsonPathValue(s, "jsonb", [k("postalCode")]),
        z: jsonPathValue(s, "jsonb", keysDown(3)),
      });
    }
  });

  it("walks arrow selects in SQL, and keeps a star's columns beside them", async () => {
    const one = async (select: string) =>
      ok(await runSelect(request(`select=${encodeURIComponent(select)}`, { table: "candidate_profiles" }), registry, run)).rows[0];
    expect(await one("user_id,cv_draft->postalCode,l:cv_draft->>langs,cv_draft->langs->0,first_name->a,c:cv_draft->city->-1")).toEqual({
      user_id: U1, postalCode: "51000", l: '[{"name": "Deutsch", "level": "B2"}]', langs: { name: "Deutsch", level: "B2" }, a: null, c: "EL HAJEB",
    });
    const star = await one("*,x:cv_draft->city");
    expect(Object.keys(star)).toEqual([...Object.keys(registry.candidate_profiles.columns), "x"]);
    expect([star.first_name, star.x]).toEqual(["Yassine", "EL HAJEB"]);
  });
});
