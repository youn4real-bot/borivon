import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/admin-auth";
import { getServiceSupabase } from "@/lib/supabase";
import { isPermanentTester } from "@/lib/classroomTesters";

/**
 * Candidate-facing: which live classes are open to candidates right now.
 * Any authenticated user can ASK (no data leak — just room names of open
 * classes); actually JOINING still requires consent + the open+live gate in
 * the token route.
 *
 * GET → { sessions: [{ id, room, title }], tester } — tester=false means the
 *   account isn't on the private-test allowlist (page shows "not available").
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db = getServiceSupabase();

  // Allowlist: permanent pair (Soufiane) OR flagged via column.
  let tester = isPermanentTester(auth.userId);
  if (!tester) {
    const { data: prof } = await db.from("candidate_profiles").select("classroom_tester").eq("user_id", auth.userId).maybeSingle();
    tester = (prof as { classroom_tester?: boolean } | null)?.classroom_tester === true;
  }

  // Sessions this candidate was explicitly INVITED to (admin-assigned).
  const { data: invs } = await db.from("classroom_invites").select("session_id").eq("user_id", auth.userId);
  const invitedIds = ((invs ?? []) as { session_id: string }[]).map((i) => i.session_id);

  // Access if a tester OR invited to at least one class.
  if (!tester && invitedIds.length === 0) return NextResponse.json({ sessions: [], tester: false });

  const byId = new Map<string, { id: string; room: string; title: string }>();
  const add = (rows: { id: string; room_name: string; title: string | null }[]) => {
    for (const s of rows) byId.set(s.id, { id: s.id, room: s.room_name, title: s.title || s.room_name });
  };
  // Testers see every class opened to candidates…
  if (tester) {
    const { data } = await db.from("classroom_sessions").select("id, room_name, title").eq("status", "live").eq("open_to_candidates", true).order("started_at", { ascending: false }).limit(10);
    add((data ?? []) as { id: string; room_name: string; title: string | null }[]);
  }
  // …and ANYONE sees the live classes they were personally invited to.
  if (invitedIds.length) {
    const { data } = await db.from("classroom_sessions").select("id, room_name, title").eq("status", "live").in("id", invitedIds).order("started_at", { ascending: false }).limit(10);
    add((data ?? []) as { id: string; room_name: string; title: string | null }[]);
  }
  return NextResponse.json({ sessions: Array.from(byId.values()), tester: true });
}
