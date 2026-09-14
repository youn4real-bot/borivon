import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import { buildSql, isPostgrestError, encodeParam, likePatternToGlob, normalizeTimestamp } from "../lib/d1/pgrest/buildSql";
import { selectOutputKey } from "../lib/d1/pgrest/decode";
import type { BuiltQuery, Condition, FilterOp, QueryIntent, Registry, Where } from "../lib/d1/pgrest/types";

/**
 * buildSql turns a QueryIntent into SQLite the PostgREST→D1 adapter can hand to
 * D1. Two kinds of test here, because SQL that LOOKS right isn't the bar:
 *
 *  1. shape tests  — the exact SQL + bound params for every filter/modifier/
 *     mutation the codebase actually uses, plus identifier safety.
 *  2. behaviour tests — the same SQL RUN against the real d1/schema.sql in a
 *     real SQLite, asserting the rows Postgres would have returned. That's the
 *     only way to catch the silent divergences (NULL ordering, LIKE escaping,
 *     three-valued logic under `not.`) that would otherwise reach a candidate.
 */

const registry: Registry = JSON.parse(fs.readFileSync("d1/types.json", "utf8"));

const intent = (over: Partial<QueryIntent> & Pick<QueryIntent, "table">): QueryIntent => ({
  action: "select", select: "*", where: [], order: [], returning: "minimal", ...over,
});
const cmp = (column: string, op: FilterOp, value: unknown, negate = false): Condition =>
  ({ kind: "cmp", column, op, value, ...(negate ? { negate: true } : {}) });
// Written values go through the column's input function, so a uuid column needs a real uuid.
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
/** Where a bulk write's rows come from: one JSON parameter, unpacked by json_each. */
const FROM_ROWS = `FROM json_each(?) AS "row$" WHERE true ORDER BY "row$"."key"`;
const cell = (i: number) => `json_extract("row$"."value", '$[${i}]')`;

/** buildSql(), asserting it succeeded. */
function ok(i: QueryIntent): BuiltQuery {
  const r = buildSql(i, registry);
  if (isPostgrestError(r)) throw new Error(`unexpected PostgREST error ${r.code}: ${r.message}`);
  return r;
}
/** buildSql(), asserting it refused. */
function refused(i: QueryIntent) {
  const r = buildSql(i, registry);
  if (!isPostgrestError(r)) throw new Error(`expected a PostgREST error, got SQL: ${r.sql}`);
  return r;
}

/* ────────────────────────────── shape ──────────────────────────────── */

