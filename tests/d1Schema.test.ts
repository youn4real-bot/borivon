import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import crypto from "node:crypto";
import { buildSchema, pgExprToSqlite, normalizeCatalog, catalogDefault, CURRENT_CATALOG } from "../d1/gen-schema.mjs";

/**
 * The generated D1 schema must load into a real SQLite and behave like the
 * Postgres original: same tables, defaults filled in the same format, the
 * same CHECK rules refusing the same bad values, every index created, and a
 * parent delete doing to its children exactly what Postgres does (CASCADE /
 * SET NULL / refuse). Built and tested without touching anything live.
 */
type Row = Record<string, unknown>;
type Db = { exec(sql: string): void; prepare(sql: string): { run(...a: unknown[]): unknown; get(...a: unknown[]): Row | undefined; all(...a: unknown[]): Row[] } };
let DatabaseSync: (new (path: string) => Db) | null = null;
try { ({ DatabaseSync } = await import("node:sqlite") as unknown as { DatabaseSync: new (path: string) => Db }); } catch { /* older Node: skip */ }

type Col = { pg: string; nullable: boolean; default: unknown; generated: boolean };
type Fk = { column: string; table: string; ref: string; on_delete: string; on_update: string; name: string };
type Types = Record<string, { columns: Record<string, Col>; pk: string[]; fks: Fk[]; authFks?: Fk[] }>;
type RawFk = { t: string; ref: string; on_delete: string };
type RawDefault = { t: string; c: string; d: string };

const api = JSON.parse(fs.readFileSync("d1/snapshot/openapi.json", "utf8"));
const rawCat = JSON.parse(fs.readFileSync(`d1/${CURRENT_CATALOG}`, "utf8"));
const cat = normalizeCatalog(rawCat) as { indexes: { t: string; d: string }[]; foreignKeys: RawFk[]; columnDefaults: RawDefault[] };
const built = buildSchema(api, rawCat) as { sql: string; types: Types; warnings: string[] };

/** The 16 jsonb / array defaults PostgREST's OpenAPI never shows. */
const OMITTED_NON_SCALAR = cat.columnDefaults.filter((d) =>
  /::(jsonb|text\[\]|uuid\[\])$/.test(d.d) && api.definitions[d.t].properties[d.c].default === undefined);

describe("pgExprToSqlite", () => {
  it("turns Postgres CHECK syntax into SQLite", () => {
    expect(pgExprToSqlite("((status = ANY (ARRAY['a'::text, 'b'::text])))")).toBe("((status IN ('a', 'b')))");
    expect(pgExprToSqlite("((char_length(title) <= 100))")).toBe("((length(title) <= 100))");
    expect(pgExprToSqlite("((id = true))")).toBe("((id = 1))");
    expect(pgExprToSqlite("(starts_at, COALESCE(host_id, (0)::bigint)) WHERE (status <> 'cancelled'::text)"))
      .toBe("(starts_at, COALESCE(host_id, (0))) WHERE (status <> 'cancelled')");
  });
});

describe("catalogDefault", () => {
  it("turns pg_get_expr defaults into the form OpenAPI would have shown", () => {
    expect(catalogDefault("'[]'::jsonb", "jsonb")).toEqual({ value: "[]" });
    expect(catalogDefault("'{}'::uuid[]", "uuid[]")).toEqual({ value: "{}" });
    expect(catalogDefault("''::text", "text")).toEqual({ value: "" });
    expect(catalogDefault("'it''s'::text", "text")).toEqual({ value: "it's" });
    expect(catalogDefault("nextval('bookings_id_seq'::regclass)", "bigint")).toEqual({ identity: true });
    expect(catalogDefault("false", "boolean")).toEqual({ value: false });
    expect(catalogDefault("'{a}'::text[]", "text[]")).toHaveProperty("warning");
    expect(catalogDefault("'{nope'::jsonb", "jsonb")).toHaveProperty("warning");
  });
});

