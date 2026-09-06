import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Mark an affiliate's earnings PAID after the founder has paid out manually.
 * The app never moves money — this only records that a payout happened.
 * Supreme admin only.
 *   { earningId }            → mark that one earning paid
 *   { affiliateId, all:true} → mark every still-owed earning for that affiliate paid
 * `unpay:true` reverses it (back to 'owed') in case of a mistake.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { earningId?: string; affiliateId?: string; all?: boolean; unpay?: boolean } = {};
  try { body = await req.json(); } catch { /* empty */ }

  const toPaid = body.unpay !== true;
  const patch = toPaid
    ? { status: "paid", paid_at: new Date().toISOString() }
    : { status: "owed", paid_at: null };

  const db = getServiceSupabase();

  if (body.earningId && UUID_RE.test(body.earningId)) {
    const { error } = await db.from("affiliate_earnings").update(patch).eq("id", body.earningId);
    if (error) return NextResponse.json({ error: "Could not update" }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (body.affiliateId && UUID_RE.test(body.affiliateId) && body.all) {
    // Only flip rows currently in the opposite state (idempotent).
    const from = toPaid ? "owed" : "paid";
    const { error, count } = await db.from("affiliate_earnings")
      .update(patch, { count: "exact" })
      .eq("affiliate_id", body.affiliateId)
      .eq("status", from);
    if (error) return NextResponse.json({ error: "Could not update" }, { status: 500 });
    return NextResponse.json({ ok: true, updated: count ?? 0 });
  }

  return NextResponse.json({ error: "earningId, or affiliateId+all, required" }, { status: 400 });
}
