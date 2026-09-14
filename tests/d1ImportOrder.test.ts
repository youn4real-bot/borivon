import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { insertOrder, deleteOrder, withDependents, findOrphans, splitStatements, edges } from "../d1/fk.mjs";
import { importTables, planImport, tableColumns, sqliteRunner } from "../d1/importCore.mjs";

/**
 * The D1 refresh must survive foreign keys. D1 enforces them on every query,
 * and the old import emptied + refilled tables alphabetically: `agencies` was
 * emptied before `organizations` (refused), and emptying `organizations` would
 * CASCADE into rows already re-imported. These tests run the real import code
 * against a real SQLite with foreign keys ON, on synthetic rows only.
 */
type Row = Record<string, unknown>;
type Stmt = { run(...a: unknown[]): unknown; get(...a: unknown[]): Row | undefined; all(...a: unknown[]): Row[] };
type Db = { exec(sql: string): void; prepare(sql: string): Stmt; close(): void };
let DatabaseSync: (new (path: string) => Db) | null = null;
try { ({ DatabaseSync } = await import("node:sqlite") as unknown as { DatabaseSync: new (path: string) => Db }); } catch { /* older Node: skip */ }

type Col = { pg: string; nullable: boolean; default: unknown; generated: boolean };
type Types = Record<string, { columns: Record<string, Col>; pk: string[]; fks: { column: string; table: string; ref: string; on_delete?: string }[] }>;
type Run = (sql: string, params?: unknown[]) => Row[];
type Result = { problems: number; plan: { tables: string[]; added: string[]; refused: string[]; deleteOrder: string[]; insertOrder: string[] }; orphans: { table: string; column: string; count: number }[] };

const types: Types = JSON.parse(fs.readFileSync("d1/types.json", "utf8"));
const schemaSql = fs.readFileSync("d1/schema.sql", "utf8");
const uuid = () => crypto.randomUUID();

describe("foreign-key orders from the real registry", () => {
  it("puts every parent before its children, and deletes in the reverse order", () => {
    const order = insertOrder(types) as string[];
    expect(order).toHaveLength(Object.keys(types).length);
    const at = new Map(order.map((t, i) => [t, i]));
    const all = edges(types) as { table: string; parent: string }[];
    expect(all.length).toBe(41);
    for (const e of all) expect(at.get(e.parent)!, `${e.parent} before ${e.table}`).toBeLessThan(at.get(e.table)!);
    expect(deleteOrder(types)).toEqual([...order].reverse());
    // The pairs the old alphabetical refresh got wrong.
    expect(at.get("agencies")!).toBeLessThan(at.get("organizations")!);
    expect(at.get("feed_posts")!).toBeLessThan(at.get("feed_comments")!);
    expect(at.get("feed_comments")!).toBeLessThan(at.get("feed_comment_likes")!);
  });

  it("refuses a cycle or a self-reference instead of importing half of it", () => {
    const t = (fks: [string, string][]) => Object.fromEntries(
      [...new Set(fks.flat())].map((name) => [name, { columns: {}, pk: [], fks: fks.filter(([c]) => c === name).map(([, p]) => ({ column: "x", table: p, ref: "id" })) }]),
    );
    expect(() => insertOrder(t([["a", "b"], ["b", "a"]]))).toThrow(/cycle among: a, b/);
    expect(() => insertOrder(t([["a", "a"]]))).toThrow(/references its own table/);
  });

  it("closes a refresh over every table whose rows a parent delete would touch", () => {
    const set = withDependents(types, ["organizations"]) as string[];
    for (const t of ["organizations", "organization_members", "candidate_organizations", "feed_posts", "feed_comment_likes", "employers", "candidate_profiles", "phase_slots"]) {
      expect(set, t).toContain(t);
    }
    expect(set).not.toContain("agencies"); // a parent, not a dependent
    expect(withDependents(types, ["leads"])).toEqual(["leads"]);
  });

  it("counts orphans without printing their values", () => {
    const cols: Record<string, string[]> = { parent: ["id"], child: ["id", "parent_id"] };
    const rows: Record<string, unknown[][]> = { parent: [["p1"]], child: [["c1", "p1"], ["c2", "gone"], ["c3", null]] };
    const reg = { parent: { columns: {}, pk: ["id"], fks: [] }, child: { columns: {}, pk: ["id"], fks: [{ column: "parent_id", table: "parent", ref: "id" }] } };
    const out = findOrphans(reg, ["child"], (t: string) => rows[t], (t: string) => cols[t]);
    expect(out).toEqual([{ table: "child", column: "parent_id", parent: "parent", ref: "id", on_delete: "NO ACTION", count: 1, reason: "no matching parent row in the export" }]);
    expect(JSON.stringify(out)).not.toContain("gone");
  });

  it("splits d1/schema.sql into statements that build the same database one by one", () => {
    const statements = splitStatements(schemaSql) as string[];
    expect(statements.length).toBe((schemaSql.match(/^CREATE /gm) ?? []).length);
    expect(statements.some((s) => /^CREATE TRIGGER[\s\S]*; END;$/.test(s))).toBe(true);
    if (!DatabaseSync) return;
    const whole = new DatabaseSync(":memory:"), pieces = new DatabaseSync(":memory:");
    whole.exec(schemaSql);
    for (const s of statements) pieces.exec(s);
    const objects = (db: Db) => db.prepare("select type, name from sqlite_master order by type, name").all();
    expect(objects(pieces)).toEqual(objects(whole));
  });
});

