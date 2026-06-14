/**
 * Rolling conversation memory for the TELEGRAM assistant (SERVER ONLY).
 *
 * Each Telegram webhook invocation is a fresh serverless call with no memory of
 * the previous message, so a follow-up like "give me their B2 status" had no
 * referent for "their" — the bot would fall back to listing everyone. This
 * persists the conversation per admin so follow-ups (and next-day references)
 * resolve in context.
 *
 * EFFECTIVELY-UNLIMITED MEMORY (compaction, like a long ChatGPT/Claude thread):
 * we DON'T load the whole transcript raw — that would cost more every message,
 * get slower, and eventually drown the model in old chatter. Instead:
 *   • the most recent ~50 turns load VERBATIM (the live tail), and
 *   • everything older is folded into a rolling prose SUMMARY (names, statuses,
 *     decisions, open threads) that travels with every message.
 * So the bot can recall "the 4 CVs we talked about" or "yesterday's email"
 * indefinitely, while the prompt stays a bounded, cheap size. `maybeCompact()`
 * runs after a reply once the tail grows past a threshold, summarises the oldest
 * slice with cheap Flash, and advances a watermark.
 *
 * FAIL-SAFE: every call swallows errors. If the tables aren't migrated yet, load
 * returns empty and compaction is a no-op — the bot just behaves with whatever
 * recent turns exist (or statelessly). Never throws.
 */
import { getServiceSupabase } from "@/lib/supabase";
import { vertexModel } from "@/lib/vertexModel";
import { generateText } from "ai";

export type ChatTurn = { role: "user" | "assistant"; content: string };

// Live tail kept VERBATIM in the prompt. Must be >= COMPACT_THRESHOLD so the
// whole un-summarised tail always loads (older context lives in the summary).
const TAIL_TURNS = 60;
// Once the un-summarised tail exceeds this many turns, fold the oldest down.
const COMPACT_THRESHOLD = 50;
// After folding, keep roughly this many recent turns raw (the rest → summary).
const COMPACT_KEEP = 25;
// Safety net before any summary exists / table unmigrated: don't drag in turns
// older than this as raw context.
const HARD_WINDOW_MS = 60 * 24 * 60 * 60 * 1000; // ~60 days
const SUMMARY_MAX = 6000; // cap the stored running summary (chars)
const TURN_MAX = 4000; // cap a single saved turn (chars)

type SummaryRow = { summary: string; summarized_through: string | null };

/**
 * Full conversation context for a turn: the rolling summary of older messages
 * plus the recent verbatim turns (oldest→newest). Fail-safe to {summary:"",turns:[]}.
 */
export async function loadConversationContext(
  ownerUserId: string,
): Promise<{ summary: string; turns: ChatTurn[] }> {
  if (!ownerUserId) return { summary: "", turns: [] };
  try {
    const db = getServiceSupabase();
    const sum = await loadSummaryRow(db, ownerUserId);
    const watermark = sum?.summarized_through ?? null;

    let q = db
      .from("assistant_chat_turns")
      .select("role, content")
      .eq("owner_user_id", ownerUserId);
    // Turns newer than the watermark are the un-summarised tail. With no summary
    // yet, fall back to a generous time window so old transcripts still load.
    q = watermark
      ? q.gt("created_at", watermark)
      : q.gte("created_at", new Date(Date.now() - HARD_WINDOW_MS).toISOString());

    const { data, error } = await q.order("created_at", { ascending: false }).limit(TAIL_TURNS);
    if (error || !data) return { summary: sum?.summary ?? "", turns: [] };
    const turns = (data as ChatTurn[])
      .filter((t) => (t.role === "user" || t.role === "assistant") && typeof t.content === "string" && t.content.trim())
      .reverse(); // chronological for the model
    return { summary: sum?.summary ?? "", turns };
  } catch {
    return { summary: "", turns: [] };
  }
}

/**
 * Back-compat thin wrapper — just the recent verbatim turns (no summary).
 * Retained for any caller that only wants the tail.
 */
export async function loadChatHistory(ownerUserId: string): Promise<ChatTurn[]> {
  return (await loadConversationContext(ownerUserId)).turns;
}

/** "New chat" — start the conversation context fresh. The raw turns are KEPT (not
 *  deleted — recoverable, and the founder values the record): we just blank the
 *  rolling summary and move the watermark to NOW, so loadConversationContext
 *  returns nothing older and the next message begins on a clean slate. */
export async function resetConversation(ownerUserId: string): Promise<boolean> {
  if (!ownerUserId) return false;
  try {
    const db = getServiceSupabase();
    const now = new Date().toISOString();
    const { error } = await db
      .from("assistant_chat_summary")
      .upsert({ owner_user_id: ownerUserId, summary: "", summarized_through: now, updated_at: now }, { onConflict: "owner_user_id" });
    return !error;
  } catch {
    return false; // table not migrated → best-effort no-op
  }
}

/** Append the latest user + assistant turns. Best-effort; trims long content. */
export async function saveChatTurns(ownerUserId: string, turns: ChatTurn[]): Promise<void> {
  if (!ownerUserId) return;
  const rows = turns
    .filter((t) => t.content && t.content.trim())
    .map((t) => ({ owner_user_id: ownerUserId, role: t.role, content: t.content.trim().slice(0, TURN_MAX) }));
  if (rows.length === 0) return;
  try {
    const db = getServiceSupabase();
    await db.from("assistant_chat_turns").insert(rows);
  } catch {
    /* table missing / transient → stateless, no-op */
  }
}

