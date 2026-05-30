/**
 * ACADEMY — teacher (admin) API.
 *
 * Teacher == admin. Supreme Borivon admin runs every cohort; an org admin is
 * scoped to their organisation's cohorts + candidates (LAW #25). Every write is
 * gated by requireAdminRole, every per-candidate write by canActOnCandidate, and
 * every cohort touch by assertCohortInScope — so an org admin can never seed
 * points into, or take attendance for, a candidate outside their org.
 *
 * The ledger is the spine: attendance writes academy_attendance (the reliability
 * source) AND an idempotent academy_point_events row (the points source). A
 * re-mark updates the same ledger row (keyed candidate+type+source) instead of
 * stacking, so toggling present↔late never double-pays. Class bonus is an
 * idempotent ledger row per (candidate, session) — re-tapping is a no-op.
 *
 * No hard deletes: removing a student sets status='dropped' (soft), per the
 * project's no-permanent-delete rule.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, canActOnCandidate, ciEmail, getVisibleCandidateIds } from "@/lib/admin-auth";
import { getServiceSupabase } from "@/lib/supabase";
import { awardPoints } from "@/lib/academyPoints";
import { serverBroadcast } from "@/lib/serverBroadcast";
import { createRoom } from "@/lib/daily";
import { enforceRateLimit } from "@/lib/rateLimit";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEVELS = ["A1", "A2", "B1", "B2"] as const;

type Auth = Extract<Awaited<ReturnType<typeof requireAdminRole>>, { ok: true }>;

/** Org ids this admin belongs to (org-membership is the scoping trigger). */
async function getMyOrgs(email: string): Promise<string[]> {
  const db = getServiceSupabase();
  const { data } = await db
    .from("organization_members")
    .select("org_id")
    .ilike("sub_admin_email", ciEmail(email));
  return [...new Set(((data ?? []) as { org_id: string }[]).map(r => r.org_id))];
}

/**
 * True if this admin may touch this cohort (LAW #25):
 *   Supreme admin            → any cohort
 *   HQ Borivon sub-admin     → global (org_id NULL) cohorts  [sees all candidates]
 *   Org admin (in an org)    → only their org's cohorts
 */
async function cohortInScope(auth: Auth, cohortId: string): Promise<boolean> {
  if (auth.role === "admin") return true;
  const db = getServiceSupabase();
  const { data: c } = await db
    .from("academy_cohorts").select("org_id").eq("id", cohortId).maybeSingle();
  if (!c) return false;
  const orgId = (c as { org_id: string | null }).org_id;
  const myOrgs = await getMyOrgs(auth.email);
  if (myOrgs.length === 0) return orgId === null;        // HQ sub-admin → global cohorts
  return orgId != null && myOrgs.includes(orgId);        // org admin → their org's cohorts
}

async function nameMap(ids: string[]): Promise<Record<string, { name: string; photo: string | null }>> {
  if (ids.length === 0) return {};
  const db = getServiceSupabase();
  const { data } = await db
    .from("candidate_profiles")
    .select("user_id, first_name, last_name, profile_photo")
    .in("user_id", ids);
  const out: Record<string, { name: string; photo: string | null }> = {};
  for (const p of (data ?? []) as { user_id: string; first_name: string | null; last_name: string | null; profile_photo: string | null }[]) {
    out[p.user_id] = {
      name: [p.first_name, p.last_name].filter(Boolean).join(" ") || "",
      photo: p.profile_photo ?? null,
    };
  }
  return out;
}

