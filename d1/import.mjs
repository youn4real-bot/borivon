/**
 * Import the exported rows into the D1 copy over Cloudflare's HTTP API.
 *
 *   node d1/import.mjs <repo-root> <export-dir> [table…] [--accept-newer-in=<table>[,…]]
 *
 * A PRE-SWITCH TOOL ONLY: it empties tables and refills them from a Supabase
 * export. Before it deletes anything it refuses when
 *   • d1/schema.sql / d1/types.json are not what the snapshots generate;
 *   • the site may already read D1 (DATA_BACKEND in wrangler.jsonc, .env.local
 *     or the deployed Worker is anything but absent or "supabase");
 *   • the export is older than 30 minutes;
 *   • D1 holds rows newer than the export (d1/guards.mjs d1NewerRows).
 * After the switch those would be D1's own writes, and this would erase them.
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
import { importTables, preflight } from "./importCore.mjs";
import { generatedProblems, readBackendProblems, exportAgeProblems, d1NewerRows, readEnvFile } from "./guards.mjs";

/** `.env.local` → { KEY: value } (see d1/guards.mjs). */
export const readEnv = readEnvFile;

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
  const argv = process.argv.slice(2);
  const acceptNewerIn = argv.filter((a) => a.startsWith("--accept-newer-in=")).flatMap((a) => a.slice("--accept-newer-in=".length).split(",").filter(Boolean));
  const [root, dir, ...only] = argv.filter((a) => !a.startsWith("--"));
  if (!root || !dir) { console.error("usage: node d1/import.mjs <repo-root> <export-dir> [table…] [--accept-newer-in=<table>[,…]]"); process.exit(2); }
  const refuse = (lines, code = 1) => { for (const l of lines) console.error(`!! ${l}`); console.error("REFUSING — nothing was changed."); process.exit(code); };

  try { const stale = generatedProblems(root); if (stale.length) refuse(stale); }
  catch (e) { refuse([`could not regenerate the schema to check it is current: ${e.message}`], 2); }
  let env;
  try { env = readEnvFile(root); } catch (e) { refuse([`could not read ${path.join(root, ".env.local")}: ${e.message}`], 2); }
  const types = JSON.parse(fs.readFileSync(path.join(root, "d1", "types.json"), "utf8"));

  const backend = await readBackendProblems(root, env);
  if (backend.length) refuse([...backend, "the site may already read D1 — refreshing it from a Supabase export would erase D1's own writes"]);

  const { meta, plan, refusals } = preflight({ types, dir, requested: only });
  if (refusals.length) refuse(refusals);
  const age = exportAgeProblems(meta);
  if (age.length) refuse(age);

  const run = d1HttpRunner(env);
  const newer = await d1NewerRows({ run, types, dir, exportedAt: meta.exportedAt, tables: plan.tables, acceptNewerIn });
  for (const n of newer.notes) console.log(`    ${n}`);
  if (newer.problems.length) refuse(newer.problems);

  const { problems } = await importTables({ run, types, dir, requested: only });
  console.log(`\n${plan.tables.length} tables, ${problems} problem(s)`);
  process.exit(problems ? 1 : 0);
}