describe("select", () => {
  it("builds the plain column list and the star form", () => {
    expect(ok(intent({ table: "documents", select: "*" })).sql).toBe(`SELECT * FROM "documents"`);
    expect(ok(intent({
      table: "documents",
      select: [{ column: "id" }, { column: "file_name" }],
    })).sql).toBe(`SELECT "id", "file_name" FROM "documents"`);
  });

  it("aliases a column, and reads a json path (the `cv_langs:cv_draft->langs` form)", () => {
    expect(ok(intent({ table: "documents", select: [{ column: "file_name", alias: "n" }] })).sql)
      .toBe(`SELECT "file_name" AS "n" FROM "documents"`);
    const q = ok(intent({
      table: "candidate_profiles",
      select: [{ column: "user_id" }, { column: "cv_draft", alias: "cv_langs", jsonPath: "langs" }],
    }));
    expect(q.sql).toBe(`SELECT "user_id", json_extract("cv_draft", ?) AS "cv_langs" FROM "candidate_profiles"`);
    expect(q.params).toEqual(["$.langs"]);   // bound, never interpolated
  });

  it("names a json path column the way decode.ts will read it back", () => {
    // parseRequest always supplies the alias, but if it ever stopped, emitting
    // `AS "cv_draft"` while decodeRows() looks for `langs` would hand every
    // caller null — a json-path item gets no fallback to the source column, by
    // decode.ts's design (that fallback would leak the whole CV draft).
    const item = { column: "cv_draft", jsonPath: "langs" };
    expect(selectOutputKey(item)).toBe("langs");
    expect(ok(intent({ table: "candidate_profiles", select: [item] })).sql)
      .toBe(`SELECT json_extract("cv_draft", ?) AS "langs" FROM "candidate_profiles"`);
    // A chained path walks every segment — `$."a->b"` would simply never match.
    expect(ok(intent({ table: "candidate_profiles", select: [{ column: "cv_draft", alias: "x", jsonPath: "a->b" }] })).params)
      .toEqual(["$.a.b"]);
    expect(ok(intent({ table: "candidate_profiles", select: [{ column: "cv_draft", alias: "x", jsonPath: "langs->0->name" }] })).params)
      .toEqual(["$.langs[0].name"]);
    // `->` takes a KEY, never a JSONPath: a key spelled `$.langs` is looked up
    // literally (what Postgres does) instead of becoming a live path expression
    // — which is also what keeps a malformed one out of json_extract's throat.
    expect(ok(intent({ table: "candidate_profiles", select: [{ column: "cv_draft", alias: "x", jsonPath: "$.langs" }] })).params)
      .toEqual([`$."$.langs"`]);
  });

  it("emits every comparison filter with one placeholder per value", () => {
    const ops: [FilterOp, string][] = [["eq", "="], ["neq", "<>"], ["gt", ">"], ["gte", ">="], ["lt", "<"], ["lte", "<="]];
    for (const [op, sym] of ops) {
      const q = ok(intent({ table: "documents", where: [cmp("status", op, "pending")] }));
      expect(q.sql).toBe(`SELECT * FROM "documents" WHERE "status" ${sym} ?`);
      expect(q.params).toEqual(["pending"]);
    }
  });

  it("sends an `in` list as ONE bound parameter (D1 caps a statement at 100)", () => {
    // d1/import.mjs already caps itself at 90 bound params for this reason. One
    // placeholder per item would break `.in("user_id", scope.visibleIds)`
    // (lib/assistantTools.ts:209) the day a sub-admin's scope passes 100
    // candidates — a hard D1 error, not a wrong answer, but broken either way.
    const q = ok(intent({ table: "documents", where: [cmp("id", "in", ["a", "b", "c"])] }));
    expect(q.sql).toBe(`SELECT * FROM "documents" WHERE "id" IN (SELECT value FROM json_each(?))`);
    expect(q.params).toEqual([`["a","b","c"]`]);
    const big = ok(intent({
      table: "documents",
      where: [cmp("user_id", "in", Array.from({ length: 500 }, (_, i) => `u${i}`))],
    }));
    expect(big.params).toHaveLength(1);
    // Items are still encoded per column type on the way into the array.
    expect(ok(intent({ table: "documents", where: [cmp("uploaded_by_admin", "in", [true, false])] })).params)
      .toEqual(["[1,0]"]);
  });

  it("turns an EMPTY `in` into a constant, matching Postgres' `= ANY('{}')`", () => {
    // Not SQLite's `IN ()` extension: `0` is unambiguous and negates correctly.
    expect(ok(intent({ table: "documents", where: [cmp("id", "in", [])] })).sql)
      .toBe(`SELECT * FROM "documents" WHERE 0`);
    expect(ok(intent({ table: "documents", where: [cmp("id", "in", [], true)] })).sql)
      .toBe(`SELECT * FROM "documents" WHERE NOT (0)`);
  });

  it("maps `is` to IS NULL / IS NOT NULL / IS 0|1", () => {
    expect(ok(intent({ table: "documents", where: [cmp("status", "is", null)] })).sql)
      .toBe(`SELECT * FROM "documents" WHERE "status" IS NULL`);
    expect(ok(intent({ table: "documents", where: [cmp("status", "is", null, true)] })).sql)
      .toBe(`SELECT * FROM "documents" WHERE "status" IS NOT NULL`);
    const q = ok(intent({ table: "documents", where: [cmp("uploaded_by_admin", "is", true)] }));
    expect(q.sql).toBe(`SELECT * FROM "documents" WHERE "uploaded_by_admin" IS ?`);
    expect(q.params).toEqual([1]);            // booleans live as 0/1 in D1
  });

  it("gives ilike an ESCAPE clause and like a case-sensitive GLOB", () => {
    const i = ok(intent({ table: "sub_admins", where: [cmp("email", "ilike", "first\\_last@x.com")] }));
    expect(i.sql).toBe(`SELECT * FROM "sub_admins" WHERE "email" LIKE ? ESCAPE '\\'`);
    expect(i.params).toEqual(["first\\_last@x.com"]);   // ciEmail()'s escaping is passed through untouched
    const l = ok(intent({ table: "sub_admins", where: [cmp("email", "like", "A%_b")] }));
    expect(l.sql).toBe(`SELECT * FROM "sub_admins" WHERE "email" GLOB ?`);
    expect(l.params).toEqual(["A*?b"]);
  });

  it("wraps `not.<op>` around the whole comparison", () => {
    const q = ok(intent({ table: "documents", where: [cmp("status", "eq", "approved", true)] }));
    expect(q.sql).toBe(`SELECT * FROM "documents" WHERE NOT ("status" = ?)`);
    expect(q.params).toEqual(["approved"]);
  });

  it("builds a nested or=(…) tree", () => {
    // or=(cohort_id.eq.X,and(cohort_id.is.null,level.eq.A1)) — app/api/portal/academy/me
    const where: Where[] = [{
      kind: "or",
      children: [
        cmp("cohort_id", "eq", "X"),
        { kind: "and", children: [cmp("cohort_id", "is", null), cmp("level", "eq", "A1")] },
      ],
    }];
    const q = ok(intent({ table: "academy_quizzes", select: [{ column: "id" }], where: [cmp("published", "eq", true), ...where] }));
    expect(q.sql).toBe(
      `SELECT "id" FROM "academy_quizzes" WHERE "published" = ? AND ("cohort_id" = ? OR ("cohort_id" IS NULL AND "level" = ?))`,
    );
    expect(q.params).toEqual([1, "X", "A1"]);
  });

  it("orders with explicit NULL placement on nullable columns only", () => {
    // Postgres default: ASC → nulls last, DESC → nulls first. SQLite's default
    // is the opposite, so the emulation term is mandatory.
    expect(ok(intent({ table: "documents", order: [{ column: "uploaded_at", ascending: false }] })).sql)
      .toBe(`SELECT * FROM "documents" ORDER BY ("uploaded_at" IS NULL) DESC, "uploaded_at" DESC`);
    expect(ok(intent({ table: "documents", order: [{ column: "uploaded_at", ascending: true }] })).sql)
      .toBe(`SELECT * FROM "documents" ORDER BY ("uploaded_at" IS NULL) ASC, "uploaded_at" ASC`);
    expect(ok(intent({ table: "documents", order: [{ column: "uploaded_at", ascending: true, nullsFirst: true }] })).sql)
      .toBe(`SELECT * FROM "documents" ORDER BY ("uploaded_at" IS NULL) DESC, "uploaded_at" ASC`);
    // NOT NULL column → no emulation term needed.
    expect(ok(intent({ table: "documents", order: [{ column: "rotation", ascending: true }] })).sql)
      .toBe(`SELECT * FROM "documents" ORDER BY "rotation" ASC`);
    // Plain text sorts under a case-insensitive collation, like Supabase's en_US.UTF-8.
    expect(ok(intent({ table: "documents", order: [{ column: "file_name", ascending: true }] })).sql)
      .toBe(`SELECT * FROM "documents" ORDER BY "file_name" COLLATE NOCASE ASC`);
  });

  it("binds limit and range, and gives a bare offset the LIMIT -1 SQLite needs", () => {
    const a = ok(intent({ table: "documents", limit: 10 }));
    expect(a.sql).toBe(`SELECT * FROM "documents" LIMIT ?`);
    expect(a.params).toEqual([10]);
    const b = ok(intent({ table: "documents", limit: 25, offset: 50 }));
    expect(b.sql).toBe(`SELECT * FROM "documents" LIMIT ? OFFSET ?`);
    expect(b.params).toEqual([25, 50]);
    const c = ok(intent({ table: "documents", offset: 1000 }));
    expect(c.sql).toBe(`SELECT * FROM "documents" LIMIT -1 OFFSET ?`);
    expect(c.params).toEqual([1000]);
    expect(refused(intent({ table: "documents", limit: -1 })).code).toBe("PGRST103");
  });

  it("counts without paging for head+count:exact, and adds no LIMIT for single/maybeSingle", () => {
    const q = ok(intent({
      table: "documents", head: true, count: "exact", limit: 1,
      order: [{ column: "uploaded_at", ascending: false }],
      where: [cmp("user_id", "eq", "u1")],
    }));
    // The Content-Range total spans every matching row — limit/order are noise here.
    expect(q.sql).toBe(`SELECT COUNT(*) AS "count" FROM "documents" WHERE "user_id" = ?`);
    expect(q.params).toEqual(["u1"]);
    // .maybeSingle()/.single() must still SEE a second row so respond() can raise
    // PGRST116 — an injected LIMIT 1 would silently turn "too many rows" into a hit.
    expect(ok(intent({ table: "documents", singleObject: true, requireExactlyOne: true })).sql)
      .toBe(`SELECT * FROM "documents"`);
  });
});

