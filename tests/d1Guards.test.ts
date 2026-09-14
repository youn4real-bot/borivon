import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { generatedProblems, backendProblems, parseJsonc, exportAgeProblems, tsMicros, d1NewerRows, MAX_EXPORT_AGE_MIN } from "../d1/guards.mjs";
import { sqliteRunner, tableColumns } from "../d1/importCore.mjs";
import { CURRENT_CATALOG } from "../d1/gen-schema.mjs";

/**
 * d1/guards.mjs holds the gates between the copy tools and the REAL D1. Each
 * test is a way a run could go wrong while every other check said ok:
 *   • a snapshot re-captured without re-running the generator — the rebuild
 *     applied the OLD schema, the export read the OLD columns, and a new live
 *     column was silently missing from D1;
 *   • a rebuild or refresh after the switch — D1's own writes erased by a
 *     Supabase export;
 *   • an old export — every write since it was taken lost.
 * Synthetic rows only; no network (the CLI runs have fetch replaced by a throw).
 */
type Row = Record<string, unknown>;
type Stmt = { run(...a: unknown[]): unknown; get(...a: unknown[]): Row | undefined; all(...a: unknown[]): Row[] };
type Db = { exec(sql: string): void; prepare(sql: string): Stmt; close(): void };
let DatabaseSync: (new (path: string) => Db) | null = null;
try { ({ DatabaseSync } = await import("node:sqlite") as unknown as { DatabaseSync: new (path: string) => Db }); } catch { /* older Node: skip */ }

type Col = { pg: string; nullable: boolean; default: unknown; generated: boolean };
type Types = Record<string, { columns: Record<string, Col>; pk: string[] }>;
type Run = (sql: string, params?: unknown[]) => Row[];
type Newer = { problems: string[]; notes: string[]; probed: number };

const types: Types = JSON.parse(fs.readFileSync("d1/types.json", "utf8"));
const schemaSql = fs.readFileSync("d1/schema.sql", "utf8");
const uuid = () => crypto.randomUUID();
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = (tag: string) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `d1-guards-${tag}-`)); dirs.push(d); return d; };

