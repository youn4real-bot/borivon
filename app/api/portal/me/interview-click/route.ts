import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase, getAnonVerifyClient } from "@/lib/supabase";
import { enforceRateLimit } from "@/lib/rateLimit";

/**
 * Candidate opened their interview link (the portal-gated Teams/Zoom "Join"
 * button). Log it: bump the count + stamp the time. Self-scoped to the caller's
 * own candidate_pipeline row, so an admin/org viewer clicking the same button
 * can never inflate the candidate's number.
 *
 * POST (no body) → { ok }
 */
export async function POST(req: NextRequest) {
  const rl = enforceRateLimit(req, "interview-click", { limit: 30, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ ok: false }, { status: 429 });

  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return NextResponse.json({ ok: false }, { status: 401 });
  const { data: { user }, error } = await getAnonVerifyClient().auth.getUser(authHeader.slice(7));
  if (error || !user) return NextResponse.json({ ok: false }, { status: 401 });

  const db = getServiceSupabase();
  const { data: row } = await db
    .from("candidate_pipeline")
    .select("interview_link_clicks")
    .eq("user_id", user.id)
    .maybeSingle();
  const next = ((row as { interview_link_clicks?: number } | null)?.interview_link_clicks ?? 0) + 1;
  const patch = { interview_link_clicks: next, interview_link_last_clicked_at: new Date().toISOString() };

  const { data: upd, error: updErr } = await db
    .from("candidate_pipeline").update(patch).eq("user_id", user.id).select("user_id");
  if (updErr) { console.error("[interview-click] update failed:", updErr.message); return NextResponse.json({ ok: false }, { status: 500 }); }
  if (!upd || upd.length === 0) {
    await db.from("candidate_pipeline").insert({ user_id: user.id, ...patch });
  }
  return NextResponse.json({ ok: true });
}
