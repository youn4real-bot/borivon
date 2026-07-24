/**
 * DROPPED-COMMITMENT tracking — "Anna said she'd send the Fahrplan, and never did."
 *
 * WHY this exists when two follow-up systems already do:
 *   • lib/followups.ts          — I emailed them, they never replied.
 *   • classifyThreadFollowUp()  — POSITIONAL: who sent the LAST message in a thread.
 * Neither sees a PROMISE. When someone replies "I'll send X on Friday", THEIR
 * message is the last one, so the thread looks handled — and the promise dies
 * quietly. This module tracks the CONTENT-level commitment instead.
 *
 * The pure bits (overdue maths, dedup key, formatting) are unit-tested; the DB
 * bits are fail-safe — a missing migration makes the whole feature a silent
 * no-op rather than a crash or a spam loop.
 */
import { getServiceSupabase } from "@/lib/supabase";

/** Grace after a stated deadline before we call it overdue (people send late in the day). */
export const COMMITMENT_GRACE_HOURS = 12;
/** With no stated deadline, treat a promise as overdue once it's this old. */
export const COMMITMENT_DEFAULT_DAYS = 5;
/** Stop chasing a promise after this many nudges (it's clearly not coming). */
export const COMMITMENT_MAX_NUDGES = 4;
/** Hours between nudges for the same promise (rides the ~11h-apart cron pair). */
export const COMMITMENT_GATE_HOURS = 20;

export type Commitment = {
  id: number;
  who_email: string;
  who_name: string | null;
  what: string;
  due_at: string | null;
  promised_at: string;
  source_subject: string | null;
  status: "open" | "done" | "dropped";
  last_nudge_at: string | null;
  nudge_count: number;
};

/** A promise the extractor found in an email, before it's stored. */
export type ExtractedCommitment = {
  who_email: string;
  who_name?: string | null;
  what: string;
  due_at?: string | null;
  source_message_id?: string | null;
  source_subject?: string | null;
  promised_at?: string | null;
};

/**
 * Is this promise past due? PURE.
 *  • an explicit deadline → overdue once it's GRACE hours past it
 *  • no deadline → overdue once the promise is DEFAULT_DAYS old
 * Anything already done/dropped is never overdue.
 */
export function isCommitmentOverdue(
  c: Pick<Commitment, "due_at" | "promised_at" | "status">,
  now: number = Date.now(),
): boolean {
  if (c.status !== "open") return false;
  if (c.due_at) {
    const due = Date.parse(c.due_at);
    if (!Number.isNaN(due)) return now >= due + COMMITMENT_GRACE_HOURS * 3_600_000;
  }
  const made = Date.parse(c.promised_at);
  if (Number.isNaN(made)) return false;
  return now >= made + COMMITMENT_DEFAULT_DAYS * 86_400_000;
}

/** Is this promise due for another nudge? PURE — respects the gate + the cap. */
export function isCommitmentNudgeable(
  c: Pick<Commitment, "due_at" | "promised_at" | "status" | "last_nudge_at" | "nudge_count">,
  now: number = Date.now(),
): boolean {
  if (!isCommitmentOverdue(c, now)) return false;
  if (c.nudge_count >= COMMITMENT_MAX_NUDGES) return false;
  if (!c.last_nudge_at) return true;
  const last = Date.parse(c.last_nudge_at);
  if (Number.isNaN(last)) return true;
  return now - last >= COMMITMENT_GATE_HOURS * 3_600_000;
}

/**
 * Stable identity for a promise, so re-scanning the same email never duplicates
 * it. PURE. Mirrors the DB unique index (owner, source_message_id, what).
 */
export function commitmentKey(c: Pick<ExtractedCommitment, "source_message_id" | "what">): string {
  return `${(c.source_message_id ?? "").trim()}|${normalizeWhat(c.what)}`;
}

