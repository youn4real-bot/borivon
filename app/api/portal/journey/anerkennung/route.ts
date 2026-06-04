import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole, canActOnCandidate } from "@/lib/admin-auth";
import { UUID_RE } from "@/lib/uuid";
import { isAnerkennungStage } from "@/lib/anerkennungJourney";

/**
 * Set a candidate's Anerkennung (recognition) stage. Managing parties only
 * (LAW #25) — mirrors the B2 route. The candidate does NOT set their own stage.
 *
 * POST { candidateId, stage }
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({}));
  const candidateId = typeof body?.candidateId === "string" ? body.candidateId : "";
  const stage = body?.stage;
  if (!UUID_RE.test(candidateId)) return NextResponse.json({ error: "candidateId required" }, { status: 400 });
  if (!isAnerkennungStage(stage)) return NextResponse.json({ error: "invalid stage" }, { status: 400 });

  const allowed = await canActOnCandidate(auth.role, auth.email, candidateId);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = getServiceSupabase();
  const { error } = await db.from("candidate_profiles").update({ anerkennung_stage: stage }).eq("user_id", candidateId);
  if (error) {
    console.error("[journey/anerkennung] update error:", error.message);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, stage });
}
