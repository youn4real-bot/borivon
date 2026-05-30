/**
 * ACADEMY — candidate summary API (read-only, self-only).
 *
 * Everything the Academy home renders, derived live from the ledger + tables so
 * nothing can drift: my level, my 30-day points + rank, the gap to the person
 * above me, my streak, my employer-facing reliability snapshot, the weekly
 * leaderboard (with faces), and my next/live class. A candidate can only ever
 * read their OWN row — requireUser pins every query to their user id.
 *
 * If the candidate isn't in a cohort yet → { enrolled:false } and the page shows
 * a friendly "you'll be added to a class soon" state instead of zeros.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/admin-auth";
import { getServiceSupabase } from "@/lib/supabase";
import { getCohortLeaderboard, getStreakDays, getReliability } from "@/lib/academyPoints";
import { enforceRateLimit } from "@/lib/rateLimit";

const NEXT_LEVEL: Record<string, string> = { A1: "A2", A2: "B1", B1: "B2", B2: "B2" };

export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (!user.ok) return NextResponse.json({ error: user.error }, { status: user.status });
  // Generous — this is re-fetched on every realtime ping (attendance/bonus).
  const rl = enforceRateLimit(req, "academy-me", { limit: 240, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const me = user.userId;
  const db = getServiceSupabase();

  // current cohort (most recent active membership)
  const { data: mem } = await db
    .from("academy_cohort_members")
    .select("cohort_id, current_level, joined_at")
    .eq("candidate_user_id", me)
    .eq("status", "active")
    .order("joined_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!mem) {
    // not in a class yet — still surface streak/reliability if any history exists
    const [streak, rel] = await Promise.all([getStreakDays(me), getReliability(me)]);
    return NextResponse.json({ enrolled: false, streak, reliability: relShape(rel) });
  }

  const cohortId = (mem as { cohort_id: string }).cohort_id;
  const level = (mem as { current_level: string }).current_level;
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const now = new Date();
  const startToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();

  const [board, streak, rel, cohort, nextSession, homework, todayEvents] = await Promise.all([
    getCohortLeaderboard(cohortId, since30),
    getStreakDays(me),
    getReliability(me),
    db.from("academy_cohorts").select("name, target_level").eq("id", cohortId).maybeSingle(),
    nextClass(cohortId),
    pendingHomework(cohortId, level, me),
    db.from("academy_point_events").select("type, points").eq("candidate_user_id", me).gte("created_at", startToday),
  ]);

  // "active today" → streak is safe without homework; "bonus today" → celebrate
  const todayRows = (todayEvents.data ?? []) as { type: string; points: number }[];
  const activeToday = todayRows.length > 0;
  const bonusToday = todayRows.filter(r => r.type === "class_bonus").reduce((s, r) => s + (r.points ?? 0), 0) || null;

  // resolve names for the leaderboard. PRIVACY: classmates are shown to peers as
  // "First L." only (never full last name); the nudge uses first name alone.
  const ids = board.map(r => r.candidateUserId);
  const names = await nameMap(ids);
  const shortName = (id: string) => {
    const n = names[id];
    if (!n || !n.first) return "—";
    return n.last ? `${n.first} ${n.last[0]}.` : n.first;
  };
  const leaderboard = board.map((r, i) => ({
    rank: i + 1,
    name: shortName(r.candidateUserId),
    photo: names[r.candidateUserId]?.photo ?? null,
    points: r.points,
    me: r.candidateUserId === me,
  }));

  const myIdx = board.findIndex(r => r.candidateUserId === me);
  const myPoints = myIdx >= 0 ? board[myIdx].points : 0;
  const myRank = myIdx >= 0 ? myIdx + 1 : board.length + 1;
  const ahead = myIdx > 0 ? board[myIdx - 1] : null;
  const aheadGap = ahead ? ahead.points - myPoints : 0;
  const aheadName = ahead ? (names[ahead.candidateUserId]?.first || "—") : null;

  return NextResponse.json({
    enrolled: true,
    cohortName: (cohort.data as { name: string } | null)?.name ?? "",
    level,
    nextLevel: NEXT_LEVEL[level] ?? "B2",
    targetLevel: (cohort.data as { target_level: string } | null)?.target_level ?? "B2",
    points: myPoints,
    rank: myRank,
    streak,
    aheadName,
    aheadGap,
    reliability: relShape(rel),
    leaderboard,
    nextClass: nextSession,
    homework,
    activeToday,
    bonusToday,
  });
}

function relShape(rel: Awaited<ReturnType<typeof getReliability>>) {
  const index = rel.sessions > 0
    ? Math.round(100 * (0.6 * rel.attendanceRate + 0.4 * rel.punctualityRate))
    : null;
  return {
    index,
    attendancePct: rel.sessions > 0 ? Math.round(rel.attendanceRate * 100) : null,
    onTimePct: rel.quizzes > 0 ? Math.round(rel.onTimeRate * 100) : null,
    sessions: rel.sessions,
  };
}

async function nextClass(cohortId: string): Promise<{ id: string; title: string; startsAt: string; live: boolean } | null> {
  const db = getServiceSupabase();
  // a live (un-ended) session wins; else the next upcoming one
  const { data: live } = await db
    .from("academy_class_sessions")
    .select("id, title, starts_at, ends_at")
    .eq("cohort_id", cohortId)
    .is("ends_at", null)
    .order("starts_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (live) return { id: (live as { id: string }).id, title: (live as { title: string }).title, startsAt: (live as { starts_at: string }).starts_at, live: true };

  const { data: upc } = await db
    .from("academy_class_sessions")
    .select("id, title, starts_at")
    .eq("cohort_id", cohortId)
    .gte("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (upc) return { id: (upc as { id: string }).id, title: (upc as { title: string }).title, startsAt: (upc as { starts_at: string }).starts_at, live: false };
  return null;
}

async function pendingHomework(cohortId: string, level: string, me: string): Promise<{ id: string; title: string; questions: number; points: number } | null> {
  const db = getServiceSupabase();
  // published quizzes for this cohort OR curriculum-wide at my level
  const { data: quizzes } = await db
    .from("academy_quizzes")
    .select("id, title, questions, points_award, cohort_id, level, kind")
    .eq("published", true)
    .or(`cohort_id.eq.${cohortId},and(cohort_id.is.null,level.eq.${level})`)
    .order("due_at", { ascending: true })
    .limit(20);
  const list = (quizzes ?? []) as { id: string; title: string; questions: unknown[]; points_award: number }[];
  if (list.length === 0) return null;

  // exclude ones I've already submitted
  const { data: subs } = await db.from("academy_submissions").select("quiz_id").eq("candidate_user_id", me);
  const done = new Set(((subs ?? []) as { quiz_id: string }[]).map(s => s.quiz_id));
  const next = list.find(q => !done.has(q.id));
  if (!next) return null;
  return {
    id: next.id, title: next.title,
    questions: Array.isArray(next.questions) ? next.questions.length : 0,
    points: next.points_award ?? 0,
  };
}

async function nameMap(ids: string[]): Promise<Record<string, { first: string; last: string; photo: string | null }>> {
  if (ids.length === 0) return {};
  const db = getServiceSupabase();
  const { data } = await db
    .from("candidate_profiles")
    .select("user_id, first_name, last_name, profile_photo")
    .in("user_id", ids);
  const out: Record<string, { first: string; last: string; photo: string | null }> = {};
  for (const p of (data ?? []) as { user_id: string; first_name: string | null; last_name: string | null; profile_photo: string | null }[]) {
    out[p.user_id] = { first: (p.first_name ?? "").trim(), last: (p.last_name ?? "").trim(), photo: p.profile_photo ?? null };
  }
  return out;
}