describe("identifier safety", () => {
  it("refuses an unknown table with PGRST205 (the missing-migration branch)", () => {
    const e = refused(intent({ table: "not_a_table" }));
    expect(e.code).toBe("PGRST205");
    expect(e.status).toBe(404);
    expect(e.message).toMatch(/schema cache/i);
  });

  it("refuses an unknown column with 42703 everywhere it can appear", () => {
    const spots: QueryIntent[] = [
      intent({ table: "documents", select: [{ column: "nope" }] }),
      intent({ table: "documents", where: [cmp("nope", "eq", 1)] }),
      intent({ table: "documents", order: [{ column: "nope", ascending: true }] }),
      intent({ table: "documents", action: "insert", values: [{ nope: 1 }] }),
      intent({ table: "documents", action: "update", values: [{ nope: 1 }] }),
      intent({ table: "documents", action: "upsert", values: [{ user_id: "u" }], onConflict: ["nope"] }),
    ];
    for (const i of spots) {
      const e = refused(i);
      expect(e.code).toBe("42703");
      expect(e.status).toBe(400);
      // app/api/portal/admin/organizations/[id]/route.ts branches on the code;
      // lib/assistantTools.ts falls back to this regex.
      expect(e.message).toMatch(/column .* does not exist/i);
    }
  });

  it("never lets caller text reach the SQL — unknown identifiers are rejected, known ones quoted", () => {
    expect(refused(intent({ table: "documents", where: [cmp(`id" ; DROP TABLE documents; --`, "eq", 1)] })).code).toBe("42703");
    expect(refused(intent({ table: `documents"; DROP TABLE documents; --` })).code).toBe("PGRST205");
    const q = ok(intent({ table: "documents", where: [cmp("file_name", "eq", `x"; DROP TABLE documents; --`)] }));
    expect(q.sql).toBe(`SELECT * FROM "documents" WHERE "file_name" = ?`);   // the payload is a parameter
    expect(q.params).toEqual([`x"; DROP TABLE documents; --`]);
  });

  it("refuses a write to a generated column instead of letting D1 fail opaquely", () => {
    const e = refused(intent({ table: "messages", action: "insert", values: [{ has_attachment: 1 }] }));
    expect(e.code).toBe("428C9");
    expect(e.status).toBe(400);
  });

  it("returns an unexpected internal failure instead of throwing it", () => {
    // lib/d1/bvFetch.ts only wraps the D1 call, so a throw from here escapes as a
    // rejected fetch and becomes an exception at the call site — where every
    // route is written to branch on `{ error }`. A BigInt on a jsonb column is
    // the cheapest way to make the codec throw (JSON.stringify refuses it).
    const e = refused(intent({
      table: "organizations", action: "insert",
      values: [{ id: U1, name: "n", invite_code: "c", vaccine_req: BigInt(1) as unknown as number }],
    }));
    expect(e.code).toBe("XX000");      // errors.ts's own unknown bucket
    expect(e.status).toBe(500);
  });
});

