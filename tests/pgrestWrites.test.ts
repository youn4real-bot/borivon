import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import { buildSql, columnDefaultSql, fitParams, isPostgrestError, UPDATE_STAMPS } from "../lib/d1/pgrest/buildSql";
import { parseParts } from "../lib/d1/pgrest/parseRequest";
import type { BuiltQuery, Condition, QueryIntent, Registry, Where } from "../lib/d1/pgrest/types";

/**
 * Writes the way PostgREST writes them (lib/d1/pgrest/buildSql.ts buildInsert /
 * buildUpdate), plus the two D1 ceilings every statement lives under.
 *
 * PostgREST hands a write body to Postgres as ONE json parameter and lets
 * json_to_recordset() build the rows, so on Supabase:
 *  - a bulk insert of 52 rows is one statement with one parameter;
 *  - every value goes through its column's input function (22P02 / 22007 / …);
 *  - `columns=` lets rows differ in keys (missing → NULL, or the default under
 *    `Prefer: missing=default`);
 *  - an upsert whose own rows share a conflict key is 21000;
 *  - a BEFORE UPDATE trigger's now() is already in the row RETURNING hands back.
 * Shape tests pin the SQL; behaviour tests run it against the real d1/schema.sql
 * in a real SQLite. The live D1 side is tests/d1WriteCodecParity.test.ts.
 */

const registry: Registry = JSON.parse(fs.readFileSync("d1/types.json", "utf8"));
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const WEEK = 7 * 864e5;

const intent = (over: Partial<QueryIntent> & Pick<QueryIntent, "table">): QueryIntent => ({
  action: "select", select: "*", where: [], order: [], returning: "minimal", ...over,
});
const cmp = (column: string, op: Condition["op"], value: unknown): Condition => ({ kind: "cmp", column, op, value });

function ok(i: QueryIntent): BuiltQuery {
  const r = buildSql(i, registry);
  if (isPostgrestError(r)) throw new Error(`unexpected PostgREST error ${r.code}: ${r.message}`);
  return r;
}
function refused(i: QueryIntent) {
  const r = buildSql(i, registry);
  if (!isPostgrestError(r)) throw new Error(`expected a PostgREST error, got SQL: ${r.sql}`);
  return r;
}

/** The recurring-event rows app/api/portal/calendar/route.ts builds, `n` weeks long. */
const calendarRows = (n: number) => {
  const base = { title: "Deutschkurs", description: "", image_url: "", link_url: "", location: "", vip_only: false, attendee_ids: [U1.toUpperCase()], created_by: U2 };
  return Array.from({ length: n }, (_, i) => ({ ...base, starts_at: new Date(Date.UTC(2031, 0, 6, 9) + i * WEEK).toISOString(), ends_at: null }));
};

/* ────────────────────────────── shape ──────────────────────────────── */

