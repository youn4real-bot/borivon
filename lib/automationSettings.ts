/**
 * Proactive-automation on/off switches.
 *
 * The supreme admin controls these from the Telegram bot (listAutomations /
 * setAutomation) so they can grow the automation set over time without a code
 * change. Each automation's cron/hook calls isAutomationEnabled(key) before
 * acting.
 *
 * FAIL-SAFE: if the automation_settings table doesn't exist yet (migration not
 * run), every read returns the per-automation DEFAULT — so automations work
 * out of the box and the table only adds persistent toggling. Never throws.
 */
import { getServiceSupabase } from "@/lib/supabase";

export type AutomationKey = "daily_briefing" | "weekly_report" | "signup_ping" | "auto_chase" | "inbox_reminder" | "inbox_sla" | "followup_chase";

export const AUTOMATIONS: Record<AutomationKey, { label: string; default: boolean; desc: string }> = {
  daily_briefing: { label: "Daily morning briefing — \"what needs you today\"", default: true, desc: "Every morning, ONE message with everything that needs you: documents to review, passports expiring, B2 exams coming up, your due reminders, candidates who may need a nudge, and unanswered emails. The complete daily triage." },
  weekly_report:  { label: "Weekly business report", default: true, desc: "Every Monday: pipeline snapshot, new signups this week, and what needs your attention." },
  signup_ping:    { label: "New-signup ping", default: true, desc: "An instant Telegram ping the moment a new candidate signs up." },
  auto_chase:     { label: "Auto-chase stuck candidates", default: true, desc: "Candidates who went quiet or didn't re-submit a rejected document. NOW FOLDED INTO the morning briefing — this only sends as a separate ping if you turn the briefing off." },
  inbox_reminder: { label: "Unanswered-email reminder", default: true, desc: "Unread emails from real people in your inbox still needing a reply (no-reply/automated senders skipped). NOW FOLDED INTO the morning briefing — only sends separately if you turn the briefing off." },
  inbox_sla:      { label: "6-hour reply SLA", default: true, desc: "At the midday + evening check, pings you about any email left unanswered for 6h+ — so a same-day email gets surfaced while there's still time to reply. Each email is nudged once. (Needs the inbox_sla_nudges migration run.)" },
  followup_chase: { label: "Outbound follow-up chase", default: true, desc: "When you send an external email, the bot watches for a reply — if none, it reminds you to follow up (morning + evening, ~every 12h, up to 8 times) and auto-stops the moment they reply. (Needs the email_followup_chase migration run.)" },
};

export function isAutomationKey(k: string): k is AutomationKey {
  return Object.prototype.hasOwnProperty.call(AUTOMATIONS, k);
}

/** All flags — DB rows merged over the defaults. Fail-safe to defaults. */
export async function getAutomationFlags(): Promise<Record<AutomationKey, boolean>> {
  const flags = Object.fromEntries(
    (Object.keys(AUTOMATIONS) as AutomationKey[]).map((k) => [k, AUTOMATIONS[k].default]),
  ) as Record<AutomationKey, boolean>;
  try {
    const db = getServiceSupabase();
    const { data, error } = await db.from("automation_settings").select("key, enabled");
    if (error || !data) return flags;
    for (const row of data as { key: string; enabled: boolean }[]) {
      if (isAutomationKey(row.key)) flags[row.key] = row.enabled === true;
    }
  } catch {
    /* table missing / transient → defaults */
  }
  return flags;
}

export async function isAutomationEnabled(key: AutomationKey): Promise<boolean> {
  const flags = await getAutomationFlags();
  return flags[key];
}

/** Toggle one automation. Returns null on success, an error string otherwise. */
export async function setAutomation(key: AutomationKey, enabled: boolean): Promise<string | null> {
  const db = getServiceSupabase();
  const { error } = await db
    .from("automation_settings")
    .upsert({ key, enabled, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) {
    if ((error as { code?: string }).code === "PGRST205") return "automation_settings_not_set_up";
    return "write_failed";
  }
  return null;
}
