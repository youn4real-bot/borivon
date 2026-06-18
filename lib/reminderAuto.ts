/**
 * Reminders, enforced in CODE — not left to the flaky model.
 *
 * Two failures the founder hit:
 *  1) He said "remind me about the Mercury bank thing" and NOTHING was stored —
 *     Flash just didn't call the saveReminder tool. createReminder() is called
 *     straight from a webhook intercept so a "remind me …" ALWAYS lands.
 *  2) After he'd handled a thing, the reminder kept nagging in every briefing —
 *     because closing it required the model to chain listReminders→completeReminder.
 *     resolveDoneReminders() closes it in code the moment he says it's done.
 *
 * Both write to assistant_reminders (which already exists in the DB). Never throw.
 */
import { generateText } from "ai";
import { getServiceSupabase } from "@/lib/supabase";

/** Create a personal reminder for the admin. `dueAt` is the exact instant it should
 *  fire (with time-of-day) — null for an undated "keep nagging me" task. Returns the
 *  new id, or null on failure. Stores both due_at (the precise firing instant, source
 *  of truth) and the legacy due_date (so the existing briefing date-surfacing still
 *  works). Falls back to a date-only insert if the due_at column isn't migrated yet. */
export async function createReminder(
  adminUserId: string | null,
  text: string,
  dueAt?: Date | null,
  recurrence?: "daily" | "weekly" | "monthly" | null,
): Promise<string | null> {
  const clean = (text || "").trim();
  if (!adminUserId || clean.length < 2) return null;
  try {
    const db = getServiceSupabase();
    const dueAtIso = dueAt instanceof Date && !Number.isNaN(dueAt.getTime()) ? dueAt.toISOString() : null;
    const dueDate = dueAtIso ? dueAtIso.slice(0, 10) : null;
    const row: Record<string, unknown> = { owner_user_id: adminUserId, text: clean.slice(0, 500), due_date: dueDate };
    if (dueAtIso) row.due_at = dueAtIso;
    if (recurrence) row.recurrence = recurrence;
    const { data, error } = await db.from("assistant_reminders").insert(row).select("id").maybeSingle();
    if (error) {
      // due_at column may not exist yet (migration not run) → retry date-only so the
      // task still lands and surfaces in the briefing.
      if (dueAtIso) {
        const { data: d2, error: e2 } = await db
          .from("assistant_reminders")
          .insert({ owner_user_id: adminUserId, text: clean.slice(0, 500), due_date: dueDate })
          .select("id")
          .maybeSingle();
        if (e2) return null;
        return (d2 as { id: string } | null)?.id ?? null;
      }
      return null;
    }
    return (data as { id: string } | null)?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * When the founder's latest message implies one of his OPEN reminders is now
 * done / handled / no longer needed, close it — deterministically. The CODE runs
 * a strict classification (not the agent deciding to call a tool), so an answer
 * like "I already paid the Mercury invoice" reliably clears the "Mercury bank"
 * reminder. Returns the texts of the reminders just closed.
 */
export async function resolveDoneReminders(
  adminUserId: string | null,
  userMsg: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: any,
): Promise<string[]> {
  if (!adminUserId || !model) return [];
  try {
    const db = getServiceSupabase();
    const { data } = await db
      .from("assistant_reminders")
      .select("id, text")
      .eq("owner_user_id", adminUserId)
      .eq("done", false)
      .limit(40);
    const open = (data ?? []) as { id: string; text: string }[];
    if (!open.length) return [];

    const list = open.map((r, i) => `${i + 1}. ${r.text}`).join("\n");
    const res = await generateText({
      model,
      system:
        "You decide which of the founder's OPEN reminders his latest message says are DONE, handled, or no longer needed. Be STRICT: pick a reminder ONLY if the message clearly resolves THAT specific item — when unsure, do not pick it. Output ONLY the matching numbers, comma-separated (e.g. \"2\" or \"1,3\"), or the single word NONE. No other text.",
      messages: [{
        role: "user",
        content: `Open reminders:\n${list}\n\nThe founder just said:\n"${(userMsg || "").slice(0, 400)}"\n\nResolved reminder number(s), or NONE:`,
      }],
      temperature: 0,
      maxOutputTokens: 60, // just numbers or "NONE" — and Claude REQUIRES max_tokens
    });

    const out = (res.text || "").trim();
    if (!out || /^none\b/i.test(out)) return [];
    const nums = [...new Set((out.match(/\d+/g) || []).map(Number))].filter((n) => n >= 1 && n <= open.length);
    if (!nums.length) return [];

    const done: string[] = [];
    for (const n of nums) {
      const r = open[n - 1];
      const { error } = await db
        .from("assistant_reminders")
        .update({ done: true })
        .eq("id", r.id)
        .eq("owner_user_id", adminUserId);
      if (!error) done.push(r.text);
    }
    return done;
  } catch {
    return [];
  }
}