// ── GET — views ──────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const db = getServiceSupabase();
  const url = new URL(req.url);
  const view = url.searchParams.get("view") ?? "cohorts";

  const isSupreme = auth.role === "admin";
  const myOrgs = isSupreme ? [] : await getMyOrgs(auth.email);

  // ── list cohorts in scope (+ member count + active session) ──────────────
  if (view === "cohorts") {
    let q = db.from("academy_cohorts").select("id, name, org_id, target_level, status, created_at").eq("status", "active");
    if (!isSupreme) {
      // HQ Borivon sub-admin (no org) → global cohorts; org admin → their orgs (LAW #25)
      if (myOrgs.length === 0) q = q.is("org_id", null);
      else q = q.in("org_id", myOrgs);
    }
    const { data: cohorts, error } = await q.order("created_at", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const ids = (cohorts ?? []).map((c: { id: string }) => c.id);
    // member counts + a live (un-ended) session per cohort
    const [{ data: members }, { data: sessions }] = await Promise.all([
      ids.length ? db.from("academy_cohort_members").select("cohort_id").eq("status", "active").in("cohort_id", ids) : Promise.resolve({ data: [] }),
      ids.length ? db.from("academy_class_sessions").select("id, cohort_id, title, level, starts_at, ends_at").in("cohort_id", ids).order("starts_at", { ascending: false }) : Promise.resolve({ data: [] }),
    ]);
    const count: Record<string, number> = {};
    for (const m of (members ?? []) as { cohort_id: string }[]) count[m.cohort_id] = (count[m.cohort_id] ?? 0) + 1;
    const liveByCohort: Record<string, { id: string; title: string; level: string }> = {};
    for (const s of (sessions ?? []) as { id: string; cohort_id: string; title: string; level: string; ends_at: string | null }[]) {
      if (!s.ends_at && !liveByCohort[s.cohort_id]) liveByCohort[s.cohort_id] = { id: s.id, title: s.title, level: s.level };
    }
    return NextResponse.json({
      cohorts: (cohorts ?? []).map((c: { id: string; name: string; target_level: string }) => ({
        id: c.id, name: c.name, targetLevel: c.target_level,
        memberCount: count[c.id] ?? 0,
        activeSession: liveByCohort[c.id] ?? null,
      })),
    });
  }

  // ── cohort detail: members + recent sessions + active session ────────────
  if (view === "cohort") {
    const id = url.searchParams.get("id") ?? "";
    if (!UUID.test(id)) return NextResponse.json({ error: "Bad cohort id" }, { status: 400 });
    if (!(await cohortInScope(auth, id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const [{ data: members }, { data: sessions }] = await Promise.all([
      db.from("academy_cohort_members").select("candidate_user_id, current_level, status").eq("cohort_id", id).eq("status", "active"),
      db.from("academy_class_sessions").select("id, title, level, starts_at, ends_at").eq("cohort_id", id).order("starts_at", { ascending: false }).limit(10),
    ]);
    const memberIds = (members ?? []).map((m: { candidate_user_id: string }) => m.candidate_user_id);
    const names = await nameMap(memberIds);
    const active = (sessions ?? []).find((s: { ends_at: string | null }) => !s.ends_at) ?? null;

    // if there's an active session, pull its existing marks so re-open shows them
    let marks: Record<string, string> = {};
    if (active) {
      const { data: att } = await db.from("academy_attendance").select("candidate_user_id, status").eq("session_id", (active as { id: string }).id);
      marks = Object.fromEntries(((att ?? []) as { candidate_user_id: string; status: string }[]).map(a => [a.candidate_user_id, a.status]));
    }

    return NextResponse.json({
      members: (members ?? []).map((m: { candidate_user_id: string; current_level: string }) => ({
        candidateUserId: m.candidate_user_id,
        name: names[m.candidate_user_id]?.name || "—",
        photo: names[m.candidate_user_id]?.photo ?? null,
        level: m.current_level,
      })),
      sessions: (sessions ?? []).map((s: { id: string; title: string; level: string; starts_at: string; ends_at: string | null }) => ({
        id: s.id, title: s.title, level: s.level, startsAt: s.starts_at, ended: !!s.ends_at,
      })),
      activeSession: active ? { id: (active as { id: string }).id, title: (active as { title: string }).title, marks } : null,
    });
  }

  // ── candidate picker (scoped): who can I add to this cohort ───────────────
  if (view === "candidates") {
    const cohortId = url.searchParams.get("cohortId") ?? "";
    let alreadyIn = new Set<string>();
    if (UUID.test(cohortId)) {
      const { data: mem } = await db.from("academy_cohort_members").select("candidate_user_id").eq("cohort_id", cohortId).eq("status", "active");
      alreadyIn = new Set(((mem ?? []) as { candidate_user_id: string }[]).map(m => m.candidate_user_id));
    }
    // candidate universe = candidate_profiles, scoped via LAW #25.
    // getVisibleCandidateIds: null = sees all (supreme / HQ sub-admin),
    // array = only that org admin's approved candidates ([] → none).
    let q = db.from("candidate_profiles").select("user_id, first_name, last_name, profile_photo");
    if (!isSupreme) {
      const visible = await getVisibleCandidateIds(auth.email);
      if (visible !== null) {
        if (visible.length === 0) return NextResponse.json({ candidates: [] });
        q = q.in("user_id", visible);
      }
    }
    const { data: profs } = await q.limit(500);
    return NextResponse.json({
      candidates: ((profs ?? []) as { user_id: string; first_name: string | null; last_name: string | null; profile_photo: string | null }[])
        .map(p => ({
          userId: p.user_id,
          name: [p.first_name, p.last_name].filter(Boolean).join(" ") || "—",
          photo: p.profile_photo ?? null,
          inCohort: alreadyIn.has(p.user_id),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  }

  // ── quizzes for a cohort (+ submission counts) ───────────────────────────
  if (view === "quizzes") {
    const id = url.searchParams.get("cohortId") ?? "";
    if (!UUID.test(id)) return NextResponse.json({ error: "Bad cohort id" }, { status: 400 });
    if (!(await cohortInScope(auth, id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const { data: quizzes } = await db
      .from("academy_quizzes")
      .select("id, title, kind, level, questions, pass_score, points_award, published, created_at")
      .eq("cohort_id", id)
      .order("created_at", { ascending: false });
    const ids = (quizzes ?? []).map((q: { id: string }) => q.id);
    const { data: subs } = ids.length
      ? await db.from("academy_submissions").select("quiz_id").in("quiz_id", ids)
      : { data: [] };
    const subCount: Record<string, number> = {};
    for (const s of (subs ?? []) as { quiz_id: string }[]) subCount[s.quiz_id] = (subCount[s.quiz_id] ?? 0) + 1;
    return NextResponse.json({
      quizzes: (quizzes ?? []).map((q: { id: string; title: string; kind: string; level: string; questions: unknown[]; points_award: number; published: boolean }) => ({
        id: q.id, title: q.title, kind: q.kind, level: q.level,
        questionCount: Array.isArray(q.questions) ? q.questions.length : 0,
        pointsAward: q.points_award, published: q.published,
        submissions: subCount[q.id] ?? 0,
      })),
    });
  }

  return NextResponse.json({ error: "Unknown view" }, { status: 400 });
}

// ── POST — actions ───────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const rl = enforceRateLimit(req, "academy-admin", { limit: 120, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const db = getServiceSupabase();
  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "");

  // create_cohort — org admin's cohort is bound to their org; supreme → global
  if (action === "create_cohort") {
    const name = String(body.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
    // org admin → bound to their org; HQ Borivon sub-admin (no org) → global (NULL)
    let orgId: string | null = null;
    if (auth.role !== "admin") {
      const myOrgs = await getMyOrgs(auth.email);
      orgId = myOrgs[0] ?? null;
    }
    const { data, error } = await db.from("academy_cohorts")
      .insert({ name, org_id: orgId, created_by: auth.email })
      .select("id").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, cohortId: (data as { id: string }).id });
  }

  // add_members — validate scope + per-candidate authorization
  if (action === "add_members") {
    const cohortId = String(body.cohortId ?? "");
    const ids: string[] = Array.isArray(body.candidateIds) ? body.candidateIds.filter((x: unknown) => typeof x === "string" && UUID.test(x)) : [];
    const level = LEVELS.includes(body.level) ? body.level : "A1";
    if (!UUID.test(cohortId)) return NextResponse.json({ error: "Bad cohort id" }, { status: 400 });
    if (!(await cohortInScope(auth, cohortId))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (ids.length === 0) return NextResponse.json({ error: "No candidates" }, { status: 400 });

    const allowed: string[] = [];
    for (const cid of ids) {
      if (await canActOnCandidate(auth.role, auth.email, cid)) allowed.push(cid);
    }
    if (allowed.length === 0) return NextResponse.json({ error: "None allowed" }, { status: 403 });
    const rows = allowed.map(cid => ({ cohort_id: cohortId, candidate_user_id: cid, current_level: level, status: "active" }));
    const { error } = await db.from("academy_cohort_members").upsert(rows, { onConflict: "cohort_id,candidate_user_id", ignoreDuplicates: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, added: allowed.length });
  }

  // remove_member — SOFT (status='dropped'), never hard-delete
  if (action === "remove_member") {
    const cohortId = String(body.cohortId ?? "");
    const cid = String(body.candidateId ?? "");
    if (!UUID.test(cohortId) || !UUID.test(cid)) return NextResponse.json({ error: "Bad id" }, { status: 400 });
    if (!(await cohortInScope(auth, cohortId))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const { error } = await db.from("academy_cohort_members").update({ status: "dropped" }).eq("cohort_id", cohortId).eq("candidate_user_id", cid);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // start_session
  if (action === "start_session") {
    const cohortId = String(body.cohortId ?? "");
    const title = String(body.title ?? "").trim() || "Class";
    const level = LEVELS.includes(body.level) ? body.level : "A1";
    if (!UUID.test(cohortId)) return NextResponse.json({ error: "Bad cohort id" }, { status: 400 });
    if (!(await cohortInScope(auth, cohortId))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    // Spin up a Daily room for live video + auto-attendance. Returns null when
    // Daily isn't configured yet → session is created exactly as before (manual
    // attendance still works). Best-effort: a room failure never blocks class.
    const room = await createRoom();
    const { data, error } = await db.from("academy_class_sessions")
      .insert({
        cohort_id: cohortId, title, level, starts_at: new Date().toISOString(), created_by: auth.email,
        meeting_url: room?.url ?? null, external_ref: room?.name ?? null, meeting_provider: room ? "daily" : null,
      })
      .select("id").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, sessionId: (data as { id: string }).id });
  }

  // end_session
  if (action === "end_session") {
    const sessionId = String(body.sessionId ?? "");
    if (!UUID.test(sessionId)) return NextResponse.json({ error: "Bad session id" }, { status: 400 });
    const { data: sess } = await db.from("academy_class_sessions").select("cohort_id").eq("id", sessionId).maybeSingle();
    if (!sess) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!(await cohortInScope(auth, (sess as { cohort_id: string }).cohort_id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const { error } = await db.from("academy_class_sessions").update({ ends_at: new Date().toISOString() }).eq("id", sessionId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // mark_attendance — writes academy_attendance (reliability) + ledger (points)
  if (action === "mark_attendance") {
    const sessionId = String(body.sessionId ?? "");
    const marks: { candidateId: string; status: string }[] = Array.isArray(body.marks) ? body.marks : [];
    if (!UUID.test(sessionId)) return NextResponse.json({ error: "Bad session id" }, { status: 400 });
    const { data: sess } = await db.from("academy_class_sessions").select("cohort_id").eq("id", sessionId).maybeSingle();
    if (!sess) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const cohortId = (sess as { cohort_id: string }).cohort_id;
    if (!(await cohortInScope(auth, cohortId))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const POINTS: Record<string, number> = { present: 10, late: 4, absent: 0, excused: 0 };
    let written = 0;
    for (const m of marks) {
      const cid = String(m.candidateId ?? "");
      const status = String(m.status ?? "");
      if (!UUID.test(cid) || !["present", "late", "absent", "excused"].includes(status)) continue;
      if (!(await canActOnCandidate(auth.role, auth.email, cid))) continue;

      // 1) attendance row (reliability source)
      await db.from("academy_attendance").upsert(
        { session_id: sessionId, candidate_user_id: cid, status, source: "admin", recorded_at: new Date().toISOString() },
        { onConflict: "session_id,candidate_user_id", ignoreDuplicates: false },
      );
      // 2) ledger row (points) — single 'attendance' row per session, re-mark UPDATES it
      await db.from("academy_point_events").upsert(
        {
          candidate_user_id: cid, cohort_id: cohortId, type: "attendance", points: POINTS[status] ?? 0,
          source_kind: "session", source_id: sessionId, meta: { status }, created_by: auth.email,
        },
        { onConflict: "candidate_user_id,type,source_kind,source_id", ignoreDuplicates: false },
      );
      written++;
      serverBroadcast(`academy:${cid}`, "points", { reason: "attendance" }).catch(() => {});
    }
    return NextResponse.json({ ok: true, marked: written });
  }

  // class_bonus — idempotent +N to everyone present/late in the session
  if (action === "class_bonus") {
    const sessionId = String(body.sessionId ?? "");
    const points = Number.isFinite(body.points) ? Math.max(0, Math.min(100, Math.round(body.points))) : 15;
    if (!UUID.test(sessionId)) return NextResponse.json({ error: "Bad session id" }, { status: 400 });
    const { data: sess } = await db.from("academy_class_sessions").select("cohort_id").eq("id", sessionId).maybeSingle();
    if (!sess) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const cohortId = (sess as { cohort_id: string }).cohort_id;
    if (!(await cohortInScope(auth, cohortId))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { data: att } = await db.from("academy_attendance").select("candidate_user_id, status").eq("session_id", sessionId);
    const rewardable = ((att ?? []) as { candidate_user_id: string; status: string }[]).filter(a => a.status === "present" || a.status === "late");
    let sent = 0;
    for (const a of rewardable) {
      if (!(await canActOnCandidate(auth.role, auth.email, a.candidate_user_id))) continue;
      const isNew = await awardPoints({
        candidateUserId: a.candidate_user_id, cohortId, type: "class_bonus",
        sourceKind: "session", sourceId: sessionId, points, createdBy: auth.email,
      });
      if (isNew) {
        sent++;
        serverBroadcast(`academy:${a.candidate_user_id}`, "points", { reason: "class_bonus", points }).catch(() => {});
      }
    }
    return NextResponse.json({ ok: true, sent, total: rewardable.length });
  }

  // create_quiz — teacher authors a quiz/homework/exam for a cohort
  if (action === "create_quiz") {
    const cohortId = String(body.cohortId ?? "");
    if (!UUID.test(cohortId)) return NextResponse.json({ error: "Bad cohort id" }, { status: 400 });
    if (!(await cohortInScope(auth, cohortId))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const title = String(body.title ?? "").trim();
    if (!title) return NextResponse.json({ error: "Title required" }, { status: 400 });
    const kind = ["quiz", "homework", "mock_exam"].includes(body.kind) ? body.kind : "homework";
    const level = LEVELS.includes(body.level) ? body.level : "A1";

    // sanitize questions: prompt + 2..6 options + exactly one correct index + points
    const rawQs: unknown[] = Array.isArray(body.questions) ? body.questions : [];
    const questions = rawQs.map((raw) => {
      const r = raw as { prompt?: string; options?: string[]; correct?: number[] | number; points?: number };
      const options = (Array.isArray(r.options) ? r.options : []).map(o => String(o)).filter(o => o.trim()).slice(0, 6);
      let correct: number[] = [];
      if (Array.isArray(r.correct)) correct = r.correct.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n < options.length);
      else if (typeof r.correct === "number" && r.correct >= 0 && r.correct < options.length) correct = [r.correct];
      return {
        id: globalThis.crypto.randomUUID(),
        type: "single" as const,
        prompt: String(r.prompt ?? "").trim(),
        options,
        correct: correct.slice(0, 1), // single-choice for now
        points: Number.isFinite(r.points) ? Math.max(1, Math.min(10, Math.round(r.points as number))) : 1,
      };
    }).filter(q => q.prompt && q.options.length >= 2 && q.correct.length === 1);

    if (questions.length === 0) return NextResponse.json({ error: "Add at least one complete question" }, { status: 400 });

    const pointsAward = Number.isFinite(body.pointsAward) ? Math.max(0, Math.min(100, Math.round(body.pointsAward))) : 10;
    const passScore = Number.isFinite(body.passScore) ? Math.max(0, Math.min(100, Math.round(body.passScore))) : 60;
    const dueAt = typeof body.dueAt === "string" && body.dueAt ? new Date(body.dueAt).toISOString() : null;
    const published = body.published !== false; // default published

    const { data, error } = await db.from("academy_quizzes").insert({
      cohort_id: cohortId, level, title, kind, questions,
      pass_score: passScore, points_award: pointsAward, due_at: dueAt, published, created_by: auth.email,
    }).select("id").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, quizId: (data as { id: string }).id });
  }

  // toggle_quiz publish
  if (action === "toggle_quiz") {
    const quizId = String(body.quizId ?? "");
    if (!UUID.test(quizId)) return NextResponse.json({ error: "Bad quiz id" }, { status: 400 });
    const { data: qz } = await db.from("academy_quizzes").select("cohort_id, published").eq("id", quizId).maybeSingle();
    if (!qz) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const cid = (qz as { cohort_id: string | null }).cohort_id;
    if (!cid || !(await cohortInScope(auth, cid))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const { error } = await db.from("academy_quizzes").update({ published: !(qz as { published: boolean }).published }).eq("id", quizId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, published: !(qz as { published: boolean }).published });
  }

  // set_level — climb the CEFR ladder. Awards level_up once per level reached
  // (idempotent via a fixed per-level source id), broadcasts to the student.
  if (action === "set_level") {
    const cohortId = String(body.cohortId ?? "");
    const cid = String(body.candidateId ?? "");
    const level = LEVELS.includes(body.level) ? body.level : null;
    if (!UUID.test(cohortId) || !UUID.test(cid) || !level) return NextResponse.json({ error: "Bad input" }, { status: 400 });
    if (!(await cohortInScope(auth, cohortId))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (!(await canActOnCandidate(auth.role, auth.email, cid))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { data: cur } = await db.from("academy_cohort_members").select("current_level").eq("cohort_id", cohortId).eq("candidate_user_id", cid).maybeSingle();
    const oldLevel = (cur as { current_level: string } | null)?.current_level ?? "A1";
    const { error } = await db.from("academy_cohort_members").update({ current_level: level }).eq("cohort_id", cohortId).eq("candidate_user_id", cid);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // award level_up only when climbing UP, idempotent per target level
    const LEVEL_UP_EVENT: Record<string, string> = {
      A2: "a2000000-0000-4000-8000-000000000002",
      B1: "b1000000-0000-4000-8000-000000000001",
      B2: "b2000000-0000-4000-8000-000000000002",
    };
    const lvls = LEVELS as readonly string[];
    if (lvls.indexOf(level) > lvls.indexOf(oldLevel) && LEVEL_UP_EVENT[level]) {
      await awardPoints({ candidateUserId: cid, cohortId, type: "level_up", sourceKind: "system", sourceId: LEVEL_UP_EVENT[level], meta: { level } });
      serverBroadcast(`academy:${cid}`, "points", { reason: "level_up", level }).catch(() => {});
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
