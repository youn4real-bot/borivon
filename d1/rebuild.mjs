/**
 * Rebuild the D1 copy from d1/schema.sql and refill it from an export: the
 * runbook step that gives the copy its foreign keys, its jsonb/array defaults
 * and the current CHECKs.
 *
 * Why a rebuild and not a migration: SQLite's ALTER TABLE cannot add a FOREIGN
 * KEY, a CHECK or a DEFAULT to an existing table. The copy was created before
 * gen-schema knew them, and every statement in schema.sql is
 * `CREATE … IF NOT EXISTS` — so applying the new file to the old copy is a
 * silent no-op: zero foreign keys, the 16 defaults still missing (inserts that
 * leave them out still fail with 23502), and every tool reporting success.
 *
 *   node d1/rebuild.mjs <repo-root> [<export-dir>]                        DRY RUN (default): print the plan, touch nothing
 *   node d1/rebuild.mjs <repo-root> <export-dir> --local <file|:memory:>  full rehearsal into a local SQLite
 *   node d1/rebuild.mjs <repo-root> <export-dir> --i-mean-it              the REAL D1 copy
 *
 * The real run, in order. Every gate refuses before the first write:
 *   1. live Supabase structure == d1/snapshot/openapi.json (d1/check-drift.mjs)
 *   2. the export is sound: taken with this types.json (_meta.json columns),
 *      no duplicate keys, no orphan child rows
 *   3. steps 5-8 rehearsed in full in an in-memory SQLite with foreign keys ON
 *   4. a D1 Time Travel bookmark of the copy as it is now, printed with the
 *      restore command — the one-line undo
 * then the writes:
 *   5. DROP every table the schema defines, children before parents (a DROP
 *      runs an implicit DELETE, which would cascade or refuse otherwise)
 *   6. CREATE every table, index and trigger, one statement per request
 *   7. the FK-safe import (d1/importCore.mjs) and PRAGMA foreign_key_check == 0
 *   8. D1's sqlite_master == the one schema.sql builds locally, object by object
 *   9. d1/parity-check.mjs against live Supabase (read-only)
 * Re-running is safe: every step starts from scratch (DROP IF EXISTS).
 *
 * While 5-7 run the copy's tables are briefly empty. Run it only while the site
 * still reads Supabase (before the switch) — shadow reads will log mismatches
 * for those minutes and nothing else.
 *
 * Supabase is only read. Candidate rows travel from the export to D1 and are
 * never printed: the log carries table names and counts.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { deleteOrder, splitStatements } from "./fk.mjs";
import { importTables, preflight, sqliteRunner, isInside } from "./importCore.mjs";
import { d1HttpRunner, readEnv, DEFAULT_D1_DATABASE_ID } from "./import.mjs";
import { fetchLiveOpenApi, diffOpenApi } from "./check-drift.mjs";

export const D1_DATABASE_NAME = "borivon-db";

/**
 * Every object SQLite stores for the schema, minus its own bookkeeping
 * (sqlite_sequence, sqlite_autoindex_*) and D1's internal `_cf_*` tables.
 * substr, not LIKE: `_` is a LIKE wildcard, so `LIKE '_cf_%'` also matched any
 * table whose 2nd and 3rd letters happen to be "cf".
 */
const STRUCTURE_SQL =
  "SELECT type, name, tbl_name, sql FROM sqlite_master " +
  "WHERE substr(name, 1, 7) <> 'sqlite_' AND substr(name, 1, 4) <> '_cf_' ORDER BY type, name";
const TABLES_SQL =
  "SELECT name FROM sqlite_master WHERE type = 'table' " +
  "AND substr(name, 1, 7) <> 'sqlite_' AND substr(name, 1, 4) <> '_cf_' ORDER BY name";

const oneLine = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/** What schema.sql builds, as sqlite_master rows — the yardstick for step 8. */
export async function expectedStructure(schemaSql) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(":memory:");
  try {
    const run = sqliteRunner(db);
    for (const s of splitStatements(schemaSql)) run(s);
    return run(STRUCTURE_SQL).map((r) => ({ ...r, sql: oneLine(r.sql) }));
  } finally {
    db.close();
  }
}

