/**
 * Rebuild the D1 copy from d1/schema.sql and refill it from an export: the
 * runbook step that gives the copy its foreign keys, its jsonb/array defaults
 * and the current CHECKs.
 *
 * A PRE-SWITCH TOOL ONLY. It drops every table and refills them from Supabase,
 * which is right while Supabase is the primary and D1 a copy — and would erase
 * every row written since if D1 were already the live database. Gates 2 and 5
 * refuse in that case; after the switch, schema changes are migrations applied
 * to D1 itself, never a rebuild.
 *
 * Why a rebuild and not a migration (today): SQLite's ALTER TABLE cannot add a
 * FOREIGN KEY, a CHECK or a DEFAULT to an existing table. The copy was created
 * before gen-schema knew them, and every statement in schema.sql is
 * `CREATE … IF NOT EXISTS` — so applying the new file to the old copy is a
 * silent no-op: zero foreign keys, the 16 defaults still missing (inserts that
 * leave them out still fail with 23502), and every tool reporting success.
 *
 *   node d1/rebuild.mjs <repo-root> [<export-dir>]                        DRY RUN (default): print the plan, touch nothing
 *   node d1/rebuild.mjs <repo-root> <export-dir> --local <file|:memory:>  full rehearsal into a local SQLite
 *   node d1/rebuild.mjs <repo-root> <export-dir> --i-mean-it              the REAL D1 copy
 *        [--accept-newer-in=<table>[,<table>…]]                           see gate 5
 *
 * The real run, in order. Every gate refuses before the first write:
 *   0. d1/schema.sql + d1/types.json are exactly what the committed snapshots
 *      generate (d1/guards.mjs generatedProblems) — a re-captured snapshot with
 *      no re-generation would otherwise apply the OLD schema and pass gate 1
 *   1. live Supabase structure == d1/snapshot/openapi.json (d1/check-drift.mjs)
 *   2. the site still reads Supabase: DATA_BACKEND absent or "supabase" in
 *      wrangler.jsonc, .env.local AND the deployed Worker's settings
 *   3. the export is at most 30 minutes old, and sound: taken with this
 *      types.json (_meta.json columns), no duplicate keys, no orphan child rows
 *   4. steps 7-10 rehearsed in full in an in-memory SQLite with foreign keys ON
 *   5. D1 holds no row newer than the export (read-only created_at/updated_at
 *      probe) — the data-level proof that nothing but an import ever wrote to it
 *   6. a D1 Time Travel bookmark of the copy as it is now, printed with the
 *      restore command — the one-line undo
 * then the writes:
 *   7. DROP every table the schema defines, children before parents (a DROP
 *      runs an implicit DELETE, which would cascade or refuse otherwise)
 *   8. CREATE every table, index and trigger, one statement per request
 *   9. the FK-safe import (d1/importCore.mjs) and PRAGMA foreign_key_check == 0
 *  10. D1's sqlite_master == the one schema.sql builds locally, object by object
 *  11. d1/parity-check.mjs against live Supabase (read-only)
 * Re-running is safe: every step starts from scratch (DROP IF EXISTS). A failure
 * in 7-10 is reported with its stage and the restore command, never a crash.
 *
 * While 7-9 run the copy's tables are briefly empty; shadow reads log
 * mismatches for those minutes and nothing else.
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
import { d1HttpRunner, DEFAULT_D1_DATABASE_ID } from "./import.mjs";
import { fetchLiveOpenApi, diffOpenApi } from "./check-drift.mjs";
import {
  generatedProblems, readBackendProblems, backendProblems, exportAgeProblems, d1NewerRows,
  readEnvFile, MAX_EXPORT_AGE_MIN,
} from "./guards.mjs";

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
const message = (e) => String(e?.message ?? e).slice(0, 300);

/** What schema.sql builds, as sqlite_master rows — the yardstick for step 10. */
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
 * Steps 7-10 against any `run` (the D1 HTTP API or a local SQLite). Returns
 * { ok, stage, problems[] }. Refuses before the first DROP when the export
 * would not import cleanly.
 *
 * Every database call sits inside one try: over HTTP a DROP or CREATE can fail
 * after its retries, and an escaped rejection used to end the CLI in a stack
 * trace — with the tables half-dropped and the undo line never printed.
 */
