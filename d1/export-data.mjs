/**
 * Export the live Supabase rows as D1-ready SQL (step 2: copy, don't switch).
 *
 * READ-ONLY against Supabase (GET and HEAD only). Writes one .sql + one .json
 * file per table into an output directory you pass in — NEVER into the repo:
 * these files contain candidate personal data (passports, addresses, CV drafts).
 * Point it at a scratch directory and delete it when the import is done.
 *
 *   node d1/export-data.mjs <repo-root> <out-dir>
 *   node d1/import.mjs <repo-root> <out-dir>        (or d1/rebuild.mjs)
 *
 * Encoding matches d1/types.json and the schema generator:
 *   boolean → 0/1 · jsonb / text[] / uuid[] → JSON text · everything else as-is.
 * Rows are ordered by primary key and paged past PostgREST's 1000-row cap, so
 * nothing is silently dropped (the cap bit us for real — see lib/readAllRows).
 *
 * _meta.json records, per table, the column order the row arrays use and
 * Postgres' exact row count, so the importers can refuse an export taken with a
 * different types.json (positional rows would land in the wrong columns) or one
 * that raced live writes (see readConsistently).
 *
 * `rate_limits` is skipped on purpose: an ephemeral spam counter, 24k rows,
 * rebuilt in minutes.
 */
import fs from "node:fs";
import path from "node:path";
import { deleteOrder } from "./fk.mjs";
import { isInside, tableColumns } from "./importCore.mjs";

const SKIP_TABLES = new Set(["rate_limits"]);
const ROWS_PER_STATEMENT = 100;      // keeps each INSERT well under D1's 100 KB statement cap
const PAGE = 1000;                   // PostgREST hard cap
const ATTEMPTS = 3;

const root = process.argv[2];
const outDir = process.argv[3];
if (!root || !outDir) { console.error("usage: node d1/export-data.mjs <repo-root> <out-dir>"); process.exit(1); }
if (isInside(root, outDir)) {
  console.error("REFUSING: the output directory is inside the repo — these files hold personal data.");
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

const env = Object.fromEntries(
  fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }),
);
const url = env.NEXT_PUBLIC_SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
const headers = { apikey: key, Authorization: `Bearer ${key}` };
const types = JSON.parse(fs.readFileSync(path.join(root, "d1", "types.json"), "utf8"));

const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;

function encode(value, pg) {
  if (value === null || value === undefined) return "NULL";
  if (pg === "boolean") return value ? "1" : "0";
  if (pg === "jsonb" || pg === "text[]" || pg === "uuid[]") return lit(JSON.stringify(value));
  if (typeof value === "object") return lit(JSON.stringify(value));
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  return lit(value);
}

/** The same value, as a bound parameter for the HTTP import (d1/import.mjs). */
function encodeParam(value, pg) {
  if (value === null || value === undefined) return null;
  if (pg === "boolean") return value ? 1 : 0;
  if (pg === "jsonb" || pg === "text[]" || pg === "uuid[]") return JSON.stringify(value);
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  return value;
}

/** Postgres' own row count (HEAD + Prefer: count=exact → Content-Range "…/N"). */
async function exactCount(table) {
  const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, { method: "HEAD", headers: { ...headers, Prefer: "count=exact" } });
  const total = Number((res.headers.get("content-range") ?? "").split("/")[1]);
  if (!res.ok || !Number.isFinite(total)) throw new Error(`${table}: count failed ${res.status}`);
  return total;
}

async function readAll(table, cols, order) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(`${url}/rest/v1/${table}?select=${cols.join(",")}&order=${order}&offset=${from}&limit=${PAGE}`, { headers });
    if (!res.ok) throw new Error(`${table}: read failed ${res.status} ${(await res.text()).slice(0, 120)}`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

/**
 * Read a table until one pass is self-consistent: the exact count before and
 * after the read agree with the rows received, and no primary key repeats.
 * Offset paging over a live table is not a snapshot — a row inserted ahead of
 * the cursor shifts the next page, so one row comes back twice (a UNIQUE
 * failure mid-import) or, after a delete, one is never seen (a silent gap).
 */
async function readConsistently(table, cols, pk) {
  const order = pk.map((c) => `${c}.asc`).join(",");
  let last;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const before = await exactCount(table);
    const rows = await readAll(table, cols, order);
    const after = await exactCount(table);
    const keys = new Set(rows.map((r) => JSON.stringify(pk.map((c) => r[c]))));
    last = { rows, live: after, stable: before === after && after === rows.length && keys.size === rows.length };
    if (last.stable) return last;
  }
  return last;
}

const summary = [];
const meta = { exportedAt: new Date().toISOString(), columns: {}, liveCounts: {}, unstable: [] };
// Children before parents. The export reads one table at a time, so rows can
// change between two reads; read in this order, only a parent DELETE in that
// window leaves an orphan (a new parent+child pair is caught whole or not at
// all), and parent deletes are far rarer than inserts. d1/importCore.mjs
// refuses an export with orphans before it touches anything.
for (const table of deleteOrder(types)) {
  if (SKIP_TABLES.has(table)) {
    meta.liveCounts[table] = await exactCount(table);
    summary.push(`${table}: skipped`);
    continue;
  }
  const cols = tableColumns(types, table);
  const pk = types[table].pk.length ? types[table].pk : [cols[0]];
  let read;
  try { read = await readConsistently(table, cols, pk); } catch (e) { console.error(e.message); process.exit(1); }
  const { rows, live, stable } = read;
  meta.columns[table] = cols;
  meta.liveCounts[table] = live;
  if (!stable) meta.unstable.push(table);

  const out = [`-- ${table}: ${rows.length} rows, exported ${new Date().toISOString()}`];
  for (let i = 0; i < rows.length; i += ROWS_PER_STATEMENT) {
    const chunk = rows.slice(i, i + ROWS_PER_STATEMENT);
    const values = chunk.map((r) => `(${cols.map((c) => encode(r[c], types[table].columns[c].pg)).join(",")})`);
    out.push(`INSERT INTO ${q(table)} (${cols.map(q).join(",")}) VALUES\n${values.join(",\n")};`);
  }
  fs.writeFileSync(path.join(outDir, `${table}.sql`), out.join("\n") + "\n");
  // Same rows as bound parameters — d1/import.mjs sends these over the HTTP API,
  // which is the only way to import rows bigger than D1's ~100 KB statement cap
  // (candidate_profiles' cv_draft + signatures, messages' inline attachments,
  // organizations' logo data URL all exceed it).
  fs.writeFileSync(
    path.join(outDir, `${table}.json`),
    JSON.stringify(rows.map((r) => cols.map((c) => encodeParam(r[c], types[table].columns[c].pg)))),
  );
  summary.push(`${table}: ${rows.length}`);
}
fs.writeFileSync(path.join(outDir, "_counts.json"), JSON.stringify(Object.fromEntries(summary.map((s) => s.split(": "))), null, 1) + "\n");
fs.writeFileSync(path.join(outDir, "_meta.json"), JSON.stringify(meta, null, 1) + "\n");
console.log(summary.join("\n"));
console.log(`\nwrote ${summary.length} tables to ${outDir}`);
if (meta.unstable.length) {
  console.log(`!! ${meta.unstable.length} table(s) kept changing while read (${meta.unstable.join(", ")}) — the importers will refuse this export; re-run it`);
  process.exit(1);
}
