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

// Generic done-words, action verbs, pronouns and fillers that appear in BOTH a "done"
// message AND a reminder ("I CALLED them" vs "CALL the embassy") — so they must NOT
// count as a content match. Only DISTINCTIVE tokens (a name, place, subject: "embassy",
// "mercury", "deposit", "Aya") should tie a message to the reminder it closes. ASCII-
// folded so "envoyé"→"envoye" etc. compare cleanly.
const TOKEN_STOP = new Set([
  // EN generic verbs / acknowledgement
  "done", "sent", "send", "sending", "paid", "pay", "paying", "call", "called", "calling",
  "email", "emailed", "mail", "mailed", "text", "texted", "message", "messaged", "handle",
  "handled", "handling", "finish", "finished", "made", "make", "making", "took", "take",
  "taken", "mark", "marked", "cross", "already", "just", "today", "yesterday", "tonight",
  "thing", "things", "stuff", "task", "reminder", "remind", "please", "thanks", "thank",
  "yeah", "yep", "yup", "okay", "sure", "cool", "great", "nice", "good", "fine",
  // EN pronouns / fillers (>=4 chars; shorter ones drop via the length filter)
  "that", "this", "these", "those", "them", "they", "their", "with", "about", "from",
  "have", "has", "had", "will", "would", "could", "should", "your", "yours", "mine",
  "what", "when", "been", "being", "into", "over", "back", "also", "then", "than",
  // DE
  "erledigt", "gemacht", "fertig", "geschickt", "gesendet", "angerufen", "bezahlt",
  "schon", "gerade", "mein", "habe", "auch", "noch",
  // FR (ascii-folded)
  "fait", "fini", "envoye", "envoyee", "appele", "appelee", "paye", "payee", "deja",
  "fini", "termine", "terminee", "mon", "mes",
]);

/** ASCII-fold + lowercase + split into DISTINCTIVE content tokens (>=4 chars, not a
 *  generic done/action word). Used to require that a "done" message actually references
 *  the reminder it would close — so an incidental "I sent it" can't silently clear an
 *  unrelated task (the founder's tasks must never vanish on fuzzy phrasing). */
export function contentTokens(s: string): Set<string> {
  const folded = (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const out = new Set<string>();
  for (const raw of folded.split(/[^a-z0-9]+/)) {
    if (raw.length >= 4 && !TOKEN_STOP.has(raw)) out.add(raw);
  }
  return out;
}

/** How many distinctive tokens the message shares with the reminder text. */
export function contentOverlap(msg: string, reminderText: string): number {
  const a = contentTokens(msg);
  if (!a.size) return 0;
  const b = contentTokens(reminderText);
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

// The founder is clearing MANY at once ("mark them all done", "both handled", "clear my list").
const BULK_DONE = /\b(all|everything|every one|each|both|them all|the (?:whole )?list|all of (?:them|it)|alle[s]?|beide|tous|toutes|les deux)\b/i;

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

    // PRECISION GATE (code, not the model): closing a reminder is destructive — it
    // vanishes from every future briefing — so the LLM's pick is only ACCEPTED when the
    // message actually references that reminder. This stops an incidental "I sent it"
    // from silently clearing an unrelated task.
    let picks = nums.map((n) => open[n - 1]);
    const msgTokens = contentTokens(userMsg);
    const bulk = BULK_DONE.test(userMsg);
    if (msgTokens.size === 0) {
      // A BARE acknowledgement ("done", "erledigt") with no distinctive word: only safe
      // when there's exactly ONE open reminder (unambiguous); otherwise close nothing.
      picks = open.length === 1 ? picks.filter((p) => p.id === open[0].id) : [];
    } else {
      picks = picks.filter((p) => contentOverlap(userMsg, p.text) > 0);
      // Not an explicit bulk clear → close at most the SINGLE best-matching reminder, so
      // an over-eager multi-pick can't sweep several tasks off one ambiguous message.
      if (!bulk && picks.length > 1) {
        picks = [picks.reduce((best, p) => (contentOverlap(userMsg, p.text) > contentOverlap(userMsg, best.text) ? p : best))];
      }
    }
    if (!picks.length) return [];

    const done: string[] = [];
    for (const r of picks) {
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