describe("parameter encoding", () => {
  it("encodes the way d1/export-data.mjs wrote the row", () => {
    expect(encodeParam(true, "boolean")).toBe(1);
    expect(encodeParam(false, "boolean")).toBe(0);
    expect(encodeParam("true", "boolean")).toBe(1);
    expect(encodeParam(["a", "b"], "text[]")).toBe(`["a","b"]`);
    expect(encodeParam({ langs: ["fr"] }, "jsonb")).toBe(`{"langs":["fr"]}`);
    expect(encodeParam(undefined, "text")).toBe(null);
    expect(encodeParam(null, "text")).toBe(null);
    expect(encodeParam(7, "integer")).toBe(7);
    expect(encodeParam("7", "integer")).toBe(7);
    expect(encodeParam(NaN, "numeric")).toBe(null);
    expect(encodeParam("Zoé", "text")).toBe("Zoé");
  });

  it("rewrites a JS ISO timestamp to the stored offset form so ordering stays chronological", () => {
    // "…155Z" sorts ABOVE "…155+00:00" byte-wise — the bug this prevents.
    expect(encodeParam("2026-09-11T17:25:01.155Z", "timestamptz")).toBe("2026-09-11T17:25:01.155+00:00");
    // Postgres never pads a fraction, so 150 ms is stored ".15". A ".150+00:00"
    // filter sorts ABOVE it and `.gte(col, iso)` would drop the boundary row —
    // decode.ts's codec trims, which is why the encoding lives there, not here.
    expect(encodeParam("2026-09-11T17:25:01.150Z", "timestamptz")).toBe("2026-09-11T17:25:01.15+00:00");
    expect(encodeParam("2026-09-11T17:25:01.000Z", "timestamptz")).toBe("2026-09-11T17:25:01+00:00");
    // A non-UTC offset is the same instant to Postgres but two hours later as
    // TEXT — normalizeTimestamp re-spells it before the codec renders it.
    expect(normalizeTimestamp("2026-09-11T19:25:01.5+02:00")).toBe("2026-09-11T17:25:01.5Z");
    expect(encodeParam("2026-09-11T19:25:01.5+02:00", "timestamptz")).toBe("2026-09-11T17:25:01.5+00:00");
    expect(encodeParam("2026-09-11 17:25:01", "timestamptz")).toBe("2026-09-11T17:25:01+00:00");
    // A value that is already UTC is byte-for-byte, both spellings of it: the
    // copy holds imported rows (".155+00:00") next to rows a D1 DEFAULT wrote
    // (".155000+00:00"), and lib/reminderFire.ts:82 round-trips one straight
    // back into `.eq("due_at", r.due_at)` — re-rendering would miss the other.
    expect(encodeParam("2026-09-11T17:25:01.155000+00:00", "timestamptz")).toBe("2026-09-11T17:25:01.155000+00:00");
    expect(encodeParam("2026-09-11T17:25:01.15+00:00", "timestamptz")).toBe("2026-09-11T17:25:01.15+00:00");
    // Spellings the codec would not recognise as an instant are repaired first:
    // a missing `:00` (Postgres always prints seconds) and a lowercase z.
    expect(encodeParam("2026-09-11T17:25Z", "timestamptz")).toBe("2026-09-11T17:25:00+00:00");
    expect(encodeParam("2026-09-11T17:25:01.155z", "timestamptz")).toBe("2026-09-11T17:25:01.155+00:00");
    // Not a timestamp → untouched (a bare date is already a correct lexical bound).
    expect(normalizeTimestamp("2026-09-11")).toBe("2026-09-11");
    expect(encodeParam("2026-09-11T17:25:01.155Z", "text")).toBe("2026-09-11T17:25:01.155Z");
    expect(encodeParam(new Date("2026-09-11T17:25:01.155Z"), "date")).toBe("2026-09-11");
    // A full instant handed to a `date` column is what Postgres would cast away.
    expect(encodeParam("2026-09-11T17:25:01.155Z", "date")).toBe("2026-09-11");
    // An Invalid Date used to throw straight out of buildSql (a 500 that escapes
    // lib/d1/bvFetch.ts's try/catch); supabase-js would have sent JSON null.
    expect(encodeParam(new Date("nope"), "timestamptz")).toBe(null);
  });

  it("translates LIKE wildcards and escapes GLOB's own metacharacters", () => {
    expect(likePatternToGlob("%abc%")).toBe("*abc*");
    expect(likePatternToGlob("a_c")).toBe("a?c");
    expect(likePatternToGlob("100%\\_off")).toBe("100*_off");   // \_ is a literal underscore
    expect(likePatternToGlob("a*b?c[d")).toBe("a[*]b[?]c[[]d"); // literals GLOB would otherwise read as wildcards
  });
});