/** Object-level differences between two sqlite_master listings (names only, never data). */
export function diffStructure(want, got) {
  const key = (r) => `${r.type} ${r.name}`;
  const W = new Map(want.map((r) => [key(r), r]));
  const G = new Map(got.map((r) => [key(r), { ...r, sql: oneLine(r.sql) }]));
  const out = [];
  for (const [k, r] of W) {
    if (!G.has(k)) out.push(`missing ${k}`);
    else if (G.get(k).sql !== r.sql) out.push(`different definition: ${k}`);
  }
  for (const k of G.keys()) if (!W.has(k)) out.push(`unexpected ${k}`);
  return out;
}

/** FOREIGN KEY count by ON DELETE action, as the database itself reports it. */
export async function foreignKeysByAction(run, tables) {
  const by = {};
  for (const t of tables) {
    for (const fk of await run(`PRAGMA foreign_key_list("${t}")`)) by[fk.on_delete] = (by[fk.on_delete] ?? 0) + 1;
  }
  return by;
}

/**
 * Steps 5-8 against any `run` (the D1 HTTP API or a local SQLite). Returns
 * { ok, stage, problems[] }. Refuses before the first DROP when the export
 * would not import cleanly.
 */
export async function rebuild({ run, types, schemaSql, dir, log = console.log }) {
  const { refusals } = preflight({ types, dir, requireMeta: true });
  if (refusals.length) {
    for (const r of refusals) log(`!! ${r}`);
    return { ok: false, stage: "preflight", problems: refusals };
  }

  const existing = (await run(TABLES_SQL)).map((r) => r.name);
  const unknown = existing.filter((t) => !types[t]);
  if (unknown.length) log(`note: leaving ${unknown.length} table(s) the schema does not define untouched: ${unknown.join(", ")}`);

  // 5. Children before parents. IF EXISTS so a re-run after a dropped
  // connection (the DROP landed, its answer did not) starts over cleanly.
  const present = new Set(existing);
  const drops = deleteOrder(types).filter((t) => present.has(t));
  for (const t of drops) await run(`DROP TABLE IF EXISTS "${t}"`);
  log(`dropped ${drops.length} table(s)`);

  // 6. One statement per request: a failure names the exact table or index.
  const statements = splitStatements(schemaSql);
  for (const s of statements) await run(s);
  log(`created ${statements.length} object(s) from d1/schema.sql`);

  // 7. Fill, parents first.
  const imported = await importTables({ run, types, dir, log });
  const problems = [];
  if (imported.problems) problems.push(`import: ${imported.problems} problem(s)`);
  const violations = await run("PRAGMA foreign_key_check");
  if (violations.length) problems.push(`${violations.length} foreign-key violation(s) in: ${[...new Set(violations.map((v) => v.table))].join(", ")}`);
  else log("ok  0 foreign-key violations");

  // 8. The copy holds exactly what schema.sql defines — the check that would
  // have caught CREATE IF NOT EXISTS quietly keeping the old tables.
  const drift = diffStructure(await expectedStructure(schemaSql), await run(STRUCTURE_SQL));
  if (drift.length) problems.push(...drift.map((d) => `structure: ${d}`));
  else log("ok  every table, index and trigger matches d1/schema.sql");
  log(`    foreign keys by ON DELETE: ${JSON.stringify(await foreignKeysByAction(run, Object.keys(types)))}`);

  for (const p of problems) log(`!! ${p}`);
  return { ok: problems.length === 0, stage: problems.length ? "verify" : "done", problems };
}

/** Steps 3-8 with 3 rehearsed in memory first; the gates are injected so tests can drive them. */
export async function gatedRebuild({ run, types, schemaSql, dir, checkDrift, bookmark, log = console.log }) {
  let diffs;
  try { diffs = await checkDrift(); } catch (e) { diffs = [`could not check drift: ${e.message}`]; }
  if (diffs.length) {
    for (const d of diffs) log(`!! drift: ${d}`);
    log("!! REFUSING: live Supabase has moved on from d1/snapshot/openapi.json — re-capture both snapshots and re-run d1/gen-schema.mjs first");
    return { ok: false, stage: "drift", problems: diffs };
  }
  log("ok  live Supabase structure matches the snapshot");

  const { DatabaseSync } = await import("node:sqlite");
  const scratch = new DatabaseSync(":memory:");
  let rehearsal;
  try {
    rehearsal = await rebuild({ run: sqliteRunner(scratch), types, schemaSql, dir, log: (m) => log(`   [rehearsal] ${m}`) });
  } finally {
    scratch.close();
  }
  if (!rehearsal.ok) {
    log("!! REFUSING: the rehearsal in a local SQLite failed — nothing was sent to D1");
    return { ...rehearsal, stage: `rehearsal/${rehearsal.stage}` };
  }
  log("ok  rehearsal passed");

  let mark;
  try { mark = await bookmark(); } catch (e) { mark = null; log(`!! bookmark: ${e.message}`); }
  if (!mark) {
    log("!! REFUSING: no Time Travel bookmark, so no way back — nothing was changed");
    return { ok: false, stage: "bookmark", problems: ["no bookmark"] };
  }
  log(`ok  rollback point: npx wrangler d1 time-travel restore ${D1_DATABASE_NAME} --bookmark=${mark}`);

  return { ...(await rebuild({ run, types, schemaSql, dir, log })), bookmark: mark };
}

