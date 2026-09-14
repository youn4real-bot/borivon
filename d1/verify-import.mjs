/**
 * Dry-run the D1 import locally: build the schema in a throwaway SQLite with
 * foreign keys ON (as D1 always has them), run the SAME import code that
 * d1/import.mjs sends to Cloudflare (d1/importCore.mjs) over the exported rows,
 * then check each table's row count against the counts recorded at export time
 * (which came from live Supabase) and that no foreign key is violated.
 *
 *   node d1/verify-import.mjs <repo-root> <export-dir>
 *
 * A green run here means the import is sound before anything is sent anywhere.
 * Uses node:sqlite — the engine behind D1.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { importTables, sqliteRunner } from "./importCore.mjs";

const root = process.argv[2], dir = process.argv[3];
if (!root || !dir) { console.error("usage: node d1/verify-import.mjs <repo-root> <export-dir>"); process.exit(1); }

const db = new DatabaseSync(":memory:");
const run = sqliteRunner(db);
db.exec(fs.readFileSync(path.join(root, "d1", "schema.sql"), "utf8"));
const types = JSON.parse(fs.readFileSync(path.join(root, "d1", "types.json"), "utf8"));

const { problems, plan } = await importTables({ run, types, dir });
let failures = problems;

const violations = run("PRAGMA foreign_key_check");
if (violations.length) { console.log(`!! ${violations.length} foreign-key violation(s) in: ${[...new Set(violations.map((v) => v.table))].join(", ")}`); failures++; }
else console.log("ok  0 foreign-key violations");

// Spot-check the things the type mapping could get wrong.
const checks = [
  ["booleans are 0/1", `select count(*) n from documents where uploaded_by_admin not in (0,1)`, 0],
  ["json columns parse", `select count(*) n from candidate_profiles where cv_draft is not null and json_valid(cv_draft) = 0`, 0],
  ["timestamps keep their format", `select count(*) n from documents where uploaded_at not like '____-__-__T__:__:__%'`, 0],
  ["uuid keys survive", `select count(*) n from documents where length(id) <> 36`, 0],
];
for (const [name, sql, want] of checks) {
  try {
    const n = run(sql)[0].n;
    if (n !== want) { console.log(`!! ${name}: ${n} bad rows`); failures++; }
    else console.log(`ok  ${name}`);
  } catch (e) { console.log(`!! ${name}: ${String(e.message).slice(0, 100)}`); failures++; }
}

const loaded = plan.tables.reduce((n, t) => n + Number(run(`select count(*) n from "${t}"`)[0].n), 0);
console.log(`\n${plan.tables.length} tables, ${loaded} rows loaded, ${failures} problem(s)`);
process.exit(failures ? 1 : 0);
