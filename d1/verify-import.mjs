/**
 * Dry-run the D1 import locally: build the schema in a throwaway SQLite with
 * foreign keys ON (as D1 always has them), run the SAME import code that
 * d1/import.mjs sends to Cloudflare (d1/importCore.mjs) over the exported rows,
 * then check:
 *   • each table's row count against the export AND against Postgres' exact
 *     count taken while exporting (_meta.json liveCounts);
 *   • PRAGMA foreign_key_check finds nothing;
 *   • the type mapping (booleans, JSON, timestamps, uuids);
 *   • a delete rule on real data: the organization with the most members and
 *     candidate links is deleted inside a savepoint, every table's row count is
 *     compared before and after, and the savepoint is rolled back.
 *
 *   node d1/verify-import.mjs <repo-root> <export-dir>
 *
 * Nothing leaves this process: the database is in memory. Output is table
 * names and counts only — never ids or values, which are personal data.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { importTables, sqliteRunner } from "./importCore.mjs";
import { edges } from "./fk.mjs";

const root = process.argv[2], dir = process.argv[3];
if (!root || !dir) { console.error("usage: node d1/verify-import.mjs <repo-root> <export-dir>"); process.exit(1); }

const db = new DatabaseSync(":memory:");
const run = sqliteRunner(db);
db.exec(fs.readFileSync(path.join(root, "d1", "schema.sql"), "utf8"));
const types = JSON.parse(fs.readFileSync(path.join(root, "d1", "types.json"), "utf8"));

const { problems, plan } = await importTables({ run, types, dir });
let failures = problems;
const countOf = (t) => Number(run(`select count(*) n from "${t}"`)[0].n);

const metaFile = path.join(dir, "_meta.json");
const meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, "utf8")) : null;
if (meta?.liveCounts) {
  const off = plan.tables.filter((t) => meta.liveCounts[t] !== countOf(t));
  for (const t of off) console.log(`!! ${t}: Postgres counted ${meta.liveCounts[t]}, loaded ${countOf(t)}`);
  if (off.length) failures++;
  else console.log(`ok  all ${plan.tables.length} tables hold exactly Postgres' count(*) at export time`);
  for (const t of Object.keys(meta.liveCounts).filter((t) => !plan.tables.includes(t))) {
    console.log(`    ${t}: not copied on purpose (Postgres has ${meta.liveCounts[t]})`);
  }
} else {
  console.log("    (no _meta.json: counts compared with the export only)");
}

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

// A real organization delete, then rolled back.
if (plan.tables.includes("organizations") && countOf("organizations") > 0) {
  const [org] = run(
    `select o.id, (select count(*) from organization_members m where m.org_id = o.id) members,
            (select count(*) from candidate_organizations c where c.org_id = o.id) links
     from organizations o order by members + links desc limit 1`,
  );
  const refs = edges(types).filter((e) => e.parent === "organizations");
  const refCount = (e) => Number(run(`select count(*) n from "${e.table}" where "${e.column}" = ?`, [org.id])[0].n);
  const before = Object.fromEntries(plan.tables.map((t) => [t, countOf(t)]));
  const refsBefore = refs.map(refCount);
  db.exec("SAVEPOINT cascade_probe");
  try {
    run(`delete from organizations where id = ?`, [org.id]);
    const changed = plan.tables.filter((t) => countOf(t) !== before[t]).map((t) => `${t} ${before[t]}→${countOf(t)}`);
    console.log(`\ncascade probe: deleted the organization with the most links (${org.members} members, ${org.links} candidate links)`);
    let bad = 0;
    refs.forEach((e, i) => {
      const after = refCount(e);
      if (refsBefore[i] === 0) return;
      const ok = after === 0;
      if (!ok) bad++;
      console.log(`${ok ? "ok " : "!! "} ${e.table}.${e.column} ${e.on_delete}: ${refsBefore[i]} referencing row(s) → ${after}`);
    });
    console.log(`    row counts that changed: ${changed.join(", ")}`);
    const setNullKept = refs.filter((e) => e.on_delete === "SET NULL" && before[e.table] !== countOf(e.table));
    if (setNullKept.length) { console.log(`!! SET NULL tables lost rows: ${setNullKept.map((e) => e.table).join(", ")}`); bad++; }
    if (run("PRAGMA foreign_key_check").length) { console.log("!! the delete left foreign-key violations"); bad++; }
    if (org.members + org.links === 0) { console.log("!! no organization has members or candidate links — probe proves nothing"); bad++; }
    if (bad) failures++;
  } catch (e) {
    console.log(`!! cascade probe: ${String(e.message).slice(0, 120)}`);
    failures++;
  } finally {
    db.exec("ROLLBACK TO cascade_probe");
    db.exec("RELEASE cascade_probe");
  }
  const restored = plan.tables.every((t) => countOf(t) === before[t]);
  console.log(restored ? "ok  probe rolled back — every count restored" : "!! probe rollback did not restore the counts");
  if (!restored) failures++;
}

const loaded = plan.tables.reduce((n, t) => n + countOf(t), 0);
console.log(`\n${plan.tables.length} tables, ${loaded} rows loaded, ${failures} problem(s)`);
process.exit(failures ? 1 : 0);