describe("a bulk write is one statement with one parameter", () => {
  it("unpacks the rows from a single JSON array, in order", () => {
    const q = ok(intent({ table: "documents", action: "insert", values: [{ user_id: U1, file_name: "a.pdf" }, { user_id: U2, file_name: "b.pdf" }] }));
    expect(q.sql).toBe(
      `INSERT INTO "documents" ("user_id", "file_name") SELECT json_extract("row$"."value", '$[0]'), json_extract("row$"."value", '$[1]')`
      + ` FROM json_each(?) AS "row$" WHERE true ORDER BY "row$"."key"`,
    );
    expect(q.params).toEqual([JSON.stringify([[U1, "a.pdf"], [U2, "b.pdf"]])]);
  });

  it("binds ONE parameter for every call-site size D1 used to refuse", () => {
    // D1 allows 100 bound parameters. Each of these was rows × columns past it.
    const notify = (n: number) => Array.from({ length: n }, (_, i) => ({ user_id: uuid(i), doc_id: U1, doc_name: "Kurs", doc_type: "event_invite", action: "event_invite", feedback: null, read: false }));
    const leads = (n: number) => Array.from({ length: n }, (_, i) => ({ kind: "person", name: `N${i}`, email: "", phone: "", message: "", details: {} }));
    const members = (n: number) => Array.from({ length: n }, (_, i) => ({ cohort_id: U1, candidate_user_id: uuid(i), current_level: "A1", status: "active" }));
    const cases: QueryIntent[] = [
      intent({ table: "calendar_events", action: "insert", values: calendarRows(52), returning: "representation", select: ["id", "title", "description", "starts_at", "ends_at", "location", "link_url", "attendee_ids"].map((column) => ({ column })) }),
      intent({ table: "notifications", action: "insert", values: notify(500) }),
      intent({ table: "leads", action: "insert", values: leads(50), returning: "representation", select: [{ column: "id" }] }),
      intent({ table: "academy_cohort_members", action: "upsert", onConflict: ["cohort_id", "candidate_user_id"], values: members(200) }),
    ];
    for (const c of cases) expect(ok(c).params, c.table).toHaveLength(1);
  });

  it("keeps the upsert clause after `WHERE true`, and stamps employers' updated_at", () => {
    const up = ok(intent({ table: "candidate_status", action: "upsert", values: [{ user_id: U1, b2_notes: "x" }] }));
    expect(up.sql).toMatch(/ WHERE true ORDER BY "row\$"\."key" ON CONFLICT \("user_id"\) DO UPDATE SET "user_id" = excluded\."user_id", "b2_notes" = excluded\."b2_notes"$/);
    const emp = ok(intent({ table: "employers", action: "update", values: [{ name: "UKSH", updated_at: "2020-01-01T00:00:00Z" }], where: [cmp("id", "eq", U1)] }));
    expect(emp.sql).toBe(`UPDATE "employers" SET "name" = ?, "updated_at" = (strftime('%Y-%m-%dT%H:%M:%f','now') || '000+00:00') WHERE "id" = ?`);
    expect(emp.params).toEqual(["UKSH", U1]);
  });
});

describe("every written value goes through its column's input function", () => {
  it("refuses what Postgres refuses, with Supabase's body, on insert and update alike", () => {
    // The passport OCR persist (app/api/portal/upload/route.ts) writes German dates.
    expect(refused(intent({ table: "candidate_profiles", action: "upsert", values: [{ user_id: U1, dob: "29.05.2004" }] })))
      .toEqual({ code: "22008", message: 'date/time field value out of range: "29.05.2004"', details: null, hint: 'Perhaps you need a different "datestyle" setting.', status: 400 });
    expect(refused(intent({ table: "assistant_reminders", action: "update", values: [{ remind_count: 2.5 }] })))
      .toMatchObject({ code: "22P02", message: 'invalid input syntax for type integer: "2.5"' });
    expect(refused(intent({ table: "assistant_reminders", action: "insert", values: [{ owner_user_id: "abc", text: "t" }] })))
      .toMatchObject({ code: "22P02", message: 'invalid input syntax for type uuid: "abc"' });
    expect(refused(intent({ table: "calendar_events", action: "insert", values: [{ ...calendarRows(1)[0], attendee_ids: ["not-a-uuid"] }] })).code).toBe("22P02");
  });

  it("reads a row's columns in sorted order, so the first bad column by name is the one reported", () => {
    const e = refused(intent({ table: "assistant_reminders", action: "insert", values: [{ remind_count: "x", due_date: "y", owner_user_id: U1, text: "t" }] }));
    expect(e.message).toBe('invalid input syntax for type date: "y"');
  });

  it("stores the canonical spelling Postgres stores", () => {
    const q = ok(intent({
      table: "assistant_reminders", action: "insert",
      values: [{ owner_user_id: U1.toUpperCase(), text: 5, due_date: "2026-9-4", due_at: "2026-03-04", done: "yes", remind_count: "7" }],
    }));
    expect(JSON.parse(String(q.params[0]))).toEqual([[U1, "5", "2026-09-04", "2026-03-04T00:00:00+00:00", 1, 7]]);
  });

  it("stores a jsonb object with its keys in jsonb's order, as the imported rows are", () => {
    const q = ok(intent({ table: "leads", action: "insert", values: [{ kind: "person", name: "N", details: { positions: ["x"], sector: "Pflege", city: "Kiel" } }] }));
    expect(JSON.parse(String(q.params[0]))).toEqual([["person", "N", '{"city":"Kiel","sector":"Pflege","positions":["x"]}']]);
  });
});