describe("mutations", () => {
  it("inserts one row and a bulk array with a single column list and ONE parameter", () => {
    // D1 binds at most 100 parameters; a placeholder per cell refused every bulk
    // write past that (tests/pgrestWrites.test.ts has the call sites).
    const one = ok(intent({ table: "documents", action: "insert", values: [{ user_id: U1, file_name: "a.pdf" }] }));
    expect(one.sql).toBe(`INSERT INTO "documents" ("user_id", "file_name") SELECT ${cell(0)}, ${cell(1)} ${FROM_ROWS}`);
    expect(one.params).toEqual([JSON.stringify([[U1, "a.pdf"]])]);
    const many = ok(intent({
      table: "documents", action: "insert",
      values: [{ user_id: U1, file_name: "a.pdf" }, { user_id: U2, file_name: "b.pdf" }],
    }));
    expect(many.sql).toBe(one.sql);
    expect(many.params).toEqual([JSON.stringify([[U1, "a.pdf"], [U2, "b.pdf"]])]);
  });

  it("refuses a bulk insert whose objects disagree on keys (PGRST102), like PostgREST", () => {
    // Filling the gap with NULL would overwrite a column DEFAULT — guessing is worse than failing.
    const e = refused(intent({
      table: "documents", action: "insert",
      values: [{ user_id: "u1", file_name: "a.pdf" }, { user_id: "u2" }],
    }));
    expect(e.code).toBe("PGRST102");
  });

  it("answers an empty insert / empty patch with a no-op that returns no rows", () => {
    expect(ok(intent({ table: "documents", action: "insert", values: [] })).sql)
      .toBe(`SELECT * FROM "documents" WHERE 0`);
    expect(ok(intent({ table: "documents", action: "update", values: [{}] })).sql)
      .toBe(`SELECT * FROM "documents" WHERE 0`);
  });

  it("appends RETURNING only when rows were asked for", () => {
    const rep = ok(intent({
      table: "documents", action: "insert", returning: "representation",
      select: [{ column: "id" }], values: [{ user_id: U1, file_name: "a.pdf" }],
    }));
    expect(rep.sql).toBe(`INSERT INTO "documents" ("user_id", "file_name") SELECT ${cell(0)}, ${cell(1)} ${FROM_ROWS} RETURNING "id"`);
    const min = ok(intent({ table: "documents", action: "insert", values: [{ user_id: U1, file_name: "a.pdf" }] }));
    expect(min.sql).not.toMatch(/RETURNING/);
    // `.select()` with no columns after a mutation = return everything.
    const star = ok(intent({
      table: "documents", action: "insert", returning: "representation", select: [],
      values: [{ user_id: U1, file_name: "a.pdf" }],
    }));
    expect(star.sql).toMatch(/RETURNING \*$/);
  });

  it("orders update params SET → WHERE → RETURNING, matching the SQL text", () => {
    const q = ok(intent({
      table: "documents", action: "update", returning: "representation",
      select: [{ column: "id" }],
      values: [{ status: "approved", feedback: null }],
      where: [cmp("id", "eq", "d1"), cmp("user_id", "eq", "u1")],
    }));
    expect(q.sql).toBe(`UPDATE "documents" SET "status" = ?, "feedback" = ? WHERE "id" = ? AND "user_id" = ? RETURNING "id"`);
    expect(q.params).toEqual(["approved", null, "d1", "u1"]);
  });

  it("deletes with filters and can return the deleted rows", () => {
    const q = ok(intent({
      table: "documents", action: "delete", returning: "representation", select: [{ column: "id" }],
      where: [cmp("id", "in", ["a", "b"])],
    }));
    expect(q.sql).toBe(`DELETE FROM "documents" WHERE "id" IN (SELECT value FROM json_each(?)) RETURNING "id"`);
  });

  it("refuses limit/offset on a mutation instead of widening it to every row", () => {
    // Dropping the clause is the dangerous option: `.delete().eq(…).limit(1)`
    // would silently delete every matching row. PostgREST refuses it too, and
    // SQLite can't express it without an ORDER BY + rowid subquery.
    expect(refused(intent({ table: "documents", action: "delete", limit: 1 })).code).toBe("PGRST109");
    expect(refused(intent({ table: "documents", action: "update", values: [{ status: "x" }], offset: 5 })).code).toBe("PGRST109");
    // A select is of course fine, and so is an unpaged mutation.
    expect(ok(intent({ table: "documents", limit: 1 })).sql).toMatch(/LIMIT \?$/);
    expect(ok(intent({ table: "documents", action: "delete" })).sql).toBe(`DELETE FROM "documents"`);
  });

  it("upserts on the given target, on the primary key by default, and DO NOTHING when duplicates are ignored", () => {
    const target = ok(intent({
      table: "organization_members", action: "upsert", onConflict: ["org_id", "sub_admin_email"],
      values: [{ org_id: U1, sub_admin_email: "a@x.com", role: "member" }],
    }));
    expect(target.sql).toBe(
      `INSERT INTO "organization_members" ("org_id", "sub_admin_email", "role") SELECT ${cell(0)}, ${cell(1)}, ${cell(2)} ${FROM_ROWS}`
      + ` ON CONFLICT ("org_id", "sub_admin_email") DO UPDATE SET`
      + ` "org_id" = excluded."org_id", "sub_admin_email" = excluded."sub_admin_email", "role" = excluded."role"`,
    );
    const pk = ok(intent({ table: "candidate_profiles", action: "upsert", values: [{ user_id: U1, phone: "+212600" }] }));
    expect(pk.sql).toMatch(/ON CONFLICT \("user_id"\) DO UPDATE SET "user_id" = excluded\."user_id", "phone" = excluded\."phone"$/);
    const ignore = ok(intent({
      table: "candidate_profiles", action: "upsert", ignoreDuplicates: true, values: [{ user_id: U1 }],
    }));
    expect(ignore.sql).toBe(`INSERT INTO "candidate_profiles" ("user_id") SELECT ${cell(0)} ${FROM_ROWS} ON CONFLICT ("user_id") DO NOTHING`);
  });
});

/* ──────────────────────────── behaviour ────────────────────────────── */

type Row = Record<string, unknown>;
type Stmt = { run(...a: unknown[]): unknown; get(...a: unknown[]): Row | undefined; all(...a: unknown[]): Row[] };
type Db = { exec(sql: string): void; prepare(sql: string): Stmt };
let DatabaseSync: (new (path: string) => Db) | null = null;
try { ({ DatabaseSync } = await import("node:sqlite") as unknown as { DatabaseSync: new (path: string) => Db }); }
catch { /* older Node without node:sqlite — the shape tests above still run */ }

