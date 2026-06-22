/**
 * Load what the assistant remembers about an admin, formatted for the system
 * prompt. Called on every chat (in-app route + Telegram bot) so the assistant
 * always applies the admin's preferences/terms/corrections — the "it learns you"
 * effect, no fine-tuning. Capped so it can't balloon the context.
 */
import { getServiceSupabase } from "@/lib/supabase";

export async function loadMemory(adminUserId: string | null): Promise<string> {
  if (!adminUserId) return "";
  const db = getServiceSupabase();
  // Founder-programmed RULES must NEVER be evicted — that's the model-independent
  // guarantee ("a rule sticks forever"). Auto-learned corrections (selfLearn) and
  // other rows pile up, so load ALL kind='rule' rows unconditionally, then fill the
  // rest of the budget with the newest non-rule rows. (Was: newest-100 of ANY kind,
  // which silently evicted an old rule once 100 newer rows accumulated — B1.)
  const [rulesRes, recentRes] = await Promise.all([
    db.from("assistant_memory").select("text").eq("owner_user_id", adminUserId).eq("kind", "rule").order("created_at", { ascending: true }),
    db.from("assistant_memory").select("text, kind").eq("owner_user_id", adminUserId).order("created_at", { ascending: false }).limit(150),
  ]);
  const rules = ((rulesRes.data ?? []) as { text: string }[]).map((r) => r.text);
  const others = ((recentRes.data ?? []) as { text: string; kind: string | null }[])
    .filter((r) => r.kind !== "rule")
    .slice(0, 100)
    .map((r) => r.text)
    .reverse(); // chronological
  const lines = [...rules, ...others];
  if (!lines.length) return "";
  return lines.map((t) => `- ${t}`).join("\n");
}

/** The bot's currently-active behavioural rules (rule + correction + preference), newest
 *  first. Used by the self-learn reflector to de-duplicate a freshly-phrased rule against
 *  what's ALREADY learned — exact-text dedup can't catch a re-worded re-correction
 *  ("stop CCing the agency" vs "don't CC the agency"), so the reflector is shown these and
 *  told to return NONE when one already covers the founder's message. Fail-safe to []. */
export async function loadLearnedRuleTexts(adminUserId: string | null, limit = 80): Promise<string[]> {
  if (!adminUserId) return [];
  try {
    const db = getServiceSupabase();
    const { data } = await db
      .from("assistant_memory")
      .select("text")
      .eq("owner_user_id", adminUserId)
      .in("kind", ["rule", "correction", "preference"])
      .order("created_at", { ascending: false })
      .limit(limit);
    return ((data as { text: string }[] | null) ?? []).map((r) => (r.text || "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export type SaveMemoryResult = "saved" | "duplicate" | "failed";

/** Save a durable rule the bot LEARNED (from rememberAboutMe OR auto-reflection),
 *  deduped case-insensitively. Returns a DISCRIMINATED result so callers can tell a
 *  genuine write failure (report honestly) from a duplicate (already active) — the
 *  webhook used to show "✅ already have it" on a real failure (B2). */
export async function saveMemory(adminUserId: string | null, text: string, kind = "correction"): Promise<SaveMemoryResult> {
  const clean = (text || "").trim();
  if (!adminUserId || clean.length < 4) return "failed";
  try {
    const db = getServiceSupabase();
    const { data: existing } = await db
      .from("assistant_memory")
      .select("text")
      .eq("owner_user_id", adminUserId)
      .order("created_at", { ascending: false }) // deterministic dedupe window (B12)
      .limit(400);
    const needle = clean.toLowerCase();
    if (((existing as { text: string }[] | null) ?? []).some((r) => (r.text ?? "").trim().toLowerCase() === needle)) return "duplicate";
    const { error } = await db.from("assistant_memory").insert({ owner_user_id: adminUserId, text: clean.slice(0, 300), kind });
    return error ? "failed" : "saved";
  } catch {
    return "failed";
  }
}