describe("an upsert may not reach one row twice", () => {
  const member = { cohort_id: U1, candidate_user_id: U2, current_level: "A1", status: "active" };
  const target = ["cohort_id", "candidate_user_id"];

  it("answers 21000 with Postgres' message and hint when the payload repeats a conflict key", () => {
    expect(refused(intent({ table: "academy_cohort_members", action: "upsert", onConflict: target, values: [member, { ...member, current_level: "B1" }] }))).toEqual({
      code: "21000",
      message: "ON CONFLICT DO UPDATE command cannot affect row a second time",
      details: null,
      hint: "Ensure that no rows proposed for insertion within the same command have duplicate constrained values.",
      status: 500,
    });
    // The same key in another spelling is the same key.
    expect(refused(intent({ table: "academy_cohort_members", action: "upsert", onConflict: target, values: [member, { ...member, candidate_user_id: U2.toUpperCase() }] })).code).toBe("21000");
  });

  it("lets through what Postgres lets through: DO NOTHING, distinct keys, NULL keys, a key the payload does not carry", () => {
    ok(intent({ table: "academy_cohort_members", action: "upsert", onConflict: target, ignoreDuplicates: true, values: [member, member] }));
    ok(intent({ table: "academy_cohort_members", action: "upsert", onConflict: target, values: [member, { ...member, candidate_user_id: U1 }] }));
    const ev = { candidate_user_id: U1, type: "attendance", source_kind: "session", source_id: null, points: 1 };
    ok(intent({ table: "academy_point_events", action: "upsert", onConflict: ["candidate_user_id", "type", "source_kind", "source_id"], values: [ev, ev] }));
    ok(intent({ table: "candidate_reminders", action: "upsert", values: [{ user_id: U1, items: [] }, { user_id: U1, items: [] }] }));
    // A plain insert of a duplicate is the database's 23505, not a builder error.
    ok(intent({ table: "academy_cohort_members", action: "insert", values: [member, member] }));
  });

  it("reads every row before looking for a collision, as Postgres' function scan does", () => {
    const e = refused(intent({ table: "academy_cohort_members", action: "upsert", onConflict: target, values: [member, member, { ...member, candidate_user_id: "not-a-uuid" }] }));
    expect(e).toMatchObject({ code: "22P02", message: 'invalid input syntax for type uuid: "not-a-uuid"' });
  });

  it("counts a conflict column the rows leave to its default", () => {
    const rows = [{ user_id: U1, items: [] }, { user_id: U1, items: [] }];
    // candidate_reminders.kind defaults to 'documents', so both rows propose (U1, documents).
    expect(refused(intent({ table: "candidate_reminders", action: "upsert", onConflict: ["user_id", "kind"], values: rows })).code).toBe("21000");
    expect(refused(intent({ table: "candidate_reminders", action: "upsert", onConflict: ["user_id", "kind"], columns: ["user_id", "kind", "items"], missingDefault: true, values: [rows[0], { ...rows[1], kind: "documents" }] })).code).toBe("21000");
    // gen_random_uuid() is new for every row, and a key a row lacks without missing=default is NULL: neither collides.
    ok(intent({ table: "candidate_reminders", action: "upsert", onConflict: ["id", "user_id"], values: rows }));
    ok(intent({ table: "candidate_reminders", action: "upsert", onConflict: ["user_id", "kind"], columns: ["user_id", "kind", "items"], values: rows }));
  });
});