describe("the catalog the schema is generated from", () => {
  it("is the v2 capture, and the generator reports nothing it could not translate", () => {
    expect(CURRENT_CATALOG).toBe("snapshot/catalog-2026-09-13.json");
    expect(built.warnings).toEqual([]);
  });

  it("still accepts the v1 array-form catalog — without inventing foreign keys", () => {
    const v1 = JSON.parse(fs.readFileSync("d1/snapshot/catalog.json", "utf8"));
    const old = buildSchema(api, v1) as { sql: string; types: Types; warnings: string[] };
    expect(old.warnings).toEqual([]);
    expect(old.sql).not.toMatch(/FOREIGN KEY/);
    expect(old.sql).toMatch(/CREATE TABLE IF NOT EXISTS "notifications"/);
    // v1 keeps OpenAPI's own FK hints in the registry, as before.
    expect(old.types.organization_members.fks.map((f) => f.table)).toContain("organizations");
  });

  it("records every foreign key to auth.users in types.json, and none in the SQL", () => {
    const authInCatalog = cat.foreignKeys.filter((f) => f.ref === "auth.users");
    const recorded = Object.values(built.types).flatMap((t) => t.authFks ?? []);
    expect(recorded).toHaveLength(authInCatalog.length);
    expect(recorded.length).toBe(20);
    expect(built.types.documents.authFks).toEqual([
      { column: "user_id", table: "auth.users", ref: "id", on_delete: "CASCADE", on_update: "NO ACTION", name: "documents_user_id_fkey" },
    ]);
    expect(built.sql).not.toMatch(/REFERENCES "auth/);
  });
});

describe.skipIf(!DatabaseSync)("generated D1 schema in a real SQLite", () => {
  let db: Db;
  const uuid = () => crypto.randomUUID();
  // Text samples are unique: organizations.invite_code is UNIQUE NOT NULL.
  const SAMPLE: Record<string, () => unknown> = {
    uuid, text: () => `x-${uuid()}`, date: () => "2026-01-01", timestamptz: () => "2026-01-01T00:00:00+00:00",
    boolean: () => 0, integer: () => 1, bigint: () => 1, numeric: () => 1, jsonb: () => "{}", "text[]": () => "[]", "uuid[]": () => "[]",
  };
  /** Insert a row giving only what the table cannot fill itself (plus overrides). */
  const insert = (table: string, values: Row = {}): Row => {
    const row: Row = { ...values };
    for (const [c, meta] of Object.entries(built.types[table].columns)) {
      if (c in row || meta.generated || meta.nullable || meta.default !== null) continue;
      if (built.types[table].pk.length === 1 && built.types[table].pk[0] === c && ["integer", "bigint"].includes(meta.pg)) continue;
      row[c] = SAMPLE[meta.pg]();
    }
    const cols = Object.keys(row);
    db.prepare(`insert into "${table}" (${cols.map((c) => `"${c}"`).join(",")}) values (${cols.map(() => "?").join(",")})`).run(...cols.map((c) => row[c]));
    return row;
  };
  const count = (sql: string, ...a: unknown[]) => Number(db.prepare(sql).get(...a)!.n);

  beforeAll(() => {
    db = new DatabaseSync!(":memory:");
    db.exec("PRAGMA foreign_keys = ON"); // D1 always enforces them
    db.exec(built.sql);
  });

  it("creates every live table", () => {
    const n = count("select count(*) n from sqlite_master where type='table' and name not like 'sqlite_%'");
    expect(n).toBe(Object.keys(api.definitions).length);
  });

  it("creates every non-primary-key index, including the new unique one", () => {
    const want = cat.indexes.filter(({ d }) => !/_pkey ON/.test(d)).length;
    expect(count("select count(*) n from sqlite_master where type='index' and name not like 'sqlite_%'")).toBe(want);
    const idx = db.prepare(`pragma index_list("assistant_commitments")`).all().find((i) => i.name === "assistant_commitments_owner_src_what");
    expect(idx?.unique).toBe(1);
    const row = { owner_user_id: uuid(), who_email: "a@b.c", what: "call back", source_message_id: "m1" };
    insert("assistant_commitments", row);
    expect(() => insert("assistant_commitments", row)).toThrow(/UNIQUE constraint failed/);
  });

  it("carries every public foreign key with the catalog's exact delete rule", () => {
    const names = Object.keys(api.definitions);
    const got: Record<string, number> = {};
    for (const t of names) for (const fk of db.prepare(`pragma foreign_key_list("${t}")`).all()) got[String(fk.on_delete)] = (got[String(fk.on_delete)] ?? 0) + 1;
    const want: Record<string, number> = {};
    const ACTION: Record<string, string> = { a: "NO ACTION", r: "RESTRICT", c: "CASCADE", n: "SET NULL", d: "SET DEFAULT" };
    for (const f of cat.foreignKeys.filter((x) => x.ref !== "auth.users")) want[ACTION[f.on_delete]] = (want[ACTION[f.on_delete]] ?? 0) + 1;
    expect(got).toEqual(want);
    expect(got).toEqual({ CASCADE: 23, "SET NULL": 14, "NO ACTION": 4 });
  });

  it("an organization delete cascades to its members and candidate links, and blanks SET NULL references", () => {
    const org = insert("organizations", { id: uuid() });
    const other = insert("organizations", { id: uuid() });
    insert("organization_members", { org_id: org.id, sub_admin_email: "m1@x.de" });
    insert("organization_members", { org_id: other.id, sub_admin_email: "m2@x.de" });
    insert("candidate_organizations", { org_id: org.id, candidate_user_id: uuid() });
    const employer = insert("employers", { id: uuid(), agency_id: org.id });
    const cohort = insert("academy_cohorts", { id: uuid(), org_id: org.id });

    db.prepare(`delete from organizations where id = ?`).run(org.id);

    expect(count(`select count(*) n from organization_members where org_id = ?`, org.id)).toBe(0);
    expect(count(`select count(*) n from candidate_organizations where org_id = ?`, org.id)).toBe(0);
    expect(count(`select count(*) n from organization_members where org_id = ?`, other.id)).toBe(1); // untouched
    expect(db.prepare(`select agency_id from employers where id = ?`).get(employer.id)!.agency_id).toBeNull();
    expect(db.prepare(`select org_id from academy_cohorts where id = ?`).get(cohort.id)!.org_id).toBeNull();
  });

  it("cascades through two levels (feed post → comment → comment like)", () => {
    const post = insert("feed_posts", { id: uuid() });
    const comment = insert("feed_comments", { id: uuid(), post_id: post.id });
    insert("feed_comment_likes", { comment_id: comment.id });
    db.prepare(`delete from feed_posts where id = ?`).run(post.id);
    expect(count(`select count(*) n from feed_comment_likes where comment_id = ?`, comment.id)).toBe(0);
  });

  it("refuses a NO ACTION parent delete and an orphan child insert, like Postgres", () => {
    const agency = insert("agencies", { id: uuid() });
    insert("sub_admins", { email: "sa@x.de", agency_id: agency.id });
    expect(() => db.prepare(`delete from agencies where id = ?`).run(agency.id)).toThrow(/FOREIGN KEY constraint failed/);
    expect(() => insert("organization_members", { org_id: uuid(), sub_admin_email: "ghost@x.de" })).toThrow(/FOREIGN KEY constraint failed/);
  });

  it("fills in the 16 jsonb / array defaults OpenAPI omits", () => {
    expect(OMITTED_NON_SCALAR).toHaveLength(16);
    for (const d of OMITTED_NON_SCALAR) {
      const info = db.prepare(`pragma table_info("${d.t}")`).all().find((c) => c.name === d.c)!;
      const pgText = d.d.match(/^'((?:[^']|'')*)'::/)![1].replace(/''/g, "'");
      const expected = /\[\]$/.test(d.d) ? [] : JSON.parse(pgText); // Postgres '{}' array → JSON []
      const sqliteText = String(info.dflt_value).replace(/^'|'$/g, "").replace(/''/g, "'");
      expect(JSON.parse(sqliteText), `${d.t}.${d.c}`).toEqual(expected);
    }
    // And a real insert that leaves them out gets them — the upsert that used to 23502.
    const profile = insert("candidate_profiles", { user_id: uuid() });
    expect(db.prepare(`select passport_confirmed_fields from candidate_profiles where user_id = ?`).get(profile.user_id)!.passport_confirmed_fields).toBe("[]");
    insert("booking_availability", { id: 1 });
    const week = JSON.parse(String(db.prepare(`select week from booking_availability where id = 1`).get()!.week));
    expect(week["1"]).toEqual(["09:00-13:00", "14:00-18:00"]);
    expect(Object.keys(week)).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("fills uuid + timestamp defaults in the Postgres/PostgREST format", () => {
    db.prepare(`insert into documents (user_id, file_name, file_path, rotation, uploaded_by_admin) values (?, 'a.pdf', 'p', 0, 0)`)
      .run("11111111-1111-4111-8111-111111111111");
    const row = db.prepare("select id, uploaded_at, file_type from documents").get()!;
    expect(String(row.id)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(String(row.uploaded_at)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}\+00:00$/);
    expect(row.file_type).toBe("Autre");
  });

  it("refuses the same bad values the live CHECKs refuse — and accepts the widened ones", () => {
    const notify = (action: string) => db.prepare(
      `insert into notifications (user_id, doc_id, doc_name, doc_type, action) values ('u', 'd', 'n', 't', ?)`,
    ).run(action);
    expect(() => notify("hacked")).toThrow();
    for (const ok of ["approved", "follow_up", "live_class"]) expect(() => notify(ok)).not.toThrow();

    const adminNotify = (type: string) => insert("admin_notifications", { type });
    expect(() => adminNotify("hacked")).toThrow(/CHECK constraint failed/);
    for (const ok of ["signup", "org-join", "org-request"]) expect(() => adminNotify(ok)).not.toThrow();
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

  it("is exactly what the committed d1/schema.sql and d1/types.json hold (re-run the generator)", () => {
    const lf = (s: string) => s.replace(/\r\n/g, "\n");
    expect(lf(fs.readFileSync("d1/schema.sql", "utf8"))).toBe(built.sql);
    expect(JSON.parse(fs.readFileSync("d1/types.json", "utf8"))).toEqual(built.types);
  });
});