export async function rebuild({ run, types, schemaSql, dir, log = console.log }) {
  const { refusals } = preflight({ types, dir, requireMeta: true });
  if (refusals.length) {
    for (const r of refusals) log(`!! ${r}`);
    return { ok: false, stage: "preflight", problems: refusals };
  }

  let stage = "inspect";
  try {
    const existing = (await run(TABLES_SQL)).map((r) => r.name);
    const unknown = existing.filter((t) => !types[t]);
    if (unknown.length) log(`note: leaving ${unknown.length} table(s) the schema does not define untouched: ${unknown.join(", ")}`);

    // 7. Children before parents. IF EXISTS so a re-run after a dropped
    // connection (the DROP landed, its answer did not) starts over cleanly.
    stage = "drop";
    const present = new Set(existing);
    const drops = deleteOrder(types).filter((t) => present.has(t));
    for (const t of drops) await run(`DROP TABLE IF EXISTS "${t}"`);
    log(`dropped ${drops.length} table(s)`);

    // 8. One statement per request: a failure names the exact table or index.
    stage = "create";
    const statements = splitStatements(schemaSql);
    for (const s of statements) await run(s);
    log(`created ${statements.length} object(s) from d1/schema.sql`);

    // 9. Fill, parents first.
    stage = "import";
    const imported = await importTables({ run, types, dir, log });
    const problems = [];
    if (imported.problems) problems.push(`import: ${imported.problems} problem(s)`);

    stage = "verify";
    const violations = await run("PRAGMA foreign_key_check");
    if (violations.length) problems.push(`${violations.length} foreign-key violation(s) in: ${[...new Set(violations.map((v) => v.table))].join(", ")}`);
    else log("ok  0 foreign-key violations");

    // 10. The copy holds exactly what schema.sql defines — the check that would
    // have caught CREATE IF NOT EXISTS quietly keeping the old tables.
    const drift = diffStructure(await expectedStructure(schemaSql), await run(STRUCTURE_SQL));
    if (drift.length) problems.push(...drift.map((d) => `structure: ${d}`));
    else log("ok  every table, index and trigger matches d1/schema.sql");
    log(`    foreign keys by ON DELETE: ${JSON.stringify(await foreignKeysByAction(run, Object.keys(types)))}`);

    for (const p of problems) log(`!! ${p}`);
    return { ok: problems.length === 0, stage: problems.length ? (imported.problems ? "import" : "verify") : "done", problems };
  } catch (e) {
    const problem = `${stage} failed: ${message(e)}`;
    log(`!! ${problem}`);
    return { ok: false, stage, problems: [problem] };
  }
}

/**
 * Gates 0-6, then steps 7-10. The gates are injected so tests can drive each
 * one; a gate left out refuses rather than being skipped.
 *
 * @param {{
 *   run: (sql: string, params?: unknown[]) => any, types: Record<string, any>, schemaSql: string, dir: string,
 *   checkGenerated: () => string[] | Promise<string[]>, checkDrift: () => Promise<string[]>,
 *   checkBackend: () => Promise<string[]>, bookmark: () => Promise<string>,
 *   now?: number, maxExportAgeMin?: number, acceptNewerIn?: string[], log?: (m: string) => void,
 * }} opts
 */
