/**
 * Dry-run the D1 import locally: build the schema in a throwaway SQLite, run
 * every exported .sql file into it, then check each table's row count against
 * the counts recorded at export time (which came from live Supabase).
 *
 *   node d1/verify-import.mjs <repo-root> <export-dir>
 *
 * This is the same SQL that will later go to Cloudflare with
 * `wrangler d1 execute`, so a green run here means the import is sound before
 * anything is sent anywhere. Uses node:sqlite — the engine behind D1.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = process.argv[2], dir = process.argv[3];
if (!root || !dir) { console.error("usage: node d1/verify-import.mjs <repo-root> <export-dir>"); process.exit(1); }

const db = new DatabaseSync(":memory:");
db.exec(fs.readFileSync(path.join(root, "d1", "schema.sql"), "utf8"));

const expected = JSON.parse(fs.readFileSync(path.join(dir, "_counts.json"), "utf8"));
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
let failures = 0, loaded = 0;

for (const f of files) {
  const table = f.replace(/\.sql$/, "");
  const sql = fs.readFileSync(path.join(dir, f), "utf8");
  try {
    db.exec(sql);
  } catch (e) {
    console.log(`!! ${table}: ${String(e.message).slice(0, 140)}`);
    failures++;
    continue;
  }
  const got = db.prepare(`select count(*) n from "${table}"`).get().n;
  const want = expected[table] === "skipped" ? got : Number(expected[table] ?? 0);
  loaded += got;
  if (got !== want) { console.log(`!! ${table}: expected ${want}, got ${got}`); failures++; }
}

// Spot-check the things the type mapping could get wrong.
const checks = [
  ["booleans are 0/1", `select count(*) n from documents where uploaded_by_admin not in (0,1)`, 0],
  ["json columns parse", `select count(*) n from candidate_profiles where cv_draft is not null and json_valid(cv_draft) = 0`, 0],
  ["timestamps keep their format", `select count(*) n from documents where uploaded_at not like '____-__-__T__:__:__%'`, 0],
  ["uuid keys survive", `select count(*) n from documents where length(id) <> 36`, 0],
];
for (const [name, sql, want] of checks) {
  try {
    const n = db.prepare(sql).get().n;
    if (n !== want) { console.log(`!! ${name}: ${n} bad rows`); failures++; }
    else console.log(`ok  ${name}`);
  } catch (e) { console.log(`!! ${name}: ${String(e.message).slice(0, 100)}`); failures++; }
}

console.log(`\n${files.length} files, ${loaded} rows loaded, ${failures} problem(s)`);
process.exit(failures ? 1 : 0);