/** Normalise the promised thing so trivial rewordings dedupe. PURE. */
export function normalizeWhat(what: string): string {
  return (what || "").toLowerCase().replace(/^(the|a|an|le|la|les|der|die|das)\s+/i, "").replace(/\s+/g, " ").trim();
}

/**
 * The founder's chase list, MINIMALIST by standing rule: just the facts, no
 * emojis, no chatter, no encouragement. One line per promise. PURE.
 */
export function formatCommitments(items: Commitment[], now: number = Date.now()): string {
  if (!items.length) return "Nothing outstanding.";
  const lines = items.map((c) => {
    const who = (c.who_name || c.who_email).trim();
    const days = Math.max(0, Math.floor((now - Date.parse(c.promised_at)) / 86_400_000));
    const when = c.due_at
      ? `due ${new Date(c.due_at).toISOString().slice(0, 10)}`
      : `promised ${days}d ago`;
    return `${who}: ${c.what} (${when})`;
  });
  return lines.join("\n");
}

/* ─────────────────────────── DB (all fail-safe) ─────────────────────────── */

/** Store newly-found promises. Ignores duplicates. Never throws. */
export async function recordCommitments(ownerUserId: string, found: ExtractedCommitment[]): Promise<number> {
  if (!ownerUserId || !found.length) return 0;
  try {
    const rows = found
      .filter((c) => c.who_email?.includes("@") && (c.what || "").trim().length > 2)
      .map((c) => ({
        owner_user_id: ownerUserId,
        who_email: c.who_email.trim().toLowerCase(),
        who_name: c.who_name ?? null,
        what: c.what.trim().slice(0, 300),
        due_at: c.due_at ?? null,
        promised_at: c.promised_at ?? new Date().toISOString(),
        source_message_id: c.source_message_id ?? null,
        source_subject: c.source_subject ?? null,
      }));
    if (!rows.length) return 0;
    // onConflict on the unique index → re-scanning the same email is a no-op.
    const { data, error } = await getServiceSupabase()
      .from("assistant_commitments")
      .upsert(rows, { onConflict: "owner_user_id,source_message_id,what", ignoreDuplicates: true })
      .select("id");
    if (error) return 0;
    return (data as { id: number }[] | null)?.length ?? 0;
  } catch { return 0; }
}

/** Open promises, soonest-deadline first. Never throws → [] when not migrated. */
export async function listOpenCommitments(ownerUserId: string, limit = 50): Promise<Commitment[]> {
  if (!ownerUserId) return [];
  try {
    const { data, error } = await getServiceSupabase()
      .from("assistant_commitments")
      .select("id,who_email,who_name,what,due_at,promised_at,source_subject,status,last_nudge_at,nudge_count")
      .eq("owner_user_id", ownerUserId)
      .eq("status", "open")
      .order("due_at", { ascending: true, nullsFirst: false })
      .order("promised_at", { ascending: true })
      .limit(limit);
    if (error) return [];
    return (data ?? []) as Commitment[];
  } catch { return []; }
}

/** Close a promise ("Anna sent it") or write it off. Never throws. */
export async function resolveCommitment(
  ownerUserId: string, id: number, status: "done" | "dropped",
): Promise<boolean> {
  if (!ownerUserId || !id) return false;
  try {
    const { error } = await getServiceSupabase()
      .from("assistant_commitments")
      .update({ status })
      .eq("owner_user_id", ownerUserId)
      .eq("id", id);
    return !error;
  } catch { return false; }
}

/** Stamp a nudge so the gate + cap work. Never throws. */
export async function markCommitmentNudged(ownerUserId: string, items: Commitment[]): Promise<void> {
  if (!ownerUserId || !items.length) return;
  try {
    const db = getServiceSupabase();
    const nowIso = new Date().toISOString();
    for (const c of items) {
      await db.from("assistant_commitments")
        .update({ last_nudge_at: nowIso, nudge_count: (c.nudge_count ?? 0) + 1 })
        .eq("owner_user_id", ownerUserId).eq("id", c.id);
    }
  } catch { /* best-effort */ }
}
