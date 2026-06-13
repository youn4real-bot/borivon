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
  // Newest first + cap, so once the founder has taught >100 rules it's the most
  // RECENT teachings that survive (not the oldest) — then re-order chronologically
  // for a natural read. (Loading oldest-first silently dropped new lessons.)
  const { data, error } = await db
    .from("assistant_memory")
    .select("text")
    .eq("owner_user_id", adminUserId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return ""; // memory is best-effort — never block the chat on it
  const rows = (data ?? []) as { text: string }[];
  if (!rows.length) return "";
  return rows.reverse().map((r) => `- ${r.text}`).join("\n");
}
