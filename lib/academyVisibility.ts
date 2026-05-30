/**
 * ACADEMY — tab visibility resolver (SERVER ONLY).
 *
 * Decides whether a given user may see the Academy nav tab:
 *   supreme admin (ADMIN_EMAIL) → always true (they build/run it)
 *   else → explicit per-person override if present, otherwise NOT masked_all
 *
 * Fail-OPEN (returns true) on any DB error / pre-migration, so a blip or a
 * not-yet-run migration behaves like today (tab visible) rather than wrongly
 * hiding it for everyone. Once the migration runs (masked_all seeded TRUE), the
 * tab hides for all non-supreme users until the supreme admin says otherwise.
 *
 * See supabase/academy_visibility.sql.
 */
import { getServiceSupabase } from "./supabase";

function supremeEmail(): string {
  return (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
}

export function isSupremeEmail(email: string): boolean {
  const s = supremeEmail();
  return !!s && (email ?? "").trim().toLowerCase() === s;
}

export async function resolveAcademyVisible(userId: string, email: string): Promise<boolean> {
  if (isSupremeEmail(email)) return true;
  if (!userId) return true;
  const db = getServiceSupabase();
  try {
    const { data: ov, error: ovErr } = await db
      .from("academy_tab_access").select("visible").eq("user_id", userId).maybeSingle();
    if (!ovErr && ov) return !!(ov as { visible: boolean }).visible;

    const { data: st, error: stErr } = await db
      .from("academy_settings").select("masked_all").eq("id", true).maybeSingle();
    if (stErr) return true;                       // pre-migration / blip → behave as before
    const maskedAll = (st as { masked_all: boolean } | null)?.masked_all ?? false;
    return !maskedAll;
  } catch {
    return true;
  }
}
