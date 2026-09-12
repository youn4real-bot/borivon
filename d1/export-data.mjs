/**
 * Export the live Supabase rows as D1-ready SQL (step 2: copy, don't switch).
 *
 * READ-ONLY against Supabase. Writes one .sql file per table into an output
 * directory you pass in — NEVER into the repo: these files contain candidate
 * personal data (passports, addresses, CV drafts). Point it at a scratch
 * directory and delete them when the import is done.
 *
 *   node d1/export-data.mjs <repo-root> <out-dir>
 *   npx wrangler d1 execute borivon-db --remote --file=<out-dir>/<table>.sql
 *
 * Encoding matches d1/types.json and the schema generator:
 *   boolean → 0/1 · jsonb / text[] / uuid[] → JSON text · everything else as-is.
 * Rows are ordered by primary key and paged past PostgREST's 1000-row cap, so
 * nothing is silently dropped (the cap bit us for real — see lib/readAllRows).
 *
 * `rate_limits` is skipped on purpose: an ephemeral spam counter, 24k rows,
 * rebuilt in minutes.
 */
import fs from "node:fs";
import path from "node:path";

const SKIP_TABLES = new Set(["rate_limits"]);
const ROWS_PER_STATEMENT = 100;      // keeps each INSERT well under D1's 100 KB statement cap
const PAGE = 1000;                   // PostgREST hard cap

const root = process.argv[2];
const outDir = process.argv[3];
if (!root || !outDir) { console.error("usage: node d1/export-data.mjs <repo-root> <out-dir>"); process.exit(1); }
if (path.resolve(outDir).startsWith(path.resolve(root))) {
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

const summary = [];
for (const table of Object.keys(types).sort()) {
  if (SKIP_TABLES.has(table)) { summary.push(`${table}: skipped`); continue; }
  const cols = Object.entries(types[table].columns).filter(([, c]) => !c.generated).map(([n]) => n);
  const pk = types[table].pk.length ? types[table].pk : [cols[0]];
  const order = pk.map((c) => `${c}.asc`).join(",");

  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(`${url}/rest/v1/${table}?select=${cols.join(",")}&order=${order}&offset=${from}&limit=${PAGE}`, { headers });
    if (!res.ok) { console.error(`${table}: read failed ${res.status} ${(await res.text()).slice(0, 120)}`); process.exit(1); }
    const page = await res.json();
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  const out = [`-- ${table}: ${rows.length} rows, exported ${new Date().toISOString()}`];
  for (let i = 0; i < rows.length; i += ROWS_PER_STATEMENT) {
    const chunk = rows.slice(i, i + ROWS_PER_STATEMENT);
    const values = chunk.map((r) => `(${cols.map((c) => encode(r[c], types[table].columns[c].pg)).join(",")})`);
    out.push(`INSERT INTO ${q(table)} (${cols.map(q).join(",")}) VALUES\n${values.join(",\n")};`);
  }
  fs.writeFileSync(path.join(outDir, `${table}.sql`), out.join("\n") + "\n");
  summary.push(`${table}: ${rows.length}`);
}
fs.writeFileSync(path.join(outDir, "_counts.json"), JSON.stringify(Object.fromEntries(summary.map((s) => s.split(": "))), null, 1) + "\n");
console.log(summary.join("\n"));
console.log(`\nwrote ${summary.length} files to ${outDir}`);