export async function gatedRebuild({
  run, types, schemaSql, dir, checkGenerated, checkDrift, checkBackend, bookmark,
  now = Date.now(), maxExportAgeMin = MAX_EXPORT_AGE_MIN, acceptNewerIn = [], log = console.log,
}) {
  const refuse = (stage, problems, why) => {
    for (const p of problems) log(`!! ${stage}: ${p}`);
    log(`!! REFUSING: ${why} — nothing was changed`);
    return { ok: false, stage, problems };
  };
  const gate = async (fn) => {
    if (typeof fn !== "function") return ["this gate was not provided"];
    try { return await fn(); } catch (e) { return [`could not check: ${message(e)}`]; }
  };

  const stale = await gate(checkGenerated);
  if (stale.length) return refuse("generated", stale, "d1/schema.sql / d1/types.json are not what the snapshots generate");
  log("ok  d1/schema.sql and d1/types.json are what the snapshots generate");

  const diffs = await gate(checkDrift);
  if (diffs.length) return refuse("drift", diffs, "live Supabase has moved on from d1/snapshot/openapi.json — re-capture both snapshots and re-run d1/gen-schema.mjs first");
  log("ok  live Supabase structure matches the snapshot");

  const backend = await gate(checkBackend);
  if (backend.length) return refuse("backend", backend, "the site may already read D1 — a rebuild from a Supabase export would erase D1's own writes");
  log("ok  the site still reads Supabase (wrangler.jsonc, .env.local, deployed Worker)");

  const metaFile = path.join(dir, "_meta.json");
  const meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, "utf8")) : null;
  const age = exportAgeProblems(meta, now, maxExportAgeMin);
  if (age.length) return refuse("export-age", age, "the export is not fresh");
  log(`ok  export taken ${meta.exportedAt}`);

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

  let newer;
  try { newer = await d1NewerRows({ run, types, dir, exportedAt: meta.exportedAt, acceptNewerIn }); }
  catch (e) { newer = { problems: [`could not probe D1: ${message(e)}`], notes: [] }; }
  for (const n of newer.notes) log(`    ${n}`);
  if (newer.problems.length) return refuse("d1-newer", newer.problems, "D1 holds rows the export does not — dropping it would lose them");
  log(`ok  D1 holds nothing newer than the export (${newer.probed} tables probed)`);

  let mark;
  try { mark = await bookmark(); } catch (e) { mark = null; log(`!! bookmark: ${message(e)}`); }
  if (!mark) return refuse("bookmark", ["no Time Travel bookmark"], "no bookmark, so no way back");
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

/**
 * The plan, from files alone — no network, no database. With `root` it also
 * shows what the local gates would say today (generated files, the backend in
 * wrangler.jsonc / .env.local, the export's age).
 *
 * @param {{ types: Record<string, any>, schemaSql: string, dir?: string | null, root?: string | null, now?: number }} opts
 */