describe.skipIf(!DatabaseSync)("importTables against a real SQLite with foreign keys ON", () => {
  const dirs: string[] = [];
  afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

  const fresh = () => {
    const db = new DatabaseSync!(":memory:");
    const run = sqliteRunner(db) as Run;
    db.exec(schemaSql);
    return { db, run };
  };
  /** Insert giving only what the table cannot fill itself; returns the overrides. */
  const insert = (db: Db, table: string, values: Row = {}) => {
    const row: Row = { ...values };
    for (const [c, meta] of Object.entries(types[table].columns)) {
      if (c in row || meta.generated || meta.nullable || meta.default !== null) continue;
      if (types[table].pk.length === 1 && types[table].pk[0] === c && ["integer", "bigint"].includes(meta.pg)) continue;
      row[c] = meta.pg === "uuid" ? uuid() : meta.pg === "boolean" ? 0 : ["integer", "bigint", "numeric"].includes(meta.pg) ? 1 : ["jsonb"].includes(meta.pg) ? "{}" : meta.pg.endsWith("[]") ? "[]" : `x-${uuid()}`;
    }
    const cols = Object.keys(row);
    db.prepare(`insert into "${table}" (${cols.map((c) => `"${c}"`).join(",")}) values (${cols.map(() => "?").join(",")})`).run(...cols.map((c) => row[c]));
    return row;
  };
  /** A live-shaped web of rows across two FK levels and all three delete rules. */
  const seed = (db: Db) => {
    const agency = insert(db, "agencies", { id: uuid() });
    const org = insert(db, "organizations", { id: uuid(), agency_id: agency.id });
    const org2 = insert(db, "organizations", { id: uuid() });
    insert(db, "organization_members", { org_id: org.id, sub_admin_email: `${uuid()}@x.de` });
    insert(db, "organization_members", { org_id: org2.id, sub_admin_email: `${uuid()}@x.de` });
    insert(db, "candidate_organizations", { org_id: org.id, candidate_user_id: uuid() });
    const post = insert(db, "feed_posts", { id: uuid(), org_id: org.id });
    const comment = insert(db, "feed_comments", { id: uuid(), post_id: post.id });
    insert(db, "feed_comment_likes", { comment_id: comment.id });
    const employer = insert(db, "employers", { id: uuid(), agency_id: org.id });
    insert(db, "candidate_profiles", { user_id: uuid(), employer_id: employer.id });
    return { agency, org };
  };
  /** Export every table the way d1/export-data.mjs writes it (row arrays + counts). */
  const exportDb = (db: Db, mutate?: (rows: Record<string, unknown[][]>) => void) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "d1-import-order-"));
    dirs.push(dir);
    const rows: Record<string, unknown[][]> = {};
    for (const t of Object.keys(types)) {
      const cols = tableColumns(types, t) as string[];
      rows[t] = db.prepare(`select ${cols.map((c) => `"${c}"`).join(",")} from "${t}"`).all().map((r) => cols.map((c) => r[c]));
    }
    mutate?.(rows);
    const counts: Record<string, number> = {};
    for (const [t, r] of Object.entries(rows)) { fs.writeFileSync(path.join(dir, `${t}.json`), JSON.stringify(r)); counts[t] = r.length; }
    fs.writeFileSync(path.join(dir, "_counts.json"), JSON.stringify(counts));
    return { dir, counts };
  };
  const counts = (db: Db) => Object.fromEntries(Object.keys(types).map((t) => [t, Number(db.prepare(`select count(*) n from "${t}"`).get()!.n)]));
  const quiet = () => {};

  it("the old alphabetical refresh breaks: agencies refuses, organizations silently cascades", () => {
    const { db } = fresh();
    seed(db);
    // "agencies" sorts first, but organizations still point at it (NO ACTION).
    expect(() => db.exec(`DELETE FROM "agencies"`)).toThrow(/FOREIGN KEY constraint failed/);
    // "candidate_organizations" sorts before "organizations": re-import it first…
    const cols = tableColumns(types, "candidate_organizations") as string[];
    const kept = db.prepare(`select ${cols.map((c) => `"${c}"`).join(",")} from candidate_organizations`).all();
    db.exec(`DELETE FROM "candidate_organizations"`);
    for (const r of kept) db.prepare(`insert into candidate_organizations (${cols.map((c) => `"${c}"`).join(",")}) values (${cols.map(() => "?").join(",")})`).run(...cols.map((c) => r[c]));
    expect(Number(db.prepare("select count(*) n from candidate_organizations").get()!.n)).toBe(1);
    // …then emptying "organizations" for its own refresh CASCADEs the fresh rows away, without an error.
    db.exec(`DELETE FROM "organizations"`);
    expect(Number(db.prepare("select count(*) n from candidate_organizations").get()!.n)).toBe(0);
  });

  it("refreshes a stale copy completely — twice — with 0 foreign-key violations", async () => {
    const source = fresh(); seed(source.db); seed(source.db);
    const { dir, counts: want } = exportDb(source.db);
    const target = fresh(); const stale = seed(target.db);

    for (let pass = 1; pass <= 2; pass++) {
      const out = await importTables({ run: target.run, types, dir, log: quiet }) as Result;
      expect(out.problems, `pass ${pass}`).toBe(0);
      expect(counts(target.db)).toEqual(want);
      expect(target.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    }
    expect(target.db.prepare("select count(*) n from agencies where id = ?").get(stale.agency.id)!.n).toBe(0);
    // Children were emptied before parents, parents filled before children.
    const plan = planImport(types, want);
    expect(plan.deleteOrder.indexOf("candidate_organizations")).toBeLessThan(plan.deleteOrder.indexOf("organizations"));
    expect(plan.insertOrder.indexOf("organizations")).toBeLessThan(plan.insertOrder.indexOf("candidate_organizations"));
  });

  it("refreshing one parent table pulls in its dependents, so none of their rows are lost", async () => {
    const source = fresh(); seed(source.db);
    const { dir, counts: want } = exportDb(source.db);
    const target = fresh();
    expect((await importTables({ run: target.run, types, dir, log: quiet }) as Result).problems).toBe(0);

    const out = await importTables({ run: target.run, types, dir, requested: ["organizations"], log: quiet }) as Result;
    expect(out.problems).toBe(0);
    expect(out.plan.added).toEqual(expect.arrayContaining(["organization_members", "candidate_organizations", "feed_comment_likes", "candidate_profiles"]));
    expect(out.plan.added).not.toContain("agencies");
    expect(counts(target.db)).toEqual(want);
    expect(want.candidate_organizations).toBe(1);
  });

  it("refuses an export with orphans BEFORE deleting anything", async () => {
    const source = fresh(); seed(source.db);
    const { dir } = exportDb(source.db, (rows) => {
      const idx = (tableColumns(types, "organization_members") as string[]).indexOf("org_id");
      rows.organization_members[0][idx] = uuid(); // its organization was deleted mid-export
    });
    const target = fresh(); seed(target.db);
    const before = counts(target.db);
    const out = await importTables({ run: target.run, types, dir, log: quiet }) as Result;
    expect(out.problems).toBe(1);
    expect(out.orphans).toEqual([expect.objectContaining({ table: "organization_members", column: "org_id", count: 1 })]);
    expect(counts(target.db)).toEqual(before);
  });

  it("refuses when a dependent table was not exported", () => {
    const plan = planImport(types, { organizations: 1, organization_members: "skipped" }, ["organizations"]);
    expect(plan.refused.some((r: string) => r.startsWith("organization_members:"))).toBe(true);
    expect(plan.deleteOrder).toEqual([]);
  });
});
