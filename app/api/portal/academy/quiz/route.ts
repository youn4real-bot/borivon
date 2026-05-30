/**
 * ACADEMY — candidate quiz API (load + submit). Self-only.
 *
 * Integrity rules (ECC security-review applied):
 *  - A candidate may only load/submit a quiz that is published AND in scope:
 *    either it belongs to their cohort, or it's curriculum-wide (cohort_id NULL)
 *    at their current level. Enforced server-side, never trusted from the client.
 *  - Correct answers are NEVER sent to the client for kind='mock_exam' (exam
 *    integrity). For homework/quiz they ARE sent so the daily-practice screen can
 *    give instant feedback — points are still graded server-side regardless.
 *  - Grading is server-authoritative. Submission is idempotent on
 *    (quiz, candidate): the FIRST submission is graded + paid; re-submits return
 *    the stored result and never re-pay (awardPoints upsert ignores dupes).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/admin-auth";
import { getServiceSupabase } from "@/lib/supabase";
import { awardPoints, POINT_RULES } from "@/lib/academyPoints";
import { enforceRateLimit } from "@/lib/rateLimit";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Question = {
  id: string;
  type?: "single" | "multi" | "text";
  prompt: string;
  options: string[];
  correct: number[];      // indices of correct option(s)
  points?: number;
  hint?: { en?: string; fr?: string; de?: string };
};

/** Is this candidate allowed to see/submit this quiz? */
async function inScope(
  db: ReturnType<typeof getServiceSupabase>,
  me: string,
  quiz: { cohort_id: string | null; level: string },
): Promise<boolean> {
  if (quiz.cohort_id) {
    const { data } = await db
      .from("academy_cohort_members")
      .select("candidate_user_id")
      .eq("cohort_id", quiz.cohort_id)
      .eq("candidate_user_id", me)
      .eq("status", "active")
      .maybeSingle();
    return !!data;
  }
  // curriculum-wide quiz → allowed if the candidate is at that level in any cohort
  const { data } = await db
    .from("academy_cohort_members")
    .select("current_level")
    .eq("candidate_user_id", me)
    .eq("status", "active");
  return ((data ?? []) as { current_level: string }[]).some(m => m.current_level === quiz.level);
}