export function planRebuild({ types, schemaSql, dir = null, root = null, now = Date.now() }) {
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
  const verdict = (problems) => (problems.length ? `REFUSED today:\n${problems.map((p) => `      - ${p}`).join("\n")}` : "ok today");

  let generated = "not checked (no repo root)";
  let backend = "not checked (no repo root)";
  if (root) {
    try { generated = verdict(generatedProblems(root)); } catch (e) { generated = `REFUSED today: could not regenerate (${message(e)})`; }
    const readOrNull = (f) => { try { return fs.readFileSync(path.join(root, f), "utf8"); } catch { return null; } };
    const local = backendProblems({ wranglerText: readOrNull("wrangler.jsonc"), envLocalText: readOrNull(".env.local"), deployed: { bindings: [] } });
    backend = `${verdict(local)} for wrangler.jsonc + .env.local (the deployed Worker is read at run time)`;
  }
  lines.push(`0. refuse unless d1/schema.sql + d1/types.json are what the snapshots generate: ${generated}`);
  lines.push(`1. refuse unless live Supabase structure == d1/snapshot/openapi.json`);
  lines.push(`2. refuse unless the site still reads Supabase (DATA_BACKEND absent or "supabase"): ${backend}`);

  let pre = null;
  if (dir) {
    pre = preflight({ types, dir, requireMeta: true });
    const age = exportAgeProblems(pre.meta, now);
    lines.push(`3. refuse unless the export is at most ${MAX_EXPORT_AGE_MIN} minutes old and sound: ${verdict([...age, ...pre.refusals])}`);
  } else {
    lines.push(`3. refuse unless the export is at most ${MAX_EXPORT_AGE_MIN} minutes old and sound (columns, duplicate keys, orphans)`);
  }
  lines.push(`4. rehearse steps 7-10 in an in-memory SQLite (foreign keys ON); refuse on any problem`);
  const probed = Object.values(types).filter((t) => t.pk?.length && (t.columns.created_at?.pg === "timestamptz" || t.columns.updated_at?.pg === "timestamptz")).length;
  lines.push(`5. refuse if D1 holds rows newer than the export (read-only created_at/updated_at probe of ${probed} tables)`);
  lines.push(`6. take a Time Travel bookmark of ${D1_DATABASE_NAME}; refuse without one`);
  lines.push(`7. DROP TABLE IF EXISTS, children first (${drops.length}): ${drops.join(", ")}`);
  lines.push(`8. CREATE ${kinds.TABLE} tables, ${kinds.INDEX} indexes, ${kinds.TRIGGER} trigger(s); foreign keys by ON DELETE ${JSON.stringify(byAction)}`);
  lines.push(`   (${authFks} foreign keys to auth.users are recorded in d1/types.json only — the auth tables are not in D1)`);

  if (!pre) {
    lines.push(`9. import: no export given — pass <export-dir> to see the insert order and checks`);
  } else {
    const rows = pre.plan.insertOrder.reduce((n, t) => n + Number(pre.counts[t] ?? 0), 0);
    const skipped = Object.entries(pre.counts).filter(([, v]) => v === "skipped").map(([t]) => t);
    lines.push(`9. import ${pre.plan.insertOrder.length} tables, ${rows} rows, parents first: ${pre.plan.insertOrder.join(", ")}`);
    if (skipped.length) lines.push(`   left empty on purpose (not exported): ${skipped.join(", ")}`);
    if (pre.meta?.exportedAt) lines.push(`   export taken ${pre.meta.exportedAt}`);
  }
  lines.push(`10. verify: PRAGMA foreign_key_check empty, row counts == export, sqlite_master == schema.sql`);
  lines.push(`11. node d1/parity-check.mjs against live Supabase`);
  return lines;
}

/** argv → { mode: "dry" | "local" | "real", root, dir, localPath, acceptNewerIn } | { error } */
export function parseArgs(argv) {
  const positional = [];
  let localPath = null, real = false;
  const acceptNewerIn = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--i-mean-it") real = true;
    else if (a === "--local") { localPath = argv[++i] ?? ""; }
    else if (a.startsWith("--accept-newer-in=")) acceptNewerIn.push(...a.slice("--accept-newer-in=".length).split(",").filter(Boolean));
    else if (a.startsWith("--")) return { error: `unknown option ${a}` };
    else positional.push(a);
  }
  const [root, dir] = positional;
  if (!root || positional.length > 2) return { error: "usage" };
  if (real && localPath !== null) return { error: "--local and --i-mean-it cannot be combined" };
  if (localPath === "") return { error: "--local needs a SQLite file path or :memory:" };
  if ((real || localPath !== null) && !dir) return { error: "an <export-dir> (from d1/export-data.mjs) is required to rebuild" };
  return { mode: real ? "real" : localPath !== null ? "local" : "dry", root, dir: dir ?? null, localPath, acceptNewerIn };
}

