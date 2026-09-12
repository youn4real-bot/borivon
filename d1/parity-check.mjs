/**
 * Compare the D1 copy against live Supabase, row by row (step 3: test, don't switch).
 *
 *   node d1/parity-check.mjs <repo-root> [table…]
 *
 * For every table it reads ALL rows from both sides (paged past PostgREST's
 * 1000-row cap), orders them by primary key, normalises both to the same
 * shape, and compares a SHA-256 fingerprint per table. A mismatch prints the
 * first differing row's key and which columns differ — never the values, which
 * are candidate personal data.
 *
 * READ-ONLY on both sides. Rows written to Supabase after the copy will show
 * up as differences; that is the point — it is how we know the copy is stale
 * and must be refreshed before a cutover.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = process.argv[2];
const only = process.argv.slice(3);
if (!root) { console.error("usage: node d1/parity-check.mjs <repo-root> [table…]"); process.exit(1); }

const env = Object.fromEntries(
  fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }),
);
const SB = env.NEXT_PUBLIC_SUPABASE_URL, SB_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const DB = process.env.D1_DATABASE_ID || "ffb9dcff-a501-4dc2-a94a-e5301e2595f0";
const API = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${DB}/query`;

const types = JSON.parse(fs.readFileSync(path.join(root, "d1", "types.json"), "utf8"));
const SKIP = new Set(["rate_limits"]);

async function d1(sql, params = []) {
  const res = await fetch(API, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sql, params }),
  });
  const j = await res.json().catch(() => ({}));
  if (!j.success) throw new Error(JSON.stringify(j.errors ?? j).slice(0, 200));
  return j.result[0].results;
}

/** One canonical string per value, so Postgres and SQLite forms compare equal. */
function norm(v, pg) {
  if (v === null || v === undefined) return "∅";
  if (pg === "boolean") return v === true || v === 1 || v === "1" || v === "true" ? "1" : "0";
  if (pg === "jsonb" || pg === "text[]" || pg === "uuid[]") {
    const parsed = typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { return v; } })() : v;
    return JSON.stringify(parsed);
  }
  if (pg === "integer" || pg === "bigint") return String(Number(v));
  if (pg === "numeric") return String(Number(v));
  if (pg === "timestamptz") {
    const t = Date.parse(String(v));
    return Number.isFinite(t) ? String(t) : String(v);   // ignore fraction/offset formatting
  }
  return String(v);
}

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
const tables = (only.length ? only : Object.keys(types).sort()).filter((t) => !SKIP.has(t));
let bad = 0, rowsChecked = 0;

for (const table of tables) {
  const cols = Object.entries(types[table].columns).filter(([, c]) => !c.generated).map(([n]) => n);
  const pk = types[table].pk.length ? types[table].pk : [cols[0]];
  const order = pk.map((c) => `${c}.asc`).join(",");

  // Supabase, paged.
  const sbRows = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${SB}/rest/v1/${table}?select=${cols.join(",")}&order=${order}&offset=${from}&limit=1000`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    });
    if (!r.ok) { console.log(`!! ${table}: Supabase read ${r.status}`); bad++; break; }
    const page = await r.json();
    sbRows.push(...page);
    if (page.length < 1000) break;
  }

  // D1, paged the same way.
  const d1Rows = [];
  for (let off = 0; ; off += 1000) {
    const page = await d1(`SELECT ${cols.map((c) => `"${c}"`).join(",")} FROM "${table}" ORDER BY ${pk.map((c) => `"${c}"`).join(",")} LIMIT 1000 OFFSET ${off}`);
    d1Rows.push(...page);
    if (page.length < 1000) break;
  }

  // Per-column normalised values, so a difference can be named precisely.
  const cells = (row) => cols.map((c) => norm(row[c], types[table].columns[c].pg));
  const A = sbRows.map(cells), B = d1Rows.map(cells);
  const a = A.map((r) => r.join(String.fromCharCode(31))), b = B.map((r) => r.join(String.fromCharCode(31)));
  rowsChecked += a.length;

  if (a.length !== b.length) { console.log(`!! ${table}: Supabase ${a.length} rows, D1 ${b.length}`); bad++; continue; }
  const ha = sha(a.join(String.fromCharCode(10))), hb = sha(b.join(String.fromCharCode(10)));
  if (ha === hb) { console.log(`ok  ${table}: ${a.length} rows  ${ha}`); continue; }

  bad++;
  // WHICH rows and WHICH columns differ — never the values (personal data).
  const examples = [];
  const colHits = new Map();
  let differing = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    differing++;
    const changed = cols.filter((c, n) => A[i][n] !== B[i][n]);
    for (const c of changed) colHits.set(c, (colHits.get(c) ?? 0) + 1);
    if (examples.length < 3) examples.push(`${pk.map((c) => String(sbRows[i][c])).join("/")} [${changed.join(", ")}]`);
  }
  const worst = [...colHits.entries()].sort((x, y) => y[1] - x[1]).map(([c, n]) => `${c}×${n}`).join(", ");
  console.log(`!! ${table}: ${differing} of ${a.length} rows differ — columns: ${worst || "row order"}; e.g. ${examples.join(" | ")}`);
}

console.log(`\n${tables.length} tables, ${rowsChecked} rows compared, ${bad} mismatch(es)`);
process.exit(bad ? 1 : 0);