describe.skipIf(!DatabaseSync)("runs against the real D1 schema", () => {
  let db: Db;
  const run = (i: QueryIntent) => { const q = ok(i); return db.prepare(q.sql).all(...(q.params as never[])); };
  const names = (rows: Row[]) => rows.map((r) => String(r.file_name));

  beforeAll(() => {
    db = new DatabaseSync!(":memory:");
    db.exec(fs.readFileSync("d1/schema.sql", "utf8"));
    const doc = db.prepare(
      `INSERT INTO documents (id, user_id, file_name, file_path, status, uploaded_at, file_type) VALUES (?,?,?,?,?,?,?)`,
    );
    doc.run("d1", "u1", "a_b.pdf", "p1", "pending", "2026-01-01T00:00:00.000000+00:00", "Passeport");
    doc.run("d2", "u1", "axb.pdf", "p2", null, "2026-02-01T00:00:00.000000+00:00", "Diplome");
    doc.run("d3", "u2", "C.pdf", "p3", "approved", null, "Passeport");
    db.prepare(`INSERT INTO candidate_profiles (user_id, cv_draft, passport_confirmed_fields) VALUES (?, ?, '{}')`)
      .run(U1, `{"langs":[{"name":"Arabe","level":"C2"}],"summary":"x"}`);
    const org = db.prepare(`INSERT INTO organizations (id, name, invite_code, vaccine_req, required_doc_keys) VALUES (?,?,?,?,?)`);
    org.run("o1", "Alpha", "AAA", "{}", `["passport","diploma"]`);
    org.run("o2", "Beta", "BBB", "{}", `["diploma"]`);
    org.run("o3", "Gamma", "CCC", "{}", null);
  });

  it("puts NULLs where Postgres puts them, not where SQLite would", () => {
    // DESC → nulls FIRST in Postgres. Raw SQLite would answer d2,d1,d3.
    expect(run(intent({ table: "documents", order: [{ column: "uploaded_at", ascending: false }] })).map((r) => r.id))
      .toEqual(["d3", "d2", "d1"]);
    // ASC → nulls LAST.
    expect(run(intent({ table: "documents", order: [{ column: "uploaded_at", ascending: true }] })).map((r) => r.id))
      .toEqual(["d1", "d2", "d3"]);
    // nullsFirst overrides the default.
    expect(run(intent({ table: "documents", order: [{ column: "uploaded_at", ascending: true, nullsFirst: true }] })).map((r) => r.id))
      .toEqual(["d3", "d1", "d2"]);
  });

  it("sorts text case-insensitively, like Supabase's collation", () => {
    // Byte order would file "C.pdf" (0x43) before both lowercase names.
    expect(names(run(intent({ table: "documents", order: [{ column: "file_name", ascending: true }] }))))
      .toEqual(["a_b.pdf", "axb.pdf", "C.pdf"]);
  });

  it("matches ilike case-insensitively while honouring ciEmail()'s escapes", () => {
    expect(names(run(intent({ table: "documents", where: [cmp("file_name", "ilike", "A%")] }))))
      .toEqual(["a_b.pdf", "axb.pdf"]);
    // `_` escaped by lib/admin-auth's ciEmail must be a literal, not a wildcard:
    // without ESCAPE '\' this would also return axb.pdf.
    expect(names(run(intent({ table: "documents", where: [cmp("file_name", "ilike", "a\\_b.pdf")] }))))
      .toEqual(["a_b.pdf"]);
    expect(names(run(intent({ table: "documents", where: [cmp("file_name", "ilike", "a_b.pdf")] }))))
      .toEqual(["a_b.pdf", "axb.pdf"]);
  });

  it("keeps `like` case-SENSITIVE (SQLite's LIKE is not)", () => {
    expect(names(run(intent({ table: "documents", where: [cmp("file_name", "like", "C%")] })))).toEqual(["C.pdf"]);
    expect(run(intent({ table: "documents", where: [cmp("file_name", "like", "c%")] }))).toEqual([]);
  });

  it("reproduces Postgres' empty-IN and negated-IN semantics", () => {
    expect(run(intent({ table: "documents", where: [cmp("id", "in", [])] }))).toEqual([]);
    expect(run(intent({ table: "documents", where: [cmp("id", "in", [], true)] })).length).toBe(3);
    expect(run(intent({ table: "documents", where: [cmp("id", "in", ["d1", "d3"])] })).map((r) => r.id)).toEqual(["d1", "d3"]);
    expect(run(intent({ table: "documents", where: [cmp("id", "in", ["d1", "d3"], true)] })).map((r) => r.id)).toEqual(["d2"]);
    // A list far past D1's 100-parameter ceiling still matches, and an INTEGER
    // column still compares as a number through json_each's untyped values.
    const many = ["zz", ...Array.from({ length: 300 }, (_, i) => `u${i}`), "d2"];
    expect(run(intent({ table: "documents", where: [cmp("id", "in", many)] })).map((r) => r.id)).toEqual(["d2"]);
    expect(run(intent({ table: "documents", where: [cmp("rotation", "in", [0, 90])] })).length).toBe(3);
    expect(run(intent({ table: "documents", where: [cmp("rotation", "in", [90, 180])] })).length).toBe(0);
    // NULL status stays out of a negated comparison, exactly as in Postgres.
    expect(run(intent({ table: "documents", where: [cmp("status", "neq", "pending")] })).map((r) => r.id)).toEqual(["d3"]);
    expect(run(intent({ table: "documents", where: [cmp("status", "eq", "approved", true)] })).map((r) => r.id)).toEqual(["d1"]);
  });

  it("tests null-ness and boolean-ness the way `is` does", () => {
    expect(run(intent({ table: "documents", where: [cmp("status", "is", null)] })).map((r) => r.id)).toEqual(["d2"]);
    expect(run(intent({ table: "documents", where: [cmp("status", "is", null, true)] })).map((r) => r.id)).toEqual(["d1", "d3"]);
    expect(run(intent({ table: "documents", where: [cmp("uploaded_by_admin", "is", false)] })).length).toBe(3);
    expect(run(intent({ table: "documents", where: [cmp("uploaded_by_admin", "is", true)] })).length).toBe(0);
  });

  it("evaluates a nested or=(…) group", () => {
    const rows = run(intent({
      table: "documents",
      where: [{ kind: "or", children: [cmp("status", "is", null), cmp("file_type", "eq", "Passeport")] }],
      order: [{ column: "id", ascending: true }],
    }));
    expect(rows.map((r) => r.id)).toEqual(["d1", "d2", "d3"]);
  });

  it("compares timestamps chronologically even when the filter came from a JS Date", () => {
    // Raw "…Z" would sort above every stored "+00:00" row and return nothing.
    const iso = new Date("2026-01-15T00:00:00.000Z").toISOString();
    expect(run(intent({ table: "documents", where: [cmp("uploaded_at", "gte", iso)] })).map((r) => r.id)).toEqual(["d2"]);
    expect(run(intent({ table: "documents", where: [cmp("uploaded_at", "lt", iso)] })).map((r) => r.id)).toEqual(["d1"]);
    // Exact equality still works on a value read back out of D1.
    expect(run(intent({ table: "documents", where: [cmp("uploaded_at", "eq", "2026-01-01T00:00:00.000000+00:00")] })).map((r) => r.id))
      .toEqual(["d1"]);
  });

  it("matches a Postgres-trimmed fraction against a padded JS one", () => {
    // Every imported row carries Postgres's own spelling, which never pads:
    // 150 ms is ".15+00:00". `new Date(…).toISOString()` always emits three
    // digits, and ".150+00:00" sorts ABOVE ".15+00:00" byte-wise — so without
    // the trim the boundary row drops out of its own `gte` and `.eq` never hits.
    const stamp = db.prepare(`INSERT INTO notifications (user_id, doc_name, doc_type, action, created_at) VALUES (?,?,?,?,?)`);
    stamp.run("tsprobe", "n", "t", "approved", "2026-03-01T00:00:00.15+00:00");
    stamp.run("tsprobe", "n", "t", "approved", "2026-02-01T00:00:00+00:00");
    const padded = new Date("2026-03-01T00:00:00.150Z").toISOString();
    expect(padded).toBe("2026-03-01T00:00:00.150Z");
    const mine = (extra: Where) => run(intent({
      table: "notifications", select: [{ column: "created_at" }],
      where: [cmp("user_id", "eq", "tsprobe"), extra],
    })).map((r) => r.created_at);
    expect(mine(cmp("created_at", "gte", padded))).toEqual(["2026-03-01T00:00:00.15+00:00"]);
    expect(mine(cmp("created_at", "eq", padded))).toEqual(["2026-03-01T00:00:00.15+00:00"]);
    // …and a whole second, where Postgres drops the fraction entirely.
    expect(mine(cmp("created_at", "eq", "2026-02-01T00:00:00.000Z"))).toEqual(["2026-02-01T00:00:00+00:00"]);
  });

  it("reads a json path into an alias", () => {
    const rows = run(intent({
      table: "candidate_profiles",
      select: [{ column: "user_id" }, { column: "cv_draft", alias: "cv_langs", jsonPath: "langs" }],
    }));
    expect(JSON.parse(String(rows[0].cv_langs))).toEqual([{ name: "Arabe", level: "C2" }]);
  });

  it("does array containment on a JSON-text array, NULL included", () => {
    // `.not("uploaded_keys","cs","{key}")` — app/api/portal/u/[token]/route.ts.
    const has = (v: unknown, negate = false) => run(intent({
      table: "organizations", where: [cmp("required_doc_keys", "cs", v, negate)],
      order: [{ column: "id", ascending: true }],
    })).map((r) => r.id);
    expect(has(["passport"])).toEqual(["o1"]);
    expect(has(["diploma"])).toEqual(["o1", "o2"]);
    expect(has("diploma")).toEqual(["o1", "o2"]);          // bare scalar = one-element array
    expect(has(["passport", "diploma"])).toEqual(["o1"]);  // @> needs ALL of them
    // o3's column is NULL: `NULL @> x` is NULL, so it is excluded from BOTH sides.
    expect(has(["passport"], true)).toEqual(["o2"]);
    // A NULL *element* must not swallow the answer: `'cv' NOT IN ('diploma',NULL)`
    // is NULL, which would make o4 look like it contained a key it does not.
    db.prepare(`INSERT INTO organizations (id, name, invite_code, vaccine_req, required_doc_keys) VALUES (?,?,?,?,?)`)
      .run("o4", "Delta", "EEE", "{}", `["diploma",null]`);
    expect(has(["cv"])).toEqual([]);
    expect(has(["diploma"])).toEqual(["o1", "o2", "o4"]);
  });

  it("runs the single-use upload-link claim: UPDATE … not.cs … RETURNING", () => {
    // app/api/portal/u/[token]/route.ts:166 — the legacy whole-array claim. The
    // `not.cs` guard is what makes two concurrent POSTs for the same doc key
    // idempotent: the loser updates 0 rows and answers alreadyUploaded. It runs
    // inside an UPDATE's WHERE, where the containment CASE is correlated with
    // the row being written, so it is worth executing and not just shaping.
    db.prepare(`INSERT INTO upload_links (id, token_hash, candidate_user_id, doc_keys, uploaded_keys) VALUES (?,?,?,?,?)`)
      .run("L1", "h", "u1", `["passport","diploma"]`, `["diploma"]`);
    const claim = (key: string) => {
      const q = ok(intent({
        table: "upload_links", action: "update", returning: "representation", select: [{ column: "id" }],
        values: [{ uploaded_keys: ["diploma", key] }],
        where: [
          cmp("id", "eq", "L1"), cmp("used_at", "is", null), cmp("revoked_at", "is", null),
          cmp("uploaded_keys", "cs", [key], true),
        ],
      }));
      return db.prepare(q.sql).all(...(q.params as never[]));
    };
    expect(claim("passport").map((r) => r.id)).toEqual(["L1"]);   // first POST wins
    expect(claim("passport")).toEqual([]);                        // the retry is a no-op
    expect(db.prepare(`SELECT uploaded_keys FROM upload_links WHERE id='L1'`).get()!.uploaded_keys)
      .toBe(`["diploma","passport"]`);                            // written as JSON text, not [object Object]
  });

  it("counts every matching row for head+count, ignoring the page", () => {
    const q = ok(intent({ table: "documents", head: true, count: "exact", limit: 1, where: [cmp("user_id", "eq", "u1")] }));
    expect(db.prepare(q.sql).get(...(q.params as never[]))!.count).toBe(2);
  });

  it("pages with limit/offset", () => {
    const page = (limit: number, offset?: number) => run(intent({
      table: "documents", limit, offset, order: [{ column: "id", ascending: true }],
    })).map((r) => r.id);
    expect(page(2)).toEqual(["d1", "d2"]);
    expect(page(2, 1)).toEqual(["d2", "d3"]);
    expect(page(10, 2)).toEqual(["d3"]);
  });

  it("inserts, updates, deletes and hands back the rows RETURNING was asked for", () => {
    const ins = ok(intent({
      table: "notifications", action: "insert", returning: "representation", select: [{ column: "id" }, { column: "read" }],
      values: [{ user_id: U2, doc_name: "n", doc_type: "t", action: "approved", read: false }],
    }));
    const created = db.prepare(ins.sql).all(...(ins.params as never[]));
    expect(created).toHaveLength(1);
    expect(created[0].read).toBe(0);                       // booleans stored as 0/1
    const id = String(created[0].id);

    const upd = ok(intent({
      table: "notifications", action: "update", returning: "representation", select: [{ column: "read" }],
      values: [{ read: true }], where: [cmp("id", "eq", id)],
    }));
    expect(db.prepare(upd.sql).all(...(upd.params as never[]))[0].read).toBe(1);

    const del = ok(intent({
      table: "notifications", action: "delete", returning: "representation", select: [{ column: "id" }],
      where: [cmp("id", "eq", id)],
    }));
    expect(db.prepare(del.sql).all(...(del.params as never[])).map((r) => r.id)).toEqual([id]);
  });

  it("writes jsonb / text[] / boolean payloads in the stored encoding", () => {
    const ins = ok(intent({
      table: "organizations", action: "insert", returning: "representation", select: [],
      values: [{ id: U2, name: "Delta", invite_code: "DDD", vaccine_req: { hep_b: true }, required_doc_keys: ["cv"] }],
    }));
    const row = db.prepare(ins.sql).all(...(ins.params as never[]))[0];
    expect(row.vaccine_req).toBe(`{"hep_b":true}`);        // json_valid CHECK would have rejected anything else
    expect(row.required_doc_keys).toBe(`["cv"]`);
    // …and the containment filter finds what the insert wrote.
    expect(run(intent({ table: "organizations", where: [cmp("required_doc_keys", "cs", ["cv"])] })).map((r) => r.id)).toEqual([U2]);
  });

  it("upserts: inserts once, then updates in place — unless duplicates are ignored", () => {
    const up = (notes: string, ignoreDuplicates = false) => {
      const q = ok(intent({
        table: "candidate_status", action: "upsert", ignoreDuplicates,
        values: [{ user_id: U2, b2_notes: notes }],
      }));
      db.prepare(q.sql).run(...(q.params as never[]));
      return db.prepare(`SELECT b2_notes FROM candidate_status WHERE user_id = ?`).get(U2)!.b2_notes;
    };
    expect(up("first")).toBe("first");
    expect(up("second")).toBe("second");          // DO UPDATE
    expect(up("third", true)).toBe("second");     // DO NOTHING
  });

  it("binds every ON CONFLICT target the codebase actually upserts on", () => {
    // Each pair is a real `.upsert(…, { onConflict })` site. SQLite refuses a
    // target with no matching PK/unique index — the same way Postgres does — so
    // preparing them all is a live parity check on d1/schema.sql's indexes.
    const pairs = [
      "academy_attendance|session_id,candidate_user_id",
      "academy_cohort_members|cohort_id,candidate_user_id",
      "academy_point_events|candidate_user_id,type,source_kind,source_id",
      "academy_settings|id",
      "academy_tab_access|user_id",
      "admin_signatures|admin_email",
      "agency_profiles|user_id",
      "assistant_chat_summary|owner_user_id",
      "assistant_commitments|owner_user_id,source_message_id,what",
      "automation_settings|key",
      "booking_availability|id",
      "candidate_journey_items|candidate_user_id,preset_key",
      "candidate_organizations|candidate_user_id,org_id",
      "candidate_profiles|user_id",
      "candidate_status|user_id",
      "classroom_consent|user_id",
      "classroom_invites|session_id,user_id",
      "community_seen|user_id",
      "organization_members|org_id,sub_admin_email",
      "partner_shares|org_id,candidate_user_id",
      "pdf_field_mappings|signature",
      "phase_doc_order|phase",
      "shortlist_candidates|shortlist_id,candidate_user_id",
      "sub_admin_assignments|sub_admin_email,candidate_user_id",
      "sub_admins|email",
    ];
    // A value each column's input function accepts.
    const sample: Record<string, unknown> = {
      uuid: U1, integer: 1, bigint: 1, numeric: 1, boolean: true, date: "2026-01-01",
      timestamptz: "2026-01-01T00:00:00Z", jsonb: {}, "text[]": [], "uuid[]": [],
    };
    const failures: string[] = [];
    for (const pair of pairs) {
      const [table, target] = pair.split("|");
      const cols = target.split(",");
      const q = ok(intent({
        table, action: "upsert", onConflict: cols,
        values: [Object.fromEntries(cols.map((c) => [c, sample[registry[table].columns[c].pg] ?? "x"]))],
      }));
      try { db.prepare(q.sql); } catch { failures.push(pair); }
    }
    // KNOWN GAP #1 (reported, not this module's to fix): supabase/
    // fix_notification_kinds_and_commitments.sql adds a plain unique index on
    // (owner_user_id, source_message_id, what), but d1/schema.sql only carries
    // the older expression index over coalesce(source_message_id,'') — which no
    // ON CONFLICT target can match. When the schema gains it, this list goes empty
    // and the expectation below should be changed to [].
    expect(failures).toEqual(["assistant_commitments|owner_user_id,source_message_id,what"]);
  });

  it("KNOWN GAP #2: NOT NULL jsonb/array columns lost their Postgres DEFAULT", () => {
    // PostgREST's OpenAPI snapshot omits `default` for jsonb/array columns, so
    // d1/gen-schema.mjs emitted 20 NOT NULL columns with no DEFAULT that DO have
    // one live — supabase/passport_confirmed_fields.sql (`NOT NULL DEFAULT '[]'`),
    // supabase/org_vaccine_req.sql, supabase/upload_links.sql, supabase/
    // phase_doc_order.sql, supabase/booking_maxx.sql …
    //
    // It bites hardest on upsert: SQLite checks NOT NULL BEFORE resolving ON
    // CONFLICT, while Postgres constrains the FINAL tuple. So the commonest
    // upsert in the codebase (candidate_profiles on user_id, 27 call sites)
    // fails on D1 even though U1 already exists and the payload never touches
    // the column. The SQL below is exactly what Supabase accepts today.
    // When the generator restores those defaults this test flips to `.run()`
    // succeeding — change it then, and delete the exception.
    const q = ok(intent({ table: "candidate_profiles", action: "upsert", values: [{ user_id: U1, phone: "+212600000000" }] }));
    expect(() => db.prepare(q.sql).run(...(q.params as never[])))
      .toThrow(/NOT NULL constraint failed: candidate_profiles\.passport_confirmed_fields/);
  });
});