describe("`columns=` and Prefer: missing=default", () => {
  const url = "/rest/v1/candidate_reminders?columns=%22user_id%22%2C%22kind%22%2C%22items%22&select=id%2Ckind";

  it("reads the request supabase-js sends for rows whose keys differ", () => {
    const parsed = parseParts({
      method: "POST", url, headers: { Prefer: "missing=default, return=representation" },
      body: [{ user_id: U1, kind: "k", items: [], not_a_column: 1 }, { user_id: U1, items: [] }],
    }, registry);
    if ("code" in parsed && "status" in parsed) throw new Error(JSON.stringify(parsed));
    expect(parsed.columns).toEqual(["user_id", "kind", "items"]);
    expect(parsed.missingDefault).toBe(true);
    // A body key outside `columns` is ignored, not refused; a listed column the table lacks is PGRST204.
    const missing = parseParts({ method: "POST", url: "/rest/v1/candidate_reminders?columns=%22user_id%22%2C%22nope%22", headers: {}, body: [{ user_id: U1 }] }, registry);
    expect(missing).toMatchObject({ code: "PGRST204", message: "Could not find the 'nope' column of 'candidate_reminders' in the schema cache" });
    expect(parseParts({ method: "POST", url: "/rest/v1/candidate_reminders?columns=user_id%2C%2C", headers: {}, body: [{}] }, registry)).toMatchObject({ code: "PGRST100" });
  });

  it("writes NULL for a missing key, or the column default under missing=default", () => {
    const rows = [{ user_id: U1, kind: "k", items: [] }, { user_id: U1, items: [] }];
    const plain = ok(intent({ table: "candidate_reminders", action: "insert", columns: ["user_id", "kind", "items"], values: rows }));
    expect(JSON.parse(String(plain.params[0]))).toEqual([[U1, "k", "[]"], [U1, null, "[]"]]);
    const defaults = ok(intent({ table: "candidate_reminders", action: "insert", columns: ["user_id", "kind", "items"], missingDefault: true, values: rows }));
    expect(defaults.sql).toContain(`CASE WHEN json_type("row$"."value", '$[1]') = 'object' THEN 'documents' ELSE json_extract("row$"."value", '$[1]') END`);
    expect(JSON.parse(String(defaults.params[0]))).toEqual([[U1, "k", "[]"], [U1, {}, "[]"]]);
  });
});

describe("D1's expression-depth and parameter ceilings", () => {
  const manyOr = (n: number): Where => ({ kind: "or", children: Array.from({ length: n }, (_, i) => cmp("file_type", "eq", `t${i}`)) });

  it("halves a long AND/OR chain and packs more than 100 operands into one parameter", () => {
    const q = ok(intent({ table: "documents", select: [{ column: "id" }], where: [manyOr(500)] }));
    expect(q.params).toHaveLength(1);
    expect(JSON.parse(String(q.params[0]))).toHaveLength(500);
    // No flat stretch of the chain is longer than eight terms.
    for (const stretch of q.sql.split(/[()]/)) expect(stretch.split(" OR ").length).toBeLessThanOrEqual(8);
    // A short chain keeps the SQL it always had.
    expect(ok(intent({ table: "documents", where: [manyOr(3)] })).sql).toBe(`SELECT * FROM "documents" WHERE ("file_type" = ? OR "file_type" = ? OR "file_type" = ?)`);
  });

  it("fitParams leaves a statement within the limit alone and never rewrites a quoted `?`", () => {
    const small = { sql: `SELECT ? AS "a?"`, params: [1] };
    expect(fitParams(small)).toBe(small);
    const params = Array.from({ length: 101 }, (_, i) => i);
    const sql = `SELECT '?' AS "b?", ${params.map(() => "?").join(" + ")}`;
    const packed = fitParams({ sql, params });
    expect(packed.params).toEqual([JSON.stringify(params)]);
    expect(packed.sql.startsWith(`SELECT '?' AS "b?", json_extract(?1, '$[0]') + json_extract(?1, '$[1]')`)).toBe(true);
    // A placeholder count that does not match the params is left for D1 to refuse, not guessed at.
    const odd = { sql: "SELECT ?", params };
    expect(fitParams(odd)).toBe(odd);
  });
});