/** The current D1 Time Travel bookmark (read-only GET). */
export async function d1Bookmark(env, database = process.env.D1_DATABASE_ID || DEFAULT_D1_DATABASE_ID) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${database}/time_travel/bookmark`,
    { method: "GET", headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` } },
  );
  const j = await res.json().catch(() => ({}));
  if (!j.success || typeof j.result?.bookmark !== "string") throw new Error(`HTTP ${res.status} ${JSON.stringify(j.errors ?? j).slice(0, 200)}`);
  return j.result.bookmark;
}

/** The plan, from files alone — no network, no database. */
export function planRebuild({ types, schemaSql, dir }) {
  const lines = [];
  const statements = splitStatements(schemaSql);
  const kinds = { TABLE: 0, INDEX: 0, TRIGGER: 0 };
  for (const s of statements) {
    const m = s.match(/^CREATE (?:UNIQUE )?(TABLE|INDEX|TRIGGER)\b/);
    if (m) kinds[m[1]]++;
  }
  const byAction = {};
  for (const t of Object.values(types)) for (const fk of t.fks ?? []) if (fk.on_delete) byAction[fk.on_delete] = (byAction[fk.on_delete] ?? 0) + 1;
  const authFks = Object.values(types).reduce((n, t) => n + (t.authFks?.length ?? 0), 0);
  const drops = deleteOrder(types);

  lines.push(`1. refuse unless live Supabase structure == d1/snapshot/openapi.json`);
  lines.push(`2. refuse unless the export is sound (columns, duplicate keys, orphans)`);
  lines.push(`3. rehearse steps 5-8 in an in-memory SQLite (foreign keys ON); refuse on any problem`);
  lines.push(`4. take a Time Travel bookmark of ${D1_DATABASE_NAME}; refuse without one`);
  lines.push(`5. DROP TABLE IF EXISTS, children first (${drops.length}): ${drops.join(", ")}`);
  lines.push(`6. CREATE ${kinds.TABLE} tables, ${kinds.INDEX} indexes, ${kinds.TRIGGER} trigger(s); foreign keys by ON DELETE ${JSON.stringify(byAction)}`);
  lines.push(`   (${authFks} foreign keys to auth.users are recorded in d1/types.json only — the auth tables are not in D1)`);

  if (!dir) {
    lines.push(`7. import: no export given — pass <export-dir> to see the insert order and checks`);
  } else {
    const pre = preflight({ types, dir, requireMeta: true });
    const refusals = pre.refusals;
    const rows = pre.plan.insertOrder.reduce((n, t) => n + Number(pre.counts[t] ?? 0), 0);
    const skipped = Object.entries(pre.counts).filter(([, v]) => v === "skipped").map(([t]) => t);
    lines.push(`7. import ${pre.plan.insertOrder.length} tables, ${rows} rows, parents first: ${pre.plan.insertOrder.join(", ")}`);
    if (skipped.length) lines.push(`   left empty on purpose (not exported): ${skipped.join(", ")}`);
    if (pre.meta?.exportedAt) lines.push(`   export taken ${pre.meta.exportedAt}`);
    lines.push(refusals.length ? `   !! the export would be REFUSED:\n${refusals.map((r) => `      - ${r}`).join("\n")}` : `   export checks: ok`);
  }
  lines.push(`8. verify: PRAGMA foreign_key_check empty, row counts == export, sqlite_master == schema.sql`);
  lines.push(`9. node d1/parity-check.mjs against live Supabase`);
  return lines;
}

