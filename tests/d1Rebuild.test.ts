import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { buildSchema } from "../d1/gen-schema.mjs";
import { rebuild, gatedRebuild, parseArgs, planRebuild, diffStructure, expectedStructure, foreignKeysByAction } from "../d1/rebuild.mjs";
import { sqliteRunner, tableColumns } from "../d1/importCore.mjs";

/**
 * d1/rebuild.mjs is the one script that drops the real D1 copy's tables. The
 * copy predates foreign keys, and SQLite cannot ALTER one in — while every
 * statement in schema.sql is CREATE … IF NOT EXISTS, so re-applying it to the
 * old copy changes nothing and reports success. These tests drive the rebuild
 * against real SQLite databases with foreign keys ON (as D1 has them), on
 * synthetic rows only, and pin that every gate refuses BEFORE the first write.
 */
type Row = Record<string, unknown>;
type Stmt = { run(...a: unknown[]): unknown; get(...a: unknown[]): Row | undefined; all(...a: unknown[]): Row[] };
type Db = { exec(sql: string): void; prepare(sql: string): Stmt; close(): void };
let DatabaseSync: (new (path: string) => Db) | null = null;
try { ({ DatabaseSync } = await import("node:sqlite") as unknown as { DatabaseSync: new (path: string) => Db }); } catch { /* older Node: skip */ }

type Col = { pg: string; nullable: boolean; default: unknown; generated: boolean };
type Types = Record<string, { columns: Record<string, Col>; pk: string[]; fks: { column: string; table: string; ref: string; on_delete?: string }[] }>;
type Run = (sql: string, params?: unknown[]) => Row[];
type Outcome = { ok: boolean; stage: string; problems: string[]; bookmark?: string };

const types: Types = JSON.parse(fs.readFileSync("d1/types.json", "utf8"));
const schemaSql = fs.readFileSync("d1/schema.sql", "utf8");
const api = JSON.parse(fs.readFileSync("d1/snapshot/openapi.json", "utf8"));
/** The schema the live D1 copy was built from: same tables, no FKs, no jsonb defaults. */
const oldSql = (buildSchema(api, JSON.parse(fs.readFileSync("d1/snapshot/catalog.json", "utf8"))) as { sql: string }).sql;
const uuid = () => crypto.randomUUID();
const quiet = () => {};
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

describe("parseArgs — the real run needs --i-mean-it, and a plan is the default", () => {
  it("defaults to a dry run", () => {
    expect(parseArgs(["."])).toEqual({ mode: "dry", root: ".", dir: null, localPath: null });
    expect(parseArgs([".", "/tmp/exp"])).toMatchObject({ mode: "dry", dir: "/tmp/exp" });
  });
  it("only --i-mean-it reaches the real database, and only with an export", () => {
    expect(parseArgs([".", "/tmp/exp", "--i-mean-it"])).toMatchObject({ mode: "real" });
    expect(parseArgs([".", "--i-mean-it"])).toHaveProperty("error");
    expect(parseArgs([".", "/tmp/exp", "--yes"])).toEqual({ error: "unknown option --yes" });
    expect(parseArgs([".", "/tmp/exp", "--force"])).toHaveProperty("error");
  });
  it("rehearses locally with --local, never combined with the real run", () => {
    expect(parseArgs([".", "/tmp/exp", "--local", ":memory:"])).toMatchObject({ mode: "local", localPath: ":memory:" });
    expect(parseArgs([".", "/tmp/exp", "--local"])).toHaveProperty("error");
    expect(parseArgs([".", "/tmp/exp", "--local", "x.db", "--i-mean-it"])).toHaveProperty("error");
    expect(parseArgs([])).toEqual({ error: "usage" });
  });
});