describe("the SQL the writes borrow from d1/schema.sql", () => {
  const schema = fs.readFileSync("d1/schema.sql", "utf8");

  it("translates every column default exactly as the schema declares it", () => {
    const declared = new Map<string, string | undefined>();
    for (const block of schema.split(/CREATE TABLE IF NOT EXISTS /).slice(1)) {
      const table = /^"([^"]+)"/.exec(block)![1];
      for (const line of block.split("\n").slice(1)) {
        const m = /^\s+"([^"]+)" (?:TEXT|INTEGER|REAL)( NOT NULL)?(?: DEFAULT (.*?))?(?: CHECK \(.*| GENERATED .*)?,?$/.exec(line);
        if (m) declared.set(`${table}.${m[1]}`, m[3]);
      }
    }
    let compared = 0;
    for (const [table, meta] of Object.entries(registry)) {
      for (const [column, col] of Object.entries(meta.columns)) {
        const key = `${table}.${column}`;
        if (!declared.has(key)) continue;
        const sql = columnDefaultSql(col);
        if (sql === null) expect(declared.get(key), key).toBeUndefined();
        else expect(sql, key).toBe(declared.get(key) ?? "NULL");
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(700);
  });

  it("lists every AFTER UPDATE stamp trigger the schema ports from a BEFORE trigger", () => {
    const found: Record<string, string> = {};
    const re = /CREATE TRIGGER IF NOT EXISTS "[^"]+" AFTER UPDATE ON "([^"]+)" FOR EACH ROW WHEN NEW\."([^"]+)" IS OLD\."\2"\s*BEGIN UPDATE "\1" SET "\2" = (.+?) WHERE/g;
    for (const m of schema.matchAll(re)) {
      found[m[1]] = m[2];
      expect(m[3]).toBe(columnDefaultSql({ pg: "timestamptz", nullable: false, default: "now()", generated: false }));
    }
    expect(found).toEqual(UPDATE_STAMPS);
  });
});

/* ──────────────────────────── behaviour ────────────────────────────── */

type Row = Record<string, unknown>;
type Stmt = { run(...a: unknown[]): { changes: number | bigint }; get(...a: unknown[]): Row | undefined; all(...a: unknown[]): Row[] };
type Db = { exec(sql: string): void; prepare(sql: string): Stmt };
let DatabaseSync: (new (path: string) => Db) | null = null;
try { ({ DatabaseSync } = await import("node:sqlite") as unknown as { DatabaseSync: new (path: string) => Db }); }
catch { /* older Node without node:sqlite — the shape tests above still run */ }

