import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin-auth";
import { getServiceSupabase } from "@/lib/supabase";
import { computeEngagement, computeSessionSummaries, type ClassroomEvent, type ClassroomSession } from "@/lib/classroomEngagement";

/**
 * SUPREME-ADMIN-ONLY (testing phase): per-person engagement scorecard, computed
 * live from the classroom_events ledger (never stored → never drifts). Camera-on
 * %, speaking share, participation actions, punctuality, attendance, camera
 * discipline, disengagement flag → one composite score. The sellable artifact.
 *
 * GET            → { rows, sessions, sessionSummaries, totalEvents }
 * GET ?session=X → { sessionId, rows }  (per-person detail for ONE session)
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden — supreme admin only" }, { status: 403 });

  const db = getServiceSupabase();

  const { data: sessRows } = await db
    .from("classroom_sessions")
    .select("id, title, room_name, status, started_at, ended_at")
    .order("started_at", { ascending: false });
  const sessions = (sessRows ?? []) as { id: string; title: string | null; room_name: string; status: string | null; started_at: string | null; ended_at: string | null }[];

  // Pull the ledger (capped — testing phase). Interval math needs them ordered.
  const { data: evRows, error: evErr } = await db
    .from("classroom_events")
    .select("session_id, user_id, display_name, kind, value, at")
    .order("at", { ascending: true })
    .limit(20000);
  if (evErr) { console.error("[classroom/engagement] events error:", evErr.message); return NextResponse.json({ error: "load_failed" }, { status: 500 }); }
  const events = (evRows ?? []) as ClassroomEvent[];

  // Resolve canonical names (candidate_profiles) for the people in the ledger.
  const ids = Array.from(new Set(events.map((e) => e.user_id).filter((x): x is string => !!x)));
  const names: Record<string, string> = {};
  if (ids.length) {
    const { data: profs } = await db.from("candidate_profiles").select("user_id, first_name, last_name").in("user_id", ids);
    for (const p of (profs ?? []) as { user_id: string; first_name: string | null; last_name: string | null }[]) {
      const n = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
      if (n) names[p.user_id] = n;
    }
  }

  // Per-session drill-down: per-person stats for ONE session only.
  const sessionId = req.nextUrl.searchParams.get("session");
  if (sessionId) {
    const s = sessions.find((x) => x.id === sessionId);
    if (!s) return NextResponse.json({ sessionId, rows: [] });
    const scoped = events.filter((e) => e.session_id === sessionId);
    return NextResponse.json({ sessionId, rows: computeEngagement(scoped, [s] as ClassroomSession[], names) });
  }

  const rows = computeEngagement(events, sessions as ClassroomSession[], names);
  const sessionSummaries = computeSessionSummaries(events, sessions as ClassroomSession[], names);

  return NextResponse.json({
    rows,
    sessions: sessions.map((s) => ({ id: s.id, title: s.title || s.room_name, room: s.room_name, status: s.status, startedAt: s.started_at, endedAt: s.ended_at })),
    sessionSummaries,
    totalEvents: events.length,
  });
}
