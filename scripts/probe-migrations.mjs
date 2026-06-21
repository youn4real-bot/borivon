// One-off diagnostic: probe the LIVE DB for every bot-feature migration gate and report
// which .sql files are still unrun. Mirrors lib/migrationCheck.ts. Read-only, safe.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const db = createClient(url, key, { auth: { persistSession: false } });

const GATES = [
  { table: "candidate_profiles", column: "is_test_account", file: "candidate_test_account.sql", feature: "marking test accounts" },
  { table: "candidate_status", column: "vaccines", file: "candidate_status_vaccines.sql", feature: "vaccine status" },
  { table: "assistant_reminders", column: "due_at", file: "assistant_reminders_due_at.sql", feature: "timed reminders firing on time" },
  { table: "assistant_chat_summary", column: "owner_user_id", file: "assistant_chat_summary.sql", feature: "long-term memory" },
  { table: "automation_settings", column: "key", file: "automation_settings.sql", feature: "automation toggles persisting" },
  { table: "telegram_updates", column: "responded_at", file: "telegram_updates_responded.sql", feature: "no-lost-message recovery" },
  { table: "documents", column: "superseded_at", file: "documents_superseded.sql", feature: "archiving documents" },
  { table: "candidate_pipeline", column: "employment_start", file: "candidate_pipeline_employment_dates.sql", feature: "employment/residence dates" },
  { table: "leads", column: "status", file: "leads_status.sql", feature: "lead lifecycle (status/convert)" },
];

const isMissing = (e) => {
  const code = e?.code ?? "";
  const msg = e?.message ?? "";
  return code === "42703" || code === "PGRST204" || code === "PGRST205" || /does not exist|could not find the table|schema cache/i.test(msg);
};

const results = await Promise.all(GATES.map(async (g) => {
  const { error } = await db.from(g.table).select(g.column).limit(1);
  if (!error) return { ...g, state: "OK" };
  if (isMissing(error)) return { ...g, state: "MISSING" };
  return { ...g, state: `ERR(${error.code || "?"}: ${error.message})` };
}));

for (const r of results) console.log(`${r.state.padEnd(8)} ${r.table}.${r.column.padEnd(20)} → ${r.file}`);
const missing = results.filter((r) => r.state === "MISSING");
console.log(`\n${missing.length} migration(s) still unrun: ${missing.map((m) => m.file).join(", ") || "none"}`);
