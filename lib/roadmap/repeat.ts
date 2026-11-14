/**
 * Same email, new Fahrplan (founder 2026-11-08: "they should still benefit").
 * Since 2026-11-14 this path is only reached by the founder's own test mailbox: every other address that
 * already confirmed and got its plan is refused politely in app/api/roadmap/route.ts ("already_used").
 *
 *   · every request makes a NEW plan from the new answers; the old one stays valid
 *   · email already confirmed (and not unsubscribed) → no second confirm mail,
 *     the new plan goes straight to that inbox, with a link to the old one
 *   · the older requests stop their tip series, so nobody gets two of each mail
 * The page shows the same "check your inbox" either way: it never tells a
 * stranger whether an address is already known.
 */
import type { getServiceSupabase } from "@/lib/supabase";
import { parseDetails, type RoadmapDetails } from "./leadState";

type Db = ReturnType<typeof getServiceSupabase>;
type Row = { id: string; details: unknown; created_at?: string };

async function earlier(db: Db, email: string): Promise<{ id: string; d: RoadmapDetails }[]> {
  try {
    const { data, error } = await db.from("leads").select("id,details,created_at")
      .eq("kind", "roadmap").eq("email", email).order("created_at", { ascending: false }).limit(20);
    if (error) { console.error("[roadmap] prior lookup failed:", error.message); return []; }
    return ((data ?? []) as Row[]).map((r) => ({ id: r.id, d: parseDetails(r.details) })).filter((r) => !r.d.anonymizedAt);
  } catch (e) { console.error("[roadmap] prior lookup threw:", e instanceof Error ? e.message : e); return []; }
}

/** The newest earlier request whose owner confirmed this address and is still subscribed. */
export async function findConfirmedPrior(db: Db, email: string): Promise<{ id: string; delivered: boolean } | null> {
  const rows = await earlier(db, email);
  if (rows.some((r) => r.d.unsubscribedAt)) return null; // they opted out once: ask again properly
  const hit = rows.find((r) => r.d.consent?.confirmedAt);
  return hit ? { id: hit.id, delivered: !!hit.d.delivery?.sentAt } : null;
}

/** The newest earlier plan that was actually sent (for "your earlier plan stays valid"). */
export async function lastDelivered(db: Db, email: string, exceptId: string): Promise<string | null> {
  const rows = await earlier(db, email);
  return rows.find((r) => r.id !== exceptId && r.d.delivery?.sentAt)?.id ?? null;
}

/** Stop the tip series of every older request for this email. Best effort. */
export async function supersedeOlder(db: Db, email: string, newId: string): Promise<void> {
  for (const r of await earlier(db, email)) {
    if (r.id === newId || r.d.supersededBy) continue;
    const { error } = await db.from("leads").update({ details: { ...r.d, supersededBy: newId } }).eq("id", r.id);
    if (error) console.error("[roadmap] supersede failed:", r.id, error.message);
  }
}