/** argv → { mode: "dry" | "local" | "real", root, dir, localPath } | { error } */
export function parseArgs(argv) {
  const positional = [];
  let localPath = null, real = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--i-mean-it") real = true;
    else if (a === "--local") { localPath = argv[++i] ?? ""; }
    else if (a.startsWith("--")) return { error: `unknown option ${a}` };
    else positional.push(a);
  }
  const [root, dir] = positional;
  if (!root || positional.length > 2) return { error: "usage" };
  if (real && localPath !== null) return { error: "--local and --i-mean-it cannot be combined" };
  if (localPath === "") return { error: "--local needs a SQLite file path or :memory:" };
  if ((real || localPath !== null) && !dir) return { error: "an <export-dir> (from d1/export-data.mjs) is required to rebuild" };
  return { mode: real ? "real" : localPath !== null ? "local" : "dry", root, dir: dir ?? null, localPath };
}

const USAGE = [
  "usage:",
  "  node d1/rebuild.mjs <repo-root> [<export-dir>]                        dry run: print the plan",
  "  node d1/rebuild.mjs <repo-root> <export-dir> --local <file|:memory:>  rehearse into a local SQLite",
  "  node d1/rebuild.mjs <repo-root> <export-dir> --i-mean-it              rebuild the REAL D1 copy",
].join("\n");

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) { console.error(args.error === "usage" ? USAGE : `${args.error}\n${USAGE}`); process.exit(2); }
  const { mode, root, dir, localPath } = args;
  const types = JSON.parse(fs.readFileSync(path.join(root, "d1", "types.json"), "utf8"));
  const schemaSql = fs.readFileSync(path.join(root, "d1", "schema.sql"), "utf8");
  if (dir && isInside(root, dir)) { console.error("REFUSING: the export directory is inside the repo — it holds personal data."); process.exit(2); }

  if (mode === "dry") {
    const database = process.env.D1_DATABASE_ID || DEFAULT_D1_DATABASE_ID;
    console.log(`DRY RUN — nothing is read from or written to any database.\ntarget: D1 ${D1_DATABASE_NAME} (${database})\n`);
    for (const l of planRebuild({ types, schemaSql, dir })) console.log(l);
    console.log(`\nrehearse:  node d1/rebuild.mjs ${root} ${dir ?? "<export-dir>"} --local :memory:`);
    console.log(`for real:  node d1/rebuild.mjs ${root} ${dir ?? "<export-dir>"} --i-mean-it`);
    process.exit(0);
  }

  if (mode === "local") {
    if (localPath !== ":memory:" && isInside(root, localPath)) { console.error("REFUSING: the SQLite file would hold personal data inside the repo."); process.exit(2); }
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(localPath);
    const out = await rebuild({ run: sqliteRunner(db), types, schemaSql, dir });
    db.close();
    console.log(`\nlocal rebuild ${out.ok ? "OK" : `FAILED at ${out.stage}`}`);
    process.exit(out.ok ? 0 : 1);
  }

  const env = readEnv(root);
  const database = process.env.D1_DATABASE_ID || DEFAULT_D1_DATABASE_ID;
  console.log(`REBUILDING the real D1 copy ${D1_DATABASE_NAME} (${database})\n`);
  const out = await gatedRebuild({
    run: d1HttpRunner(env, database),
    types, schemaSql, dir,
    checkDrift: async () => diffOpenApi(await fetchLiveOpenApi(env), JSON.parse(fs.readFileSync(path.join(root, "d1", "snapshot", "openapi.json"), "utf8"))),
    bookmark: () => d1Bookmark(env, database),
  });
  if (!out.ok) {
    console.log(`\nREBUILD FAILED at ${out.stage}.`);
    if (out.bookmark) console.log(`Undo: npx wrangler d1 time-travel restore ${D1_DATABASE_NAME} --bookmark=${out.bookmark}   (or fix and re-run — every step starts over)`);
    process.exit(1);
  }
  console.log("\nrebuild OK — comparing against live Supabase (rows written since the export show up as differences):\n");
  const parity = spawnSync(process.execPath, [path.join(root, "d1", "parity-check.mjs"), root], { stdio: "inherit" });
  console.log(`\nparity exit ${parity.status}. Undo if needed: npx wrangler d1 time-travel restore ${D1_DATABASE_NAME} --bookmark=${out.bookmark}`);
  process.exit(parity.status === 0 ? 0 : 1);
}