describe("the CLI", () => {
  // Any network call in these runs throws: the dry run must work from files alone.
  const noNetwork = ["--import", "data:text/javascript,globalThis.fetch=()=>{throw new Error('network used')}"];
  const cli = (...args: string[]) => spawnSync(process.execPath, [...noNetwork, "d1/rebuild.mjs", ...args], { encoding: "utf8" });

  it("prints the plan by default and touches nothing", () => {
    const out = cli(".");
    expect(out.stderr).toBe("");
    expect(out.status).toBe(0);
    expect(out.stdout).toMatch(/^DRY RUN/);
    expect(out.stdout).toContain("DROP TABLE IF EXISTS, children first");
    expect(out.stdout).toContain('{"CASCADE":23,"SET NULL":14,"NO ACTION":4}');
    expect(out.stdout).toContain("--i-mean-it");
  });

  it("refuses the real run without an export, and an export inside the repo", () => {
    expect(cli(".", "--i-mean-it").status).toBe(2);
    const inside = cli(".", "d1", "--local", ":memory:");
    expect(inside.status).toBe(2);
    expect(inside.stderr).toMatch(/REFUSING/);
  });
});

describe("diffStructure", () => {
  it("names missing, redefined and unexpected objects — never row data", () => {
    const want = [{ type: "table", name: "a", tbl_name: "a", sql: "CREATE TABLE a (x)" }, { type: "index", name: "i", tbl_name: "a", sql: "CREATE INDEX i ON a (x)" }];
    const got = [{ type: "table", name: "a", tbl_name: "a", sql: "CREATE TABLE  a (x, y)" }, { type: "table", name: "z", tbl_name: "z", sql: "CREATE TABLE z (q)" }];
    expect(diffStructure(want, got)).toEqual(["different definition: table a", "missing index i", "unexpected table z"]);
    expect(diffStructure(want, want.map((r) => ({ ...r, sql: r.sql.replace(/ /g, "\n  ") })))).toEqual([]);
  });
});