const GENERATED_INPUTS = ["d1/snapshot/openapi.json", `d1/${CURRENT_CATALOG}`, "d1/schema.sql", "d1/types.json"];
/** A throwaway repo root holding only the files the gates read; `edit` changes or adds files first. */
function fakeRoot(edit?: (files: Record<string, string>) => void) {
  const root = tmp("root");
  const files: Record<string, string> = Object.fromEntries(GENERATED_INPUTS.map((f) => [f, fs.readFileSync(f, "utf8")]));
  edit?.(files);
  for (const [f, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.writeFileSync(path.join(root, f), text);
  }
  return root;
}
/** What `check-drift --update` leaves behind when live gained a column: the snapshot moves, the schema does not. */
const withNewLiveColumn = (files: Record<string, string>) => {
  const api = JSON.parse(files["d1/snapshot/openapi.json"]);
  api.definitions.organizations.properties.brand_new_col = { format: "text", type: "string" };
  files["d1/snapshot/openapi.json"] = JSON.stringify(api);
};

describe("generatedProblems — schema.sql and types.json are what the snapshots generate", () => {
  it("passes the committed files, including a CRLF checkout", () => {
    expect(generatedProblems(".")).toEqual([]);
    expect(generatedProblems(fakeRoot())).toEqual([]);
    const crlf = fakeRoot((f) => {
      f["d1/types.json"] = f["d1/types.json"].replace(/\r?\n/g, "\r\n");
      f["d1/schema.sql"] = f["d1/schema.sql"].replace(/\r?\n/g, "\r\n");
    });
    expect(generatedProblems(crlf)).toEqual([]);
  });

  it("catches a snapshot re-captured without re-running the generator (a new live column)", () => {
    expect(generatedProblems(fakeRoot(withNewLiveColumn))).toEqual(expect.arrayContaining([
      expect.stringMatching(/^d1\/schema\.sql is not what/),
      expect.stringMatching(/^d1\/types\.json is not what/),
    ]));
  });

  it("catches a re-captured catalog (a new CHECK), and a newer capture never wired in", () => {
    const check = fakeRoot((f) => {
      const cat = JSON.parse(f[`d1/${CURRENT_CATALOG}`]);
      cat.checks.push({ t: "leads", n: "leads_probe_check", d: "CHECK ((char_length(name) < 500))" });
      f[`d1/${CURRENT_CATALOG}`] = JSON.stringify(cat);
    });
    expect(generatedProblems(check)).toEqual(expect.arrayContaining([expect.stringMatching(/^d1\/schema\.sql is not what/)]));
    const newer = fakeRoot((f) => { f["d1/snapshot/catalog-2099-01-01.json"] = f[`d1/${CURRENT_CATALOG}`]; });
    expect((generatedProblems(newer) as string[]).join("\n")).toMatch(/newer catalog capture exists \(catalog-2099-01-01\.json\)/);
  });

  it("throws when it cannot read its inputs — so no caller can mistake that for 'current'", () => {
    expect(() => generatedProblems(path.join(tmp("empty"), "no-such-root"))).toThrow();
  });
});

describe("backendProblems — refuse unless every source says the site reads Supabase", () => {
  const supabaseDeployed = { bindings: [{ name: "DATA_BACKEND", type: "plain_text", text: "supabase" }] };
  const wrangler = (body: string) => `{\n  "name": "borivon",\n  ${body}\n}`;

  it("passes this checkout's wrangler.jsonc, and 'supabase' set explicitly everywhere", () => {
    expect(backendProblems({ wranglerText: fs.readFileSync("wrangler.jsonc", "utf8"), envLocalText: "", deployed: supabaseDeployed })).toEqual([]);
    expect(backendProblems({ wranglerText: wrangler('"vars": { "DATA_BACKEND": "supabase" }'), envLocalText: 'DATA_BACKEND="supabase"', deployed: { bindings: [] } })).toEqual([]);
  });

  it("refuses when any one source may point at D1 — or cannot be read", () => {
    const ok = { wranglerText: wrangler('"vars": {}'), envLocalText: "", deployed: supabaseDeployed };
    const cases: [string, Record<string, unknown>, RegExp][] = [
      ["top-level var", { wranglerText: wrangler('"vars": { "DATA_BACKEND": "d1" }') }, /^wrangler\.jsonc vars\.DATA_BACKEND is "d1"$/],
      ["an env section", { wranglerText: wrangler('"env": { "production": { "vars": { "DATA_BACKEND": "d1" } } }') }, /env\.production\.vars\.DATA_BACKEND is "d1"/],
      ["a typo the site would read as Supabase", { wranglerText: wrangler('"vars": { "DATA_BACKEND": "D1" }') }, /DATA_BACKEND is "D1"/],
      [".env.local, which OpenNext builds into the Worker", { envLocalText: "X=1\nDATA_BACKEND=d1\n" }, /^\.env\.local DATA_BACKEND is "d1"/],
      ["the deployed Worker", { deployed: { bindings: [{ name: "DATA_BACKEND", type: "plain_text", text: "d1" }] } }, /deployed Worker's DATA_BACKEND is "d1"/],
      ["a deployed secret nobody can read", { deployed: { bindings: [{ name: "DATA_BACKEND", type: "secret_text" }] } }, /as secret_text; its value cannot be read/],
      ["deployed settings unreadable", { deployed: { error: "HTTP 403" } }, /settings could not be read \(HTTP 403\)/],
      ["no wrangler.jsonc", { wranglerText: null }, /wrangler\.jsonc not found/],
      ["a broken wrangler.jsonc", { wranglerText: "{ \"vars\": " }, /wrangler\.jsonc could not be parsed/],
    ];
    for (const [name, change, why] of cases) {
      const out = backendProblems({ ...ok, ...change }) as string[];
      expect(out, name).toHaveLength(1);
      expect(out[0], name).toMatch(why);
    }
  });

  it("reads wrangler.jsonc like wrangler does: comments ignored, // inside strings kept", () => {
    const text = `{\n  // "DATA_BACKEND": "d1",\n  /* "DATA_BACKEND": "d1" */\n  "url": "https://x.dev/a//b",\n  "vars": { "A": "1", },\n}`;
    expect(parseJsonc(text)).toEqual({ url: "https://x.dev/a//b", vars: { A: "1" } });
    expect(backendProblems({ wranglerText: text, envLocalText: "# DATA_BACKEND=d1", deployed: { bindings: [] } })).toEqual([]);
  });
});

describe("exportAgeProblems", () => {
  const now = Date.parse("2026-09-14T12:00:00Z");
  const at = (minutesAgo: number) => ({ exportedAt: new Date(now - minutesAgo * 60_000).toISOString() });
  it("accepts an export up to 30 minutes old and refuses older, missing or future ones", () => {
    expect(MAX_EXPORT_AGE_MIN).toBe(30);
    expect(exportAgeProblems(at(29), now)).toEqual([]);
    expect(exportAgeProblems(at(31), now)).toEqual([expect.stringMatching(/31 minutes old \(limit 30\)/)]);
    expect(exportAgeProblems(null, now)).toEqual([expect.stringMatching(/no _meta\.json exportedAt/)]);
    expect(exportAgeProblems(at(-10), now)).toEqual([expect.stringMatching(/from the future/)]);
  });
});

describe("tsMicros", () => {
  it("orders PostgREST timestamps to the microsecond and reads every offset form", () => {
    expect(tsMicros("2026-09-13T10:00:00.123457+00:00") - tsMicros("2026-09-13T10:00:00.123456+00:00")).toBe(1);
    const same = ["2026-09-13T10:00:00Z", "2026-09-13T10:00:00.000Z", "2026-09-13 12:00:00+02", "2026-09-13T12:00:00.000000+0200"].map(tsMicros);
    expect(new Set(same).size).toBe(1);
    for (const bad of ["nope", null, "2026-09-13", 12]) expect(tsMicros(bad)).toBeNaN();
  });
});

describe.skipIf(!DatabaseSync)("d1NewerRows — does D1 hold writes the export lacks?", () => {
  const EXPORTED_AT = "2026-09-14T10:00:00.000Z";
  const OLD = "2026-09-01T10:00:00.000000+00:00";
  const BETWEEN = "2026-09-10T10:00:00.000000+00:00"; // after every exported row, before the export
  const AFTER = "2026-09-14T10:05:00.000000+00:00";

  const org = (db: Db, createdAt: string) => {
    const id = uuid();
    db.prepare(`insert into organizations (id, name, invite_code, created_at) values (?, 'Org', ?, ?)`).run(id, `inv-${id}`, createdAt);
    return id;
  };
  /** Export `db` the way d1/export-data.mjs writes it: row arrays + _counts.json. */
  const exportOf = (db: Db) => {
    const dir = tmp("export");
    const counts: Record<string, number> = {};
    for (const t of Object.keys(types)) {
      const cols = tableColumns(types, t) as string[];
      const rows = db.prepare(`select ${cols.map((c) => `"${c}"`).join(",")} from "${t}"`).all().map((r) => cols.map((c) => r[c]));
      fs.writeFileSync(path.join(dir, `${t}.json`), JSON.stringify(rows));
      counts[t] = rows.length;
    }
    fs.writeFileSync(path.join(dir, "_counts.json"), JSON.stringify(counts));
    return dir;
  };
  /** A D1 copy holding exactly what was exported — the state before any switch. */
  const copy = () => {
    const db = new DatabaseSync!(":memory:");
    const run = sqliteRunner(db) as Run;
    db.exec(schemaSql);
    const orgId = org(db, OLD);
    const employerId = uuid();
    db.prepare(`insert into employers (id, name, address_lines, agency_id, created_at, updated_at) values (?, 'E', '[]', ?, ?, ?)`).run(employerId, orgId, OLD, OLD);
    return { db, run, employerId, dir: exportOf(db) };
  };
  const probe = (c: ReturnType<typeof copy>, acceptNewerIn: string[] = []) =>
    d1NewerRows({ run: c.run, types, dir: c.dir, exportedAt: EXPORTED_AT, acceptNewerIn }) as Promise<Newer>;

  it("finds nothing when D1 holds exactly the export", async () => {
    const out = await probe(copy());
    expect(out.problems).toEqual([]);
    expect(out.probed).toBeGreaterThan(50);
  });

  it("refuses a row D1 changed after the export's copy of it", async () => {
    const c = copy();
    c.db.prepare(`update employers set updated_at = ? where id = ?`).run(BETWEEN, c.employerId);
    expect((await probe(c)).problems).toEqual([expect.stringMatching(/^employers: 1 row\(s\) were changed in D1 after the export's copy/)]);
  });

  it("refuses a row written to D1 after the export was taken", async () => {
    const c = copy();
    org(c.db, AFTER);
    expect((await probe(c)).problems).toEqual([expect.stringMatching(/^organizations: 1 row\(s\) in D1 are newer than the export itself/)]);
  });

  it("refuses a D1-only row newer than anything exported — unless the operator names the table", async () => {
    const c = copy();
    org(c.db, BETWEEN);
    expect((await probe(c)).problems.join("\n")).toMatch(/^organizations: 1 row\(s\) exist only in D1[\s\S]*--accept-newer-in=organizations/);
    const accepted = await probe(c, ["organizations"]);
    expect(accepted.problems).toEqual([]);
    expect(accepted.notes.join("\n")).toMatch(/organizations: 1 row\(s\) only in D1/);
    // Naming the table never excuses a write made after the export.
    org(c.db, AFTER);
    expect((await probe(c, ["organizations"])).problems).toEqual([expect.stringMatching(/newer than the export itself/)]);
  });

  it("lets through a D1-only row older than the export's newest (deleted from Supabase long ago)", async () => {
    const c = copy();
    org(c.db, "2026-08-01T00:00:00.000000+00:00");
    expect((await probe(c)).problems).toEqual([]);
  });

  it("skips a D1 with no tables yet, and refuses when D1 cannot be read", async () => {
    const c = copy();
    const empty = sqliteRunner(new DatabaseSync!(":memory:")) as Run;
    expect(await d1NewerRows({ run: empty, types, dir: c.dir, exportedAt: EXPORTED_AT })).toEqual({ problems: [], notes: [], probed: 0 });
    const broken: Run = () => { throw new Error("D1_ERROR: network connection lost"); };
    const out = await d1NewerRows({ run: broken, types, dir: c.dir, exportedAt: EXPORTED_AT, tables: ["organizations"] }) as Newer;
    expect(out.problems).toEqual([expect.stringMatching(/^organizations: could not read D1 \(D1_ERROR: network connection lost\)/)]);
  });
});

describe("the CLIs — exit codes a wrapper can trust, never a stack trace", () => {
  const noNetwork = ["--import", "data:text/javascript,globalThis.fetch=()=>{throw new Error('network used')}"];
  const node = (...args: string[]) => spawnSync(process.execPath, [...noNetwork, ...args], { encoding: "utf8" });
  const noStack = (r: { stderr: string }) => expect(r.stderr).not.toMatch(/\n\s+at \S/);
  const ENV = "NEXT_PUBLIC_SUPABASE_URL=https://example.invalid\nSUPABASE_SERVICE_ROLE_KEY=not-a-key\n";

  it("check-drift: 2 when it could not check at all, 1 when the generated files are stale", () => {
    const runs = [
      [node("d1/check-drift.mjs", path.join(tmp("x"), "no-such-root")), 2, /could not check: .*\.env\.local unreadable/],
      [node("d1/check-drift.mjs", fakeRoot((f) => { f[".env.local"] = "OTHER=1\n"; })), 2, /SUPABASE_SERVICE_ROLE_KEY missing/],
      [node("d1/check-drift.mjs", fakeRoot((f) => { f[".env.local"] = ENV; })), 2, /could not check: network used/],
    ] as const;
    for (const [r, code, why] of runs) {
      expect(r.status).toBe(code);
      expect(r.stderr).toMatch(why);
      noStack(r);
    }
    const stale = node("d1/check-drift.mjs", fakeRoot((f) => { f[".env.local"] = ENV; withNewLiveColumn(f); }));
    expect(stale.status).toBe(1);
    expect(stale.stdout).toMatch(/^STALE: d1\/schema\.sql \/ d1\/types\.json/);
    noStack(stale);
  });

  it("import.mjs and export-data.mjs refuse a stale schema before .env.local or the network", () => {
    const stale = fakeRoot(withNewLiveColumn);
    const out = tmp("export-out");
    const imp = node("d1/import.mjs", stale, out);
    expect(imp.status).toBe(1);
    expect(imp.stderr).toMatch(/d1\/types\.json is not what[\s\S]*REFUSING/);
    const exp = node("d1/export-data.mjs", stale, out);
    expect(exp.status).toBe(1);
    expect(exp.stderr).toMatch(/^REFUSING: d1\/schema\.sql \/ d1\/types\.json/);
    const noEnv = node("d1/import.mjs", fakeRoot(), out);
    expect(noEnv.status).toBe(2);
    expect(noEnv.stderr).toMatch(/could not read .*\.env\.local/);
    for (const r of [imp, exp, noEnv]) noStack(r);
  });
});
