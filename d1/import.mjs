/**
 * Import the exported rows into the D1 copy over Cloudflare's HTTP API.
 *
 *   node d1/import.mjs <repo-root> <export-dir> [table…]
 *
 * Why not `wrangler d1 execute --file`: that sends the rows inside the SQL
 * text, and D1 refuses a statement over ~100 KB (SQLITE_TOOBIG). Three tables
 * hit it — candidate_profiles (cv_draft, signatures), messages (inline image
 * attachments) and organizations (a logo data URL). Here the statement is just
 * placeholders and the values travel as bound parameters, so row size stops
 * mattering.
 *
 * Each table is emptied first, so re-running is safe and idempotent. This only
 * ever touches the D1 COPY — Supabase is never written to.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.argv[2], dir = process.argv[3];
const only = process.argv.slice(4);
if (!root || !dir) { console.error("usage: node d1/import.mjs <repo-root> <export-dir> [table…]"); process.exit(1); }

const env = Object.fromEntries(
  fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }),
);
const ACCOUNT = env.CLOUDFLARE_ACCOUNT_ID;
const TOKEN = env.CLOUDFLARE_API_TOKEN;
const DB = process.env.D1_DATABASE_ID || "ffb9dcff-a501-4dc2-a94a-e5301e2595f0"; // borivon-db (WEUR)
const API = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DB}/query`;

async function d1(sql, params = []) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(API, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sql, params }),
    });
    const j = await res.json().catch(() => ({}));
    if (j.success) return j.result;
    const msg = JSON.stringify(j.errors ?? j).slice(0, 300);
    // D1 is single-writer; a busy/overloaded database is worth retrying.
    if (attempt < 4 && /overload|busy|timeout|503|500/i.test(msg)) { await new Promise((r) => setTimeout(r, 500 * attempt)); continue; }
    throw new Error(msg);
  }
}

const types = JSON.parse(fs.readFileSync(path.join(root, "d1", "types.json"), "utf8"));
const expected = JSON.parse(fs.readFileSync(path.join(dir, "_counts.json"), "utf8"));
const tables = (only.length ? only : Object.keys(types).sort()).filter((t) => expected[t] !== "skipped" && expected[t] !== undefined);

const MAX_PARAMS = 90;            // D1 allows 100 bound parameters per statement
const MAX_BYTES = 400_000;        // keep each request comfortably small
let problems = 0;

for (const table of tables) {
  const cols = Object.entries(types[table].columns).filter(([, c]) => !c.generated).map(([n]) => n);
  const rows = JSON.parse(fs.readFileSync(path.join(dir, `${table}.json`), "utf8"));
  await d1(`DELETE FROM "${table}"`);

  const perStatement = Math.max(1, Math.floor(MAX_PARAMS / cols.length));
  const placeholders = (n) => Array.from({ length: n }, () => `(${cols.map(() => "?").join(",")})`).join(",");
  let sent = 0;
  for (let i = 0; i < rows.length; ) {
    const chunk = [];
    let bytes = 0;
    while (i < rows.length && chunk.length < perStatement) {
      const vals = rows[i];
      const size = vals.reduce((n, v) => n + (typeof v === "string" ? v.length : 8), 0);
      if (chunk.length && bytes + size > MAX_BYTES) break;
      chunk.push(vals); bytes += size; i++;
    }
    const sql = `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(",")}) VALUES ${placeholders(chunk.length)}`;
    try {
      await d1(sql, chunk.flat());
      sent += chunk.length;
    } catch (e) {
      console.log(`!! ${table}: ${String(e.message).slice(0, 200)}`);
      problems++;
      break;
    }
  }
  const [{ results }] = await d1(`SELECT count(*) AS n FROM "${table}"`);
  const got = results[0].n, want = Number(expected[table]);
  if (got !== want) { console.log(`!! ${table}: expected ${want}, D1 has ${got}`); problems++; }
  else console.log(`ok  ${table}: ${got}`);
  if (sent !== rows.length) console.log(`   (sent ${sent} of ${rows.length})`);
}
console.log(`\n${tables.length} tables, ${problems} problem(s)`);
process.exit(problems ? 1 : 0);