describe.skipIf(!DatabaseSync)("writes run against the real D1 schema", () => {
  let db: Db;
  const all = (i: QueryIntent) => { const q = ok(i); return db.prepare(q.sql).all(...(q.params as never[])); };
  const run = (i: QueryIntent) => { const q = ok(i); return Number(db.prepare(q.sql).run(...(q.params as never[])).changes); };

  beforeAll(() => {
    db = new DatabaseSync!(":memory:");
    db.exec(fs.readFileSync("d1/schema.sql", "utf8"));
  });

  it("inserts a 52-week recurring event and hands the rows back in the order they were sent", () => {
    const rows = calendarRows(52);
    const out = all(intent({ table: "calendar_events", action: "insert", returning: "representation", select: [{ column: "starts_at" }, { column: "attendee_ids" }, { column: "vip_only" }, { column: "ends_at" }], values: rows }));
    expect(out.map((r) => r.starts_at)).toEqual(rows.map((r) => r.starts_at.replace(".000Z", "+00:00")));
    expect(out[0]).toEqual({ starts_at: "2031-01-06T09:00:00+00:00", attendee_ids: JSON.stringify([U1]), vip_only: 0, ends_at: null });
  });

  it("merges, ignores and inserts 200 cohort members in one upsert", () => {
    const members = (from: number, n: number, level: string) =>
      Array.from({ length: n }, (_, i) => ({ cohort_id: U1, candidate_user_id: uuid(from + i), current_level: level, status: "active" }));
    const base = { table: "academy_cohort_members", action: "upsert" as const, onConflict: ["cohort_id", "candidate_user_id"] };
    expect(run(intent({ ...base, values: members(0, 200, "A1") }))).toBe(200);
    const merged = all(intent({ ...base, returning: "representation", select: [{ column: "candidate_user_id" }, { column: "current_level" }], values: members(198, 3, "B1") }));
    expect(merged).toEqual([198, 199, 200].map((n) => ({ candidate_user_id: uuid(n), current_level: "B1" })));
    const ignored = all(intent({ ...base, ignoreDuplicates: true, returning: "representation", select: [{ column: "candidate_user_id" }], values: members(200, 2, "C1") }));
    expect(ignored).toEqual([{ candidate_user_id: uuid(201) }]);            // DO NOTHING returns only what it inserted
    expect(db.prepare(`SELECT count(*) AS n FROM academy_cohort_members`).get()!.n).toBe(202);
  });

  it("stores text the way Postgres stores it — never `5.0` or `1.0`", () => {
    const out = all(intent({ table: "assistant_reminders", action: "insert", returning: "representation", select: [{ column: "text" }], values: [{ owner_user_id: U1, text: 5 }, { owner_user_id: U1, text: true }] }));
    expect(out.map((r) => r.text)).toEqual(["5", "true"]);
  });

  it("stores jsonb in the key order json_each, and so every reader, walks it", () => {
    const out = all(intent({ table: "leads", action: "insert", returning: "representation", select: [{ column: "details" }], values: [{ kind: "person", name: "N", email: "", phone: "", message: "", details: { positions: 2, sector: "s", city: "c" } }] }));
    expect(out).toEqual([{ details: '{"city":"c","sector":"s","positions":2}' }]);
  });

  it("fills a missing key with the column default under missing=default, and with NULL otherwise", () => {
    const rows = [{ user_id: U1, kind: "k", items: [] }, { user_id: U1, items: [] }];
    const out = all(intent({ table: "candidate_reminders", action: "insert", columns: ["user_id", "kind", "items"], missingDefault: true, returning: "representation", select: [{ column: "kind" }, { column: "sent_at" }, { column: "id" }], values: rows }));
    expect(out.map((r) => r.kind)).toEqual(["k", "documents"]);
    expect(String(out[1].sent_at)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}\+00:00$/);
    const q = ok(intent({ table: "candidate_reminders", action: "insert", columns: ["user_id", "kind", "items"], values: rows }));
    expect(() => db.prepare(q.sql).run(...(q.params as never[]))).toThrow(/NOT NULL constraint failed: candidate_reminders\.kind/);
  });

  it("returns employers' new updated_at from the UPDATE itself, and counts one row", () => {
    db.prepare(`INSERT INTO employers (id, name, address_lines, updated_at) VALUES (?, 'UKSH', '[]', '2020-01-01T00:00:00+00:00')`).run(U1);
    const out = all(intent({ table: "employers", action: "update", returning: "representation", select: [{ column: "updated_at" }], values: [{ name: "UKSH Kiel" }], where: [cmp("id", "eq", U1)] }));
    const stored = db.prepare(`SELECT updated_at FROM employers WHERE id = ?`).get(U1)!.updated_at;
    expect(out).toEqual([{ updated_at: stored }]);
    expect(stored).not.toBe("2020-01-01T00:00:00+00:00");
    // The trigger no longer fires a second UPDATE, and a caller's own value loses to now(), as in Postgres.
    db.prepare(`UPDATE employers SET updated_at = '2020-01-01T00:00:00+00:00' WHERE id = ?`).run(U1);
    expect(run(intent({ table: "employers", action: "update", values: [{ notes: "x", updated_at: "1999-01-01T00:00:00Z" }], where: [cmp("id", "eq", U1)] }))).toBe(1);
    expect(db.prepare(`SELECT updated_at FROM employers WHERE id = ?`).get(U1)!.updated_at).not.toMatch(/^(2020|1999)/);
  });

  it("answers an or=(…) of 500 conditions, packed into one parameter", () => {
    db.prepare(`INSERT INTO documents (id, user_id, file_name, file_path, rotation, uploaded_by_admin, file_type) VALUES (?, ?, 'a.pdf', 'p', 0, 0, 't499')`).run(U2, U1);
    const where: Where = { kind: "or", children: Array.from({ length: 500 }, (_, i) => cmp("file_type", "eq", `t${i}`)) };
    expect(all(intent({ table: "documents", select: [{ column: "id" }], where: [where, cmp("user_id", "eq", U1)] }))).toEqual([{ id: U2 }]);
  });
});