/**
 * Decide how many of the OLDEST tail turns to fold into the summary so we keep
 * ~`keep` recent turns raw WITHOUT splitting a group of turns that share a
 * timestamp. user+assistant are inserted together and get the SAME created_at;
 * the watermark is timestamp-based, so splitting a same-timestamp pair would
 * orphan the sibling (excluded from BOTH the summary and the future tail).
 * Pure + exported for unit tests. Returns the fold count (0 = fold nothing).
 */
export function foldBoundary(timestamps: string[], keep: number): number {
  const n = timestamps.length;
  if (n <= keep) return 0;
  let cut = n - keep; // first index we'd otherwise KEEP raw
  // Extend the fold forward while the first-kept shares a timestamp with the
  // last-folded, so the boundary lands on a clean timestamp gap.
  while (cut < n && cut > 0 && timestamps[cut] === timestamps[cut - 1]) cut++;
  return cut;
}

/**
 * If the live tail has grown past COMPACT_THRESHOLD, fold its oldest slice into
 * the rolling summary (cheap Flash call) and advance the watermark. Best-effort,
 * runs AFTER the reply is sent, fires only ~once per (THRESHOLD-KEEP) turns.
 */
export async function maybeCompact(ownerUserId: string): Promise<void> {
  if (!ownerUserId) return;
  try {
    const db = getServiceSupabase();
    const sum = await loadSummaryRow(db, ownerUserId);
    const watermark = sum?.summarized_through ?? null;
    const prevSummary = sum?.summary ?? "";

    // Pull the un-summarised tail (oldest→newest) with timestamps. Cap generously.
    let q = db
      .from("assistant_chat_turns")
      .select("role, content, created_at")
      .eq("owner_user_id", ownerUserId);
    if (watermark) q = q.gt("created_at", watermark);
    const { data, error } = await q.order("created_at", { ascending: true }).limit(400);
    if (error || !data) return;
    const tail = (data as Array<{ role: string; content: string; created_at: string }>).filter(
      (t) => (t.role === "user" || t.role === "assistant") && typeof t.content === "string" && t.content.trim(),
    );
    if (tail.length <= COMPACT_THRESHOLD) return; // not long enough yet

    const fold = foldBoundary(tail.map((t) => t.created_at), COMPACT_KEEP);
    if (fold <= 0) return;
    const folding = tail.slice(0, fold);
    const newWatermark = folding[folding.length - 1].created_at;

    const model = vertexModel("flash");
    if (!model) return; // Vertex not configured → leave it; the tail still covers recent

    const transcript = folding
      .map((t) => `${t.role === "user" ? "Admin" : "Assistant"}: ${t.content}`)
      .join("\n")
      .slice(0, 24000); // bound the summariser input
    const { text } = await generateText({
      model,
      system: SUMMARY_SYSTEM,
      prompt:
        `EXISTING RUNNING SUMMARY (may be empty):\n${prevSummary || "(none yet)"}\n\n` +
        `OLDER MESSAGES TO FOLD IN (oldest first):\n${transcript}\n\n` +
        `Return the UPDATED running summary only.`,
    });
    const next = (text || "").trim().slice(0, SUMMARY_MAX);
    if (!next) return;

    await db.from("assistant_chat_summary").upsert(
      {
        owner_user_id: ownerUserId,
        summary: next,
        summarized_through: newWatermark,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_user_id" },
    );
  } catch {
    /* best-effort; the verbatim tail still provides recent context */
  }
}

async function loadSummaryRow(
  db: ReturnType<typeof getServiceSupabase>,
  ownerUserId: string,
): Promise<SummaryRow | null> {
  try {
    const { data, error } = await db
      .from("assistant_chat_summary")
      .select("summary, summarized_through")
      .eq("owner_user_id", ownerUserId)
      .maybeSingle();
    if (error || !data) return null;
    return data as SummaryRow;
  } catch {
    return null; // table not migrated yet → no summary, tail-only memory
  }
}

const SUMMARY_SYSTEM = `You maintain a running memory of an ongoing work chat between the owner of a German-nursing-placement agency ("the Admin") and his assistant bot. You're given the existing running summary plus the next batch of older messages about to scroll out of the live view. Fold them into ONE updated running summary so the assistant can continue seamlessly tomorrow as if it remembered everything.

Keep, concisely:
- WHO has come up — candidate FULL NAMES, employers/organisations, and key facts (B2 status, monthly batch, documents, decisions about them).
- WHAT was done or decided — emails sent (to whom + subject), statuses changed, documents handled, tasks assigned, things promised.
- OPEN threads — anything pending, waiting, or that the Admin asked for and isn't finished.
- The Admin's stated preferences or corrections.

Rules: prefer names and specifics over vague phrases — turn "the 4 candidates" into the actual four names. Drop greetings, filler, and resolved trivia. Merge with the existing summary (don't just append — keep it tight and non-redundant). Under ~400 words. Plain text only, NO markdown, no bullets with asterisks. Write durable notes, not a story.`;
