/**
 * Rolling conversation memory for the TELEGRAM assistant (SERVER ONLY).
 *
 * Each Telegram webhook invocation is a fresh serverless call with no memory of
 * the previous message, so a follow-up like "give me their B2 status" had no
 * referent for "their" — the bot would fall back to listing everyone. This
 * persists a short rolling window of recent (user, assistant) TEXT turns per
 * admin so follow-ups resolve in context. (The in-app assistant already sends
 * its full message history, so it doesn't need this.)
 *
 * FAIL-SAFE: every call swallows errors. If the table isn't migrated yet, load
 * returns [] and save is a no-op — the bot just behaves statelessly as before.
 * Never throws.
 *
 * MEMORY WINDOW: the admin treats this like an ongoing chat across the day and
 * across days ("the 4 CVs we talked about", "resend yesterday's email"). A tiny
 * few-hour window meant anything from earlier in the day — let alone yesterday —
 * was gone, and the bot answered "I don't have the context of our previous
 * conversations." So the window is generous: a rolling ~50 turns over the last
 * ~21 days. Gemini's context is huge, so loading that is cheap, and the bot now
 * actually remembers what you were doing.
 */
import { getServiceSupabase } from "@/lib/supabase";

export type ChatTurn = { role: "user" | "assistant"; content: string };

const MAX_TURNS = 50; // ~25 exchanges — enough to remember the day's (and week's) work
const WINDOW_MS = 21 * 24 * 60 * 60 * 1000; // remember the last ~3 weeks as one ongoing conversation

/** Recent turns for this admin, oldest→newest, within the session window. */
export async function loadChatHistory(ownerUserId: string, limit = MAX_TURNS): Promise<ChatTurn[]> {
  if (!ownerUserId) return [];
  try {
    const db = getServiceSupabase();
    const since = new Date(Date.now() - WINDOW_MS).toISOString();
    const { data, error } = await db
      .from("assistant_chat_turns")
      .select("role, content")
      .eq("owner_user_id", ownerUserId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return (data as ChatTurn[])
      .filter((t) => (t.role === "user" || t.role === "assistant") && typeof t.content === "string" && t.content.trim())
      .reverse(); // chronological for the model
  } catch {
    return [];
  }
}

/** Append the latest user + assistant turns. Best-effort; trims long content. */
export async function saveChatTurns(ownerUserId: string, turns: ChatTurn[]): Promise<void> {
  if (!ownerUserId) return;
  const rows = turns
    .filter((t) => t.content && t.content.trim())
    .map((t) => ({ owner_user_id: ownerUserId, role: t.role, content: t.content.trim().slice(0, 4000) }));
  if (rows.length === 0) return;
  try {
    const db = getServiceSupabase();
    await db.from("assistant_chat_turns").insert(rows);
  } catch {
    /* table missing / transient → stateless, no-op */
  }
}