const USAGE = [
  "usage:",
  "  node d1/rebuild.mjs <repo-root> [<export-dir>]                        dry run: print the plan",
  "  node d1/rebuild.mjs <repo-root> <export-dir> --local <file|:memory:>  rehearse into a local SQLite",
  "  node d1/rebuild.mjs <repo-root> <export-dir> --i-mean-it              rebuild the REAL D1 copy (before the switch only)",
  "       [--accept-newer-in=<table>[,<table>…]]                           only after checking those rows were deleted from Supabase",
].join("\n");

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) { console.error(args.error === "usage" ? USAGE : `${args.error}\n${USAGE}`); process.exit(2); }
  const { mode, root, dir, localPath, acceptNewerIn } = args;
  let types, schemaSql;
  try {
    types = JSON.parse(fs.readFileSync(path.join(root, "d1", "types.json"), "utf8"));
    schemaSql = fs.readFileSync(path.join(root, "d1", "schema.sql"), "utf8");
  } catch (e) { console.error(`REFUSING: could not read d1/types.json or d1/schema.sql under ${root}: ${message(e)}`); process.exit(2); }
  if (dir && isInside(root, dir)) { console.error("REFUSING: the export directory is inside the repo — it holds personal data."); process.exit(2); }

  if (mode === "dry") {
    const database = process.env.D1_DATABASE_ID || DEFAULT_D1_DATABASE_ID;
    console.log(`DRY RUN — nothing is read from or written to any database.\ntarget: D1 ${D1_DATABASE_NAME} (${database})\n`);
    for (const l of planRebuild({ types, schemaSql, dir, root })) console.log(l);
    console.log(`\nrehearse:  node d1/rebuild.mjs ${root} ${dir ?? "<export-dir>"} --local :memory:`);
    console.log(`for real:  node d1/rebuild.mjs ${root} ${dir ?? "<export-dir>"} --i-mean-it   (before the switch only)`);
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

  let env;
  try { env = readEnvFile(root); } catch (e) { console.error(`REFUSING: could not read ${path.join(root, ".env.local")}: ${message(e)}`); process.exit(2); }
  const database = process.env.D1_DATABASE_ID || DEFAULT_D1_DATABASE_ID;
  console.log(`REBUILDING the real D1 copy ${D1_DATABASE_NAME} (${database})\n`);
  let out;
  try {
    out = await gatedRebuild({
      run: d1HttpRunner(env, database),
      types, schemaSql, dir, acceptNewerIn,
      checkGenerated: () => generatedProblems(root),
      checkDrift: async () => diffOpenApi(await fetchLiveOpenApi(env), JSON.parse(fs.readFileSync(path.join(root, "d1", "snapshot", "openapi.json"), "utf8"))),
      checkBackend: () => readBackendProblems(root, env),
      bookmark: () => d1Bookmark(env, database),
    });
  } catch (e) {
    // Not expected — every stage reports its own failure — but a crash must still
    // end with what to do, not a stack trace.
    out = { ok: false, stage: `unexpected (${message(e)})`, problems: [message(e)] };
    console.log("If a rollback point was printed above, restore it with the command on that line.");
  }
  if (!out.ok) {
    console.log(`\nREBUILD FAILED at ${out.stage}.`);
    if (out.bookmark) console.log(`Undo: npx wrangler d1 time-travel restore ${D1_DATABASE_NAME} --bookmark=${out.bookmark}   (or fix and re-run — every step starts over)`);
    else if (!String(out.stage).startsWith("unexpected")) console.log("Nothing was written to D1.");
    process.exit(1);
  }
  console.log("\nrebuild OK — comparing against live Supabase (rows written since the export show up as differences):\n");
  const parity = spawnSync(process.execPath, [path.join(root, "d1", "parity-check.mjs"), root], { stdio: "inherit" });
  console.log(`\nparity exit ${parity.status}. Undo if needed: npx wrangler d1 time-travel restore ${D1_DATABASE_NAME} --bookmark=${out.bookmark}`);
  process.exit(parity.status === 0 ? 0 : 1);
}
