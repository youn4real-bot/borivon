import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/admin-auth";
import { getServiceSupabase } from "@/lib/supabase";

/**
 * Candidate-facing: which live classes are open to candidates right now.
 * Any authenticated user can ASK (no data leak — just room names of open
 * classes); actually JOINING still requires consent + the open+live gate in
 * the token route.
 *
 * GET → { sessions: [{ id, room, title }] }
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db = getServiceSupabase();

  // Private-test allowlist: non-testers never see any live class.
  const { data: prof } = await db.from("candidate_profiles").select("classroom_tester").eq("user_id", auth.userId).maybeSingle();
  if ((prof as { classroom_tester?: boolean } | null)?.classroom_tester !== true) {
    return NextResponse.json({ sessions: [] });
  }

  const { data } = await db
    .from("classroom_sessions")
    .select("id, room_name, title")
    .eq("status", "live")
    .eq("open_to_candidates", true)
    .order("started_at", { ascending: false })
    .limit(10);

  const sessions = ((data ?? []) as { id: string; room_name: string; title: string | null }[])
    .map((s) => ({ id: s.id, room: s.room_name, title: s.title || s.room_name }));
  return NextResponse.json({ sessions });
}
