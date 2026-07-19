/**
 * Interview self-scheduler — candidate side (read).
 *
 * GET → the caller's OPEN interview proposals (status='proposed'). Self-scoped to
 * the authenticated user's own id; an admin/org viewer can't read someone else's.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase, getAnonVerifyClient } from "@/lib/supabase";
import { enforceRateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const rl = enforceRateLimit(req, "interview-proposals", { limit: 60, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ proposals: [] }, { status: 429 });

  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: { user }, error } = await getAnonVerifyClient().auth.getUser(authHeader.slice(7));
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data } = await getServiceSupabase()
    .from("interview_proposals")
    .select("id, round, proposed_slots, note, created_at")
    .eq("candidate_user_id", user.id)
    .eq("status", "proposed")
    .order("created_at", { ascending: false });
  type Row = { id: string; round: number; proposed_slots: string[]; note: string | null; created_at: string };
  return NextResponse.json({
    proposals: ((data ?? []) as Row[]).map((r) => ({ id: r.id, round: r.round, slots: r.proposed_slots ?? [], note: r.note ?? "" })),
  });
}
