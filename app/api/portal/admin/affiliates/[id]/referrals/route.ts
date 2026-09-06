import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole, resolveAuthNames } from "@/lib/admin-auth";
import { reconcileAffiliateEarnings } from "@/lib/affiliates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * "Who referred whom" for ONE affiliate — supreme admin only (LAW #25: only the
 * operator sees candidate names; affiliates never do). Lets the founder verify
 * exactly which referred nurse earned which commission before paying out.
 * Returns names + placement/earning status; no passport/PII beyond the name.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ referrals: [] });

  const db = getServiceSupabase();
  await reconcileAffiliateEarnings(db);

  let profs: { user_id: string; first_name: string | null; last_name: string | null }[] = [];
  try {
    const { data } = await db.from("candidate_profiles")
      .select("user_id, first_name, last_name").eq("referred_by_affiliate", id);
    profs = (data ?? []) as typeof profs;
  } catch { return NextResponse.json({ referrals: [] }); } // pre-migration
  const userIds = profs.map((p) => p.user_id).filter(Boolean);
  if (!userIds.length) return NextResponse.json({ referrals: [] });

  const names = await resolveAuthNames(userIds);

  const arrived = new Set<string>();
  try {
    const { data } = await db.from("candidate_pipeline")
      .select("user_id, arrived_done").in("user_id", userIds).eq("arrived_done", true);
    for (const r of (data ?? []) as { user_id: string }[]) arrived.add(r.user_id);
  } catch { /* ignore */ }

  const earnStatus = new Map<string, string>();
  try {
    const { data } = await db.from("affiliate_earnings")
      .select("candidate_user_id, status").eq("affiliate_id", id);
    for (const e of (data ?? []) as { candidate_user_id: string; status: string }[]) earnStatus.set(e.candidate_user_id, e.status);
  } catch { /* ignore */ }

  const referrals = userIds.map((uid) => {
    const prof = profs.find((p) => p.user_id === uid);
    const profName = [prof?.first_name, prof?.last_name].filter(Boolean).join(" ").trim();
    const status = earnStatus.get(uid) ?? null; // 'paid' | 'owed' | 'void' | null (not yet placed)
    return { name: names[uid]?.name || profName || "—", arrived: arrived.has(uid), status };
  });
  // Money-first ordering: paid, owed, then still-pending referrals; hide 'void'.
  const rank = (r: { status: string | null; arrived: boolean }) =>
    r.status === "paid" ? 0 : r.status === "owed" ? 1 : r.arrived ? 2 : 4;
  const visible = referrals.filter((r) => r.status !== "void");
  visible.sort((a, b) => rank(a) - rank(b));

  return NextResponse.json({ referrals: visible });
}
