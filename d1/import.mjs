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
 * Foreign-key safe (d1/importCore.mjs): the export is checked for orphans
 * before anything is deleted, children are emptied before parents, parents are
 * filled before children, and naming one table also refreshes every table
 * whose rows reference it. Re-running is safe and idempotent. This only ever
 * touches the D1 COPY — Supabase is never written to.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importTables } from "./importCore.mjs";

export function readEnv(root) {
  return Object.fromEntries(
    fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)
      .filter((l) => l.includes("=") && !l.startsWith("#"))
      .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }),
  );
}

export const DEFAULT_D1_DATABASE_ID = "ffb9dcff-a501-4dc2-a94a-e5301e2595f0"; // borivon-db (WEUR)

/** One statement over the D1 HTTP API → its rows. */
export function d1HttpRunner(env, database = process.env.D1_DATABASE_ID || DEFAULT_D1_DATABASE_ID) {
  const api = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${database}/query`;
  return async (sql, params = []) => {
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(api, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ sql, params }),
      });
      const j = await res.json().catch(() => ({}));
      if (j.success) return j.result?.[0]?.results ?? [];
      const msg = JSON.stringify(j.errors ?? j).slice(0, 300);
      // D1 is single-writer; a busy/overloaded database is worth retrying.
      if (attempt < 4 && /overload|busy|timeout|503|500/i.test(msg)) { await new Promise((r) => setTimeout(r, 500 * attempt)); continue; }
      throw new Error(msg);
    }
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = process.argv[2], dir = process.argv[3];
  const only = process.argv.slice(4);
  if (!root || !dir) { console.error("usage: node d1/import.mjs <repo-root> <export-dir> [table…]"); process.exit(1); }
  const types = JSON.parse(fs.readFileSync(path.join(root, "d1", "types.json"), "utf8"));
  const { problems, plan } = await importTables({ run: d1HttpRunner(readEnv(root)), types, dir, requested: only });
  console.log(`\n${plan.tables.length} tables, ${problems} problem(s)`);
  process.exit(problems ? 1 : 0);
}