describe.skipIf(!DatabaseSync)("rebuild against a real SQLite with foreign keys ON", () => {
  const open = (sql?: string) => {
    const db = new DatabaseSync!(":memory:");
    const run = sqliteRunner(db) as Run;
    if (sql) db.exec(sql);
    return { db, run };
  };
  const insert = (db: Db, table: string, values: Row = {}) => {
    const row: Row = { ...values };
    for (const [c, meta] of Object.entries(types[table].columns)) {
      if (c in row || meta.generated || meta.nullable || meta.default !== null) continue;
      if (types[table].pk.length === 1 && types[table].pk[0] === c && ["integer", "bigint"].includes(meta.pg)) continue;
      row[c] = meta.pg === "uuid" ? uuid() : meta.pg === "boolean" ? 0 : ["integer", "bigint", "numeric"].includes(meta.pg) ? 1 : meta.pg === "jsonb" ? "{}" : meta.pg.endsWith("[]") ? "[]" : `x-${uuid()}`;
    }
    const cols = Object.keys(row);
    db.prepare(`insert into "${table}" (${cols.map((c) => `"${c}"`).join(",")}) values (${cols.map(() => "?").join(",")})`).run(...cols.map((c) => row[c]));
    return row;
  };
  const seed = (db: Db) => {
    const agency = insert(db, "agencies", { id: uuid() });
    const org = insert(db, "organizations", { id: uuid(), agency_id: agency.id });
    insert(db, "organization_members", { org_id: org.id, sub_admin_email: `${uuid()}@x.de` });
    insert(db, "candidate_organizations", { org_id: org.id, candidate_user_id: uuid() });
    const post = insert(db, "feed_posts", { id: uuid(), org_id: org.id });
    const comment = insert(db, "feed_comments", { id: uuid(), post_id: post.id });
    insert(db, "feed_comment_likes", { comment_id: comment.id });
    const employer = insert(db, "employers", { id: uuid(), agency_id: org.id });
    insert(db, "candidate_profiles", { user_id: uuid(), employer_id: employer.id });
    return { agency, org };
  };
  /** Write an export the way d1/export-data.mjs does: row arrays, _counts.json, _meta.json. */
  const exportDb = (db: Db, mutate?: (rows: Record<string, unknown[][]>, meta: { columns: Record<string, string[]>; unstable: string[] }) => void, withMeta = true) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "d1-rebuild-"));
    dirs.push(dir);
    const rows: Record<string, unknown[][]> = {};
    const meta = { exportedAt: new Date().toISOString(), columns: {} as Record<string, string[]>, liveCounts: {} as Record<string, number>, unstable: [] as string[] };
    for (const t of Object.keys(types)) {
      const cols = tableColumns(types, t) as string[];
      rows[t] = db.prepare(`select ${cols.map((c) => `"${c}"`).join(",")} from "${t}"`).all().map((r) => cols.map((c) => r[c]));
      meta.columns[t] = cols;
    }
    mutate?.(rows, meta);
    const counts: Record<string, number> = {};
    for (const [t, r] of Object.entries(rows)) { fs.writeFileSync(path.join(dir, `${t}.json`), JSON.stringify(r)); counts[t] = r.length; meta.liveCounts[t] = r.length; }
    fs.writeFileSync(path.join(dir, "_counts.json"), JSON.stringify(counts));
    if (withMeta) fs.writeFileSync(path.join(dir, "_meta.json"), JSON.stringify(meta));
    return { dir, counts };
  };
  const counts = (db: Db) => Object.fromEntries(Object.keys(types).map((t) => [t, Number(db.prepare(`select count(*) n from "${t}"`).get()!.n)]));
  const structure = (db: Db) => db.prepare("select type, name, sql from sqlite_master order by type, name").all();
  const source = () => { const s = open(schemaSql); seed(s.db); seed(s.db); return exportDb(s.db); };

  it("re-applying schema.sql to the old FK-less copy is a silent no-op — the reason this script exists", async () => {
    const stale = open(oldSql);
    stale.db.exec(schemaSql); // every statement is IF NOT EXISTS: no error…
    expect(await foreignKeysByAction(stale.run, Object.keys(types))).toEqual({}); // …and no foreign key either
  });

  it("turns the old copy into exactly schema.sql, fills it, and can run again", async () => {
    const { dir, counts: want } = source();
    const target = open(oldSql);
    // Rows the old copy accepted that the new rules refuse: an orphan member.
    insert(target.db, "organization_members", { org_id: uuid(), sub_admin_email: "ghost@x.de" });

    for (let pass = 1; pass <= 2; pass++) {
      const out = await rebuild({ run: target.run, types, schemaSql, dir, log: quiet }) as Outcome;
      expect(out, `pass ${pass}`).toEqual({ ok: true, stage: "done", problems: [] });
      expect(counts(target.db)).toEqual(want);
      expect(target.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(await foreignKeysByAction(target.run, Object.keys(types))).toEqual({ CASCADE: 23, "SET NULL": 14, "NO ACTION": 4 });
      expect(diffStructure(await expectedStructure(schemaSql), target.run("select type, name, tbl_name, sql from sqlite_master where substr(name,1,7) <> 'sqlite_'"))).toEqual([]);
    }
    // The 16 restored defaults are live: the upsert that used to fail with 23502 works.
    expect(() => target.db.prepare("insert into candidate_profiles (user_id) values (?)").run(uuid())).not.toThrow();
  });

  it("drops children before parents — a parent first would refuse (NO ACTION) or cascade", () => {
    const db = open(schemaSql).db;
    seed(db);
    expect(() => db.exec(`DROP TABLE "agencies"`)).toThrow(/FOREIGN KEY constraint failed/);
  });

  it("refuses a doubtful export before touching the database", async () => {
    const base = open(schemaSql).db;
    seed(base);
    const cases: [string, ReturnType<typeof exportDb>, RegExp][] = [
      ["no _meta.json", exportDb(base, undefined, false), /_meta\.json missing/],
      ["columns from another types.json", exportDb(base, (_rows, meta) => { meta.columns.organizations = [...meta.columns.organizations].reverse(); }), /organizations: exported columns differ/],
      ["a repeated primary key", exportDb(base, (rows) => { rows.organization_members.push(rows.organization_members[0]); }), /organization_members: 1 row\(s\) repeat a primary key/],
      ["a table that changed while read", exportDb(base, (_rows, meta) => { meta.unstable.push("feed_posts"); }), /feed_posts: its row count kept changing/],
      ["an orphan child row", exportDb(base, (rows) => { rows.candidate_organizations[0][(tableColumns(types, "candidate_organizations") as string[]).indexOf("org_id")] = uuid(); }), /candidate_organizations\.org_id → organizations\.id: 1 row/],
    ];
    for (const [name, { dir }, why] of cases) {
      const target = open(oldSql);
      // A row in the old copy (whose jsonb columns have no DEFAULT), so "unchanged" means something.
      target.db.prepare(`insert into sub_admins (email) values (?)`).run(`${uuid()}@x.de`);
      const before = { s: structure(target.db), n: counts(target.db) };
      const lines: string[] = [];
      const out = await rebuild({ run: target.run, types, schemaSql, dir, log: (m: string) => lines.push(m) }) as Outcome;
      expect(out.stage, name).toBe("preflight");
      expect(out.problems.join("\n"), name).toMatch(why);
      expect(structure(target.db), name).toEqual(before.s);
      expect(counts(target.db), name).toEqual(before.n);
    }
  });

  describe("gatedRebuild — drift, rehearsal and a bookmark before the first write", () => {
    const spy = () => {
      const target = open(oldSql);
      const calls: string[] = [];
      const run = (sql: string, params?: unknown[]) => { calls.push(sql); return target.run(sql, params); };
      return { target, calls, run };
    };

    it("refuses on schema drift, or when drift cannot be checked", async () => {
      const { dir } = source();
      for (const checkDrift of [async () => ["table added: brand_new"], async () => { throw new Error("offline"); }]) {
        const s = spy();
        const bookmark = async () => { throw new Error("must not be asked"); };
        const out = await gatedRebuild({ run: s.run, types, schemaSql, dir, checkDrift, bookmark, log: quiet }) as Outcome;
        expect(out.stage).toBe("drift");
        expect(s.calls).toEqual([]);
      }
    });

    it("refuses when the local rehearsal fails — here a row a live CHECK refuses", async () => {
      const base = open(schemaSql).db;
      seed(base);
      insert(base, "admin_notifications", { type: "signup" });
      const { dir } = exportDb(base, (rows) => {
        rows.admin_notifications[0][(tableColumns(types, "admin_notifications") as string[]).indexOf("type")] = "hacked";
      });
      const s = spy();
      let asked = false;
      const out = await gatedRebuild({ run: s.run, types, schemaSql, dir, checkDrift: async () => [], bookmark: async () => { asked = true; return "bm"; }, log: quiet }) as Outcome;
      expect(out.stage).toBe("rehearsal/verify");
      expect(asked).toBe(false);
      expect(s.calls).toEqual([]);
    });

    it("refuses without a Time Travel bookmark", async () => {
      const { dir } = source();
      const s = spy();
      const out = await gatedRebuild({ run: s.run, types, schemaSql, dir, checkDrift: async () => [], bookmark: async () => { throw new Error("403"); }, log: quiet }) as Outcome;
      expect(out.stage).toBe("bookmark");
      expect(s.calls).toEqual([]);
    });

    it("rebuilds once every gate passes, and hands back the bookmark to undo it", async () => {
      const { dir, counts: want } = source();
      const s = spy();
      const lines: string[] = [];
      const out = await gatedRebuild({ run: s.run, types, schemaSql, dir, checkDrift: async () => [], bookmark: async () => "00000001-bm", log: (m: string) => lines.push(m) }) as Outcome;
      expect(out).toMatchObject({ ok: true, stage: "done", bookmark: "00000001-bm" });
      expect(counts(s.target.db)).toEqual(want);
      expect(lines).toContain("ok  rollback point: npx wrangler d1 time-travel restore borivon-db --bookmark=00000001-bm");
      // The bookmark line comes before the first DROP reached the database.
      expect(s.calls.findIndex((c) => c.startsWith("DROP"))).toBeGreaterThan(-1);
      expect(lines.findIndex((l) => l.startsWith("ok  rollback point"))).toBeLessThan(lines.findIndex((l) => l.startsWith("dropped")));
    });
  });

  it("plans from files alone, and says when the export would be refused", () => {
    const { dir } = source();
    const good = planRebuild({ types, schemaSql, dir }) as string[];
    expect(good.join("\n")).toContain("export checks: ok");
    expect(good.find((l) => l.startsWith("7. import"))).toMatch(/parents first: .*agencies.*organizations.*organization_members/);
    const base = open(schemaSql).db;
    seed(base);
    const bad = exportDb(base, (rows) => { rows.organization_members.push(rows.organization_members[0]); });
    expect((planRebuild({ types, schemaSql, dir: bad.dir }) as string[]).join("\n")).toMatch(/would be REFUSED[\s\S]*repeat a primary key/);
  });
});