// ── GET ?id=<quizId> — load a quiz to take ───────────────────────────────────
export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (!user.ok) return NextResponse.json({ error: user.error }, { status: user.status });
  const rl = enforceRateLimit(req, "academy-quiz-get", { limit: 60, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const me = user.userId;
  const db = getServiceSupabase();
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad quiz id" }, { status: 400 });

  const { data: quiz } = await db
    .from("academy_quizzes")
    .select("id, cohort_id, level, title, kind, questions, pass_score, points_award, due_at, published")
    .eq("id", id)
    .maybeSingle();
  if (!quiz || !(quiz as { published: boolean }).published) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const q = quiz as { id: string; cohort_id: string | null; level: string; title: string; kind: string; questions: Question[]; pass_score: number; points_award: number; due_at: string | null };
  if (!(await inScope(db, me, q))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // already submitted? return the stored result so the page shows the recap
  const { data: sub } = await db
    .from("academy_submissions")
    .select("score, passed, on_time, submitted_at")
    .eq("quiz_id", id)
    .eq("candidate_user_id", me)
    .maybeSingle();

  const isExam = q.kind === "mock_exam";
  const questions = (Array.isArray(q.questions) ? q.questions : []).map((qq, i) => ({
    id: qq.id ?? `q${i}`,
    type: qq.type ?? "single",
    prompt: qq.prompt ?? "",
    options: Array.isArray(qq.options) ? qq.options : [],
    points: qq.points ?? 1,
    hint: qq.hint ?? null,
    // exam → never leak the key; homework/quiz → send for instant feedback
    correct: isExam ? undefined : (Array.isArray(qq.correct) ? qq.correct : []),
  }));

  return NextResponse.json({
    id: q.id, title: q.title, kind: q.kind, level: q.level,
    passScore: q.pass_score, pointsAward: q.points_award, dueAt: q.due_at,
    instantFeedback: !isExam,
    questions,
    alreadyDone: sub ? { score: (sub as { score: number }).score, passed: (sub as { passed: boolean }).passed } : null,
  });
}

// ── POST { id, answers:[{questionId, choice}] } — submit + grade ──────────────
export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (!user.ok) return NextResponse.json({ error: user.error }, { status: user.status });
  const rl = enforceRateLimit(req, "academy-quiz-submit", { limit: 30, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const me = user.userId;
  const db = getServiceSupabase();
  const body = await req.json().catch(() => ({}));
  const id = String(body.id ?? "");
  const answers: { questionId: string; choice: number }[] = Array.isArray(body.answers) ? body.answers : [];
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad quiz id" }, { status: 400 });

  const { data: quiz } = await db
    .from("academy_quizzes")
    .select("id, cohort_id, level, kind, questions, pass_score, points_award, due_at, published")
    .eq("id", id)
    .maybeSingle();
  if (!quiz || !(quiz as { published: boolean }).published) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const q = quiz as { cohort_id: string | null; level: string; kind: string; questions: Question[]; pass_score: number; points_award: number; due_at: string | null };
  if (!(await inScope(db, me, q))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // idempotent: if already submitted, return the stored result (never re-grade/pay)
  const { data: existing } = await db
    .from("academy_submissions")
    .select("answers, score, passed, on_time")
    .eq("quiz_id", id)
    .eq("candidate_user_id", me)
    .maybeSingle();

  // server-authoritative grade
  const qs = (Array.isArray(q.questions) ? q.questions : []) as Question[];
  const answerMap = new Map(answers.map(a => [String(a.questionId), Number(a.choice)]));
  let earned = 0, total = 0;
  const perQuestion: { questionId: string; correct: boolean; correctIndex: number[] }[] = [];
  qs.forEach((qq, i) => {
    const qid = qq.id ?? `q${i}`;
    const pts = qq.points ?? 1;
    total += pts;
    const correctArr = Array.isArray(qq.correct) ? qq.correct : [];
    const picked = answerMap.get(qid);
    const isCorrect = picked != null && correctArr.length === 1 && correctArr[0] === picked;
    if (isCorrect) earned += pts;
    perQuestion.push({ questionId: qid, correct: isCorrect, correctIndex: correctArr });
  });
  const scorePct = total > 0 ? Math.round((earned / total) * 100) : 0;
  const passed = scorePct >= (q.pass_score ?? 60);
  const onTime = q.due_at ? new Date() <= new Date(q.due_at) : true;

  if (existing) {
    // already done — echo stored result + the answer key for the recap
    return NextResponse.json({
      already: true,
      score: (existing as { score: number }).score,
      passed: (existing as { passed: boolean }).passed,
      onTime: (existing as { on_time: boolean }).on_time,
      perQuestion,
    });
  }

  await db.from("academy_submissions").insert({
    quiz_id: id, candidate_user_id: me,
    answers, score: scorePct, passed, on_time: onTime,
    graded_at: new Date().toISOString(),
  });

  // award points (idempotent on candidate+type+source). base completion award +
  // pass / perfect / on-time bonuses — every one keyed to this quiz.
  const cohortId = q.cohort_id;
  let pointsEarned = 0;
  if ((q.points_award ?? 0) > 0) {
    await awardPoints({ candidateUserId: me, cohortId, type: "lesson_complete", sourceKind: "quiz", sourceId: id, points: q.points_award });
    pointsEarned += q.points_award;
  }
  if (passed)         { await awardPoints({ candidateUserId: me, cohortId, type: "quiz_pass",    sourceKind: "quiz", sourceId: id }); pointsEarned += POINT_RULES.quiz_pass; }
  if (scorePct === 100) { await awardPoints({ candidateUserId: me, cohortId, type: "quiz_perfect", sourceKind: "quiz", sourceId: id }); pointsEarned += POINT_RULES.quiz_perfect; }
  if (onTime)         { await awardPoints({ candidateUserId: me, cohortId, type: "quiz_ontime",  sourceKind: "quiz", sourceId: id }); pointsEarned += POINT_RULES.quiz_ontime; }

  return NextResponse.json({ already: false, score: scorePct, passed, onTime, pointsEarned, perQuestion });
}
