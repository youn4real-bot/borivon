import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import { buildSchema, pgExprToSqlite } from "../d1/gen-schema.mjs";

/**
 * The generated D1 schema must load into a real SQLite and behave like the
 * Postgres original: same tables, defaults filled in the same format, the
 * same CHECK rules refusing the same bad values, and every index created.
 * (Step 2 of the migration — built and tested without touching anything live.)
 */
type Db = { exec(sql: string): void; prepare(sql: string): { run(...a: unknown[]): unknown; get(...a: unknown[]): Record<string, unknown> | undefined; all(...a: unknown[]): Record<string, unknown>[] } };
let DatabaseSync: (new (path: string) => Db) | null = null;
try { ({ DatabaseSync } = await import("node:sqlite") as unknown as { DatabaseSync: new (path: string) => Db }); } catch { /* older Node: skip */ }

const api = JSON.parse(fs.readFileSync("d1/snapshot/openapi.json", "utf8"));
const cat = JSON.parse(fs.readFileSync("d1/snapshot/catalog.json", "utf8"));
const built = buildSchema(api, cat) as { sql: string; types: Record<string, unknown>; warnings: string[] };

describe("pgExprToSqlite", () => {
  it("turns Postgres CHECK syntax into SQLite", () => {
    expect(pgExprToSqlite("((status = ANY (ARRAY['a'::text, 'b'::text])))")).toBe("((status IN ('a', 'b')))");
    expect(pgExprToSqlite("((char_length(title) <= 100))")).toBe("((length(title) <= 100))");
    expect(pgExprToSqlite("((id = true))")).toBe("((id = 1))");
    expect(pgExprToSqlite("(starts_at, COALESCE(host_id, (0)::bigint)) WHERE (status <> 'cancelled'::text)"))
      .toBe("(starts_at, COALESCE(host_id, (0))) WHERE (status <> 'cancelled')");
  });
});

describe.skipIf(!DatabaseSync)("generated D1 schema in a real SQLite", () => {
  let db: Db;
  beforeAll(() => {
    db = new DatabaseSync!(":memory:");
    db.exec(built.sql);
  });

  it("creates every live table, with no untranslated leftovers", () => {
    const n = db.prepare("select count(*) n from sqlite_master where type='table' and name not like 'sqlite_%'").get()!.n;
    expect(n).toBe(Object.keys(api.definitions).length);
    expect(built.warnings).toEqual([]);
  });

  it("creates every non-primary-key index", () => {
    const want = (cat.indexes as [string, string][]).filter(([, d]) => !/_pkey ON/.test(d)).length;
    const got = db.prepare("select count(*) n from sqlite_master where type='index' and name not like 'sqlite_%'").get()!.n;
    expect(got).toBe(want);
  });

  it("fills uuid + timestamp defaults in the Postgres/PostgREST format", () => {
    db.prepare(`insert into documents (user_id, file_name, file_path, rotation, uploaded_by_admin) values (?, 'a.pdf', 'p', 0, 0)`)
      .run("11111111-1111-4111-8111-111111111111");
    const row = db.prepare("select id, uploaded_at, file_type from documents").get()!;
    expect(String(row.id)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(String(row.uploaded_at)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}\+00:00$/);
    expect(row.file_type).toBe("Autre");
  });

  it("refuses the same bad values the live CHECKs refuse", () => {
    expect(() => db.prepare(
      `insert into notifications (user_id, doc_id, doc_name, doc_type, action) values ('u', 'd', 'n', 't', 'hacked')`,
    ).run()).toThrow();
    expect(() => db.prepare(
      `insert into notifications (user_id, doc_id, doc_name, doc_type, action) values ('u', 'd', 'n', 't', 'approved')`,
    ).run()).not.toThrow();
  });

  it("keeps booleans to 0/1 and JSON columns valid", () => {
    expect(() => db.prepare(
      `insert into documents (user_id, file_name, file_path, rotation, uploaded_by_admin) values ('u2', 'b', 'p', 0, 7)`,
    ).run()).toThrow();
  });

  it("computes messages.has_attachment like the Postgres generated column", () => {
    const cols = db.prepare("pragma table_xinfo(messages)").all().map((c) => c.name);
    expect(cols).toContain("has_attachment");
  });

  it("gives bigint identity tables an auto-increment key", () => {
    const sql = String(db.prepare("select sql from sqlite_master where name='assistant_chat_turns'").get()!.sql);
    expect(sql).toMatch(/"id" INTEGER PRIMARY KEY AUTOINCREMENT/);
  });
});
