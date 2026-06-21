/**
 * PENDING-MIGRATION boot check. The founder runs SQL by hand, so a feature can silently
 * sit DEAD on a forgotten migration (e.g. setTestAccount with no is_test_account column) —
 * and he becomes the bug-finder, the exact anti-pattern his own memory warns against. This
 * probes the live DB for every column/table a bot FEATURE depends on and reports which
 * migration files are NOT run, so the webhook can surface one concise "run these" line.
 *
 * Each probe is cheap (select one column, limit 1) and FULLY fail-safe: a connection blip
 * just yields "no missing" (we never block a message on this). Detection: a missing COLUMN
 * is 42703 / PGRST204, a missing TABLE is PGRST205 / "could not find the table".
 */
import { getServiceSupabase } from "@/lib/supabase";

// table.column → the migration file that adds it + the bot feature it gates.
const GATES: { table: string; column: string; file: string; feature: string }[] = [
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

const isMissingErr = (error: unknown): boolean => {
  const code = (error as { code?: string } | null)?.code ?? "";
  const msg = (error as { message?: string } | null)?.message ?? "";
  return code === "42703" || code === "PGRST204" || code === "PGRST205" || /does not exist|could not find the table|schema cache/i.test(msg);
};

/** Probe every feature-gate; return the migrations NOT yet run (file + feature). Fail-safe
 *  → returns [] on any unexpected trouble, so it can NEVER break or block a message. */
export async function checkPendingMigrations(): Promise<{ file: string; feature: string }[]> {
  try {
    const db = getServiceSupabase();
    const results = await Promise.all(
      GATES.map(async (g) => {
        try {
          const { error } = await db.from(g.table).select(g.column).limit(1);
          return error && isMissingErr(error) ? { file: g.file, feature: g.feature } : null;
        } catch { return null; }
      }),
    );
    return results.filter((x): x is { file: string; feature: string } => x !== null);
  } catch {
    return [];
  }
}
