/**
 * ACADEMY — candidate "join class" API. Self-only.
 *
 * Returns a Daily join URL for a class the candidate is enrolled in. The URL
 * carries a per-candidate meeting token (user_id = their borivon id), so Daily's
 * participant.left webhook can attribute auto-attendance to the right student.
 *
 * Inert until Daily is configured: with no DAILY_API_KEY, meetingToken() returns
 * null and we hand back the plain room url (or null) — the class page then shows
 * a "video not ready" state instead of an embed.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/admin-auth";
import { getServiceSupabase } from "@/lib/supabase";
import { meetingToken } from "@/lib/daily";
import { enforceRateLimit } from "@/lib/rateLimit";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (!user.ok) return NextResponse.json({ error: user.error }, { status: user.status });
  const rl = enforceRateLimit(req, "academy-class", { limit: 60, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const me = user.userId;
  const db = getServiceSupabase();
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad session id" }, { status: 400 });

  const { data: sess } = await db
    .from("academy_class_sessions")
    .select("cohort_id, title, meeting_url, external_ref, ends_at")
    .eq("id", id)
    .maybeSingle();
  if (!sess) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const s = sess as { cohort_id: string; title: string; meeting_url: string | null; external_ref: string | null; ends_at: string | null };

  // must be an active member of this class's cohort
  const { data: member } = await db
    .from("academy_cohort_members")
    .select("candidate_user_id")
    .eq("cohort_id", s.cohort_id)
    .eq("candidate_user_id", me)
    .eq("status", "active")
    .maybeSingle();
  if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // build the join url with a token pinning this candidate's id (for attendance)
  let joinUrl: string | null = s.meeting_url;
  if (s.meeting_url && s.external_ref) {
    const { data: prof } = await db.from("candidate_profiles").select("first_name, last_name").eq("user_id", me).maybeSingle();
    const p = prof as { first_name: string | null; last_name: string | null } | null;
    const name = [p?.first_name, p?.last_name].filter(Boolean).join(" ") || "Student";
    const token = await meetingToken(s.external_ref, { userId: me, userName: name });
    if (token) joinUrl = `${s.meeting_url}?t=${token}`;
  }

  return NextResponse.json({ title: s.title, joinUrl, ended: !!s.ends_at });
}
