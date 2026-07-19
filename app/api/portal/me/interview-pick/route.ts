/**
 * Interview self-scheduler — candidate picks a slot.
 *
 * POST { proposalId, slot } → verifies the JWT, matches the proposal to the
 * caller's OWN id (never a client-supplied uid), verifies the slot was actually
 * offered, then:
 *   • marks the proposal picked,
 *   • writes the CONFIRMED date into candidate_pipeline (interviewN_date +
 *     interviewN_date_confirmed=true) so it flows into the tracker + radar,
 *   • clears the candidate's bell notification for this proposal.
 *
 * No stage gate is touched (LAW #32) — this only records a date. Unlock fields
 * (LAW #31) are never written from here.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase, getAnonVerifyClient } from "@/lib/supabase";
import { enforceRateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SLOT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export async function POST(req: NextRequest) {
  const rl = enforceRateLimit(req, "interview-pick", { limit: 20, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ ok: false }, { status: 429 });

  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return NextResponse.json({ ok: false }, { status: 401 });
  const { data: { user }, error } = await getAnonVerifyClient().auth.getUser(authHeader.slice(7));
  if (error || !user) return NextResponse.json({ ok: false }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const proposalId = typeof body?.proposalId === "string" ? body.proposalId : "";
  const slot = typeof body?.slot === "string" ? body.slot : "";
  if (!proposalId || !SLOT_RE.test(slot)) return NextResponse.json({ ok: false, error: "bad_input" }, { status: 400 });

  const db = getServiceSupabase();
  // Match the proposal to THIS user (self-scope) and only while still open.
  const { data: prop } = await db
    .from("interview_proposals")
    .select("id, round, proposed_slots, status")
    .eq("id", proposalId)
    .eq("candidate_user_id", user.id)
    .maybeSingle();
  const p = prop as { id: string; round: number; proposed_slots: string[]; status: string } | null;
  if (!p) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  if (p.status !== "proposed") return NextResponse.json({ ok: false, error: "already_done" }, { status: 409 });
  if (!(p.proposed_slots ?? []).includes(slot)) return NextResponse.json({ ok: false, error: "slot_not_offered" }, { status: 400 });

  // 1) Mark the proposal picked.
  await db.from("interview_proposals").update({ picked_slot: slot, status: "picked", updated_at: new Date().toISOString() }).eq("id", p.id).eq("candidate_user_id", user.id);

  // 2) Write the confirmed date into the pipeline (date part = wall-clock date).
  const dateOnly = slot.slice(0, 10);
  const patch = p.round === 2
    ? { interview2_date: dateOnly, interview2_date_confirmed: true, updated_at: new Date().toISOString() }
    : { interview1_date: dateOnly, interview1_date_confirmed: true, updated_at: new Date().toISOString() };
  const { data: upd } = await db.from("candidate_pipeline").update(patch).eq("user_id", user.id).select("user_id");
  if (!upd || upd.length === 0) {
    await db.from("candidate_pipeline").insert({ user_id: user.id, ...patch });
  }

  // 3) Clear the candidate's bell card for this proposal.
  await db.from("notifications").update({ read: true }).eq("user_id", user.id).eq("doc_id", p.id).eq("doc_type", "interview_proposal");

  return NextResponse.json({ ok: true, pickedSlot: slot });
}
