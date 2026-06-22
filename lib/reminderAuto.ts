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
import { parseReminderTime, fmtWhen } from "@/lib/reminderTime";
import { GEMINI_SAFETY } from "@/lib/vertexModel";

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
  "taken", "mark", "marked", "cross", "clear", "clearing", "cleared", "wipe", "whole",
  "already", "just", "today", "yesterday", "tonight",
  "thing", "things", "stuff", "task", "tasks", "todo", "todos", "reminder", "reminders",
  "remind", "list", "lists", "everything", "both", "beide", "deux", "please", "thanks", "thank",
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

    // BULK DONE — handle in CODE (the model is unreliable at "all" and often returns NONE,
    // which is why "mark them all done" / "mark all my reminders done" closed NOTHING). An
    // explicit bulk-clear with no distinctive task word → close EVERY open reminder; a
    // TOPIC-scoped bulk ("mark all the embassy ones done") → close every open one sharing a
    // distinctive token. No model pick needed, so it always works.
    if (BULK_DONE.test(userMsg)) {
      const toks = contentTokens(userMsg);
      const picks = toks.size ? open.filter((p) => contentOverlap(userMsg, p.text) > 0) : open.slice();
      if (!picks.length) return [];
      const done: string[] = [];
      for (const r of picks) {
        const { error } = await db.from("assistant_reminders").update({ done: true }).eq("id", r.id).eq("owner_user_id", adminUserId);
        if (!error) done.push(r.text);
      }
      return done;
    }

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
      // 512 + no thinking: on Gemini 2.5 Flash, thinking tokens share maxOutputTokens, so
      // 60 could leave NO room for the answer → empty → reminders never auto-close. This is
      // a trivial pick-the-numbers task, so thinking is wasted overhead.
      maxOutputTokens: 512,
      providerOptions: { vertex: { thinkingConfig: { thinkingBudget: 0 }, safetySettings: GEMINI_SAFETY }, google: { thinkingConfig: { thinkingBudget: 0 }, safetySettings: GEMINI_SAFETY } },
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
    // (Bulk is handled above; here the message is a SINGLE-item "done".)
    if (msgTokens.size === 0) {
      // A BARE acknowledgement ("done", "erledigt") with no distinctive word: only safe
      // when there's exactly ONE open reminder (unambiguous); otherwise close nothing.
      picks = open.length === 1 ? picks.filter((p) => p.id === open[0].id) : [];
    } else {
      picks = picks.filter((p) => contentOverlap(userMsg, p.text) > 0);
      // Close at most the SINGLE best-matching reminder, so an over-eager multi-pick can't
      // sweep several tasks off one ambiguous message.
      if (picks.length > 1) {
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

const PING_DONE_RE = /\b(done|erledigt|fertig|geregelt|fini|finie?|finished|completed?|sorted|handled|c'?est fait)\b/i;
const PING_NEG_RE = /\b(not|n'?t|nicht|pas|haven'?t|didn'?t|won'?t|can'?t|no longer|never)\b/i;

/**
 * Parse a REPLY to a reminder ping into an action. PURE + deterministic (no model) so a quick
 * "done" / "+1h" / "tomorrow 9am" reliably maps to that reminder. Returns:
 *  - done   → the founder handled it (a done-word, not negated)
 *  - snooze → a new due instant ("+1h"/"+30m"/"+2d" shorthand, or "in 2h"/"tonight"/"tomorrow
 *             9"/"3pm" via parseReminderTime)
 *  - none   → not actionable → let the normal model path handle the reply
 */
export function parsePingReply(text: string, now: Date = new Date()):
  | { action: "done" }
  | { action: "snooze"; dueAt: Date }
  | { action: "none" } {
  const raw = (text || "").trim();
  const t = raw.toLowerCase();
  if (!t) return { action: "none" };
  if ((PING_DONE_RE.test(t) || raw === "✅" || raw === "👍") && !PING_NEG_RE.test(t)) return { action: "done" };
  // "+1h" / "+30m" / "+2d" snooze shorthand (also bare "+90" = minutes).
  const plus = t.match(/^\+\s*(\d{1,4})\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)?\b/);
  if (plus) {
    const n = parseInt(plus[1], 10);
    const u = plus[2] || "m";
    const ms = /^h/.test(u) ? n * 3_600_000 : /^d/.test(u) ? n * 86_400_000 : n * 60_000;
    if (ms > 0 && ms <= 60 * 86_400_000) return { action: "snooze", dueAt: new Date(now.getTime() + ms) };
  }
  // Natural language → snooze, but ONLY when the reply is COMMAND-shaped, so a NOTE that
  // happens to contain a time ("called them, will follow up at 3 tomorrow") is NOT misread as
  // a snooze. Command-shaped = a leading snooze verb ("snooze to 5pm", "push to tomorrow 9"),
  // OR a short reply (≤4 words) that's essentially just a time ("tomorrow 9am", "in 2h", "3pm").
  // Anything longer falls through to the model as a normal message.
  const SNOOZE_VERB = /^(snooze|push|move|delay|reschedule|remind me)\b\s*(it\s+)?(to|by|until|for|again)?\s*/i;
  const hadVerb = SNOOZE_VERB.test(t);
  const phrase = (hadVerb ? t.replace(SNOOZE_VERB, "").trim() : t) || t;
  const wordCount = t.split(/\s+/).filter(Boolean).length;
  if (hadVerb || wordCount <= 4) {
    const { dueAt } = parseReminderTime(phrase, now);
    if (dueAt && dueAt.getTime() > now.getTime()) return { action: "snooze", dueAt };
  }
  return { action: "none" };
}

/**
 * Act on a REPLY to a reminder ping: find the reminder by the ping's Telegram message_id
 * (deterministic — no fuzzy name match) and complete or snooze it. Fail-safe → {action:"none"}
 * when the column isn't migrated, the reply doesn't map to a ping, or it isn't actionable, so
 * the caller falls through to normal processing.
 */
export async function handleReminderPingReply(
  adminUserId: string | null,
  replyToMessageId: number,
  text: string,
): Promise<{ action: "done" | "snoozed" | "none"; task?: string; whenLabel?: string }> {
  if (!adminUserId || !replyToMessageId) return { action: "none" };
  try {
    const db = getServiceSupabase();
    const { data, error } = await db
      .from("assistant_reminders")
      .select("id, text")
      .eq("owner_user_id", adminUserId)
      .eq("last_ping_message_id", replyToMessageId)
      .eq("done", false)
      .limit(1)
      .maybeSingle();
    if (error || !data) return { action: "none" }; // not a ping reply (or column not migrated)
    const row = data as { id: string; text: string };
    const parsed = parsePingReply(text);
    if (parsed.action === "done") {
      const { error: e } = await db.from("assistant_reminders").update({ done: true }).eq("id", row.id).eq("owner_user_id", adminUserId);
      return e ? { action: "none" } : { action: "done", task: row.text };
    }
    if (parsed.action === "snooze") {
      const iso = parsed.dueAt.toISOString();
      const { error: e } = await db.from("assistant_reminders")
        .update({ due_at: iso, due_date: iso.slice(0, 10), notified_at: null })
        .eq("id", row.id).eq("owner_user_id", adminUserId);
      return e ? { action: "none" } : { action: "snoozed", task: row.text, whenLabel: fmtWhen(parsed.dueAt) };
    }
    return { action: "none" };
  } catch {
    return { action: "none" };
  }
}
