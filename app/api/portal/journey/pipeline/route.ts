import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole, getVisibleCandidateIds, getStaffUserIdsAmong } from "@/lib/admin-auth";
import { computePipelineStatus, type JourneyRow } from "@/lib/journeyPipeline";
import { evaluateSellable } from "@/lib/sellable";
import { normalizeB2Stage, isB2Passed, effectiveB2Stage } from "@/lib/b2Journey";
import { normalizeAnerkennungStage } from "@/lib/anerkennungJourney";
import { computeDocPack } from "@/lib/recognitionDocs";
import { deriveImpfungStage, doseProgress, normalizeReq, NO_REQ, type VaccineReq } from "@/lib/impfungJourney";

/**
 * Anerkennung / Visa Autopilot — pipeline overview (the admin "who's stuck where"
 * board). Returns EVERY candidate the caller may see, each with a computed
 * status (current step, progress, overdue/blocked counts, health).
 *
 * Scope: supreme admin + global sub-admins → all candidates; org-scoped
 * sub-admins → only their org's candidates (getVisibleCandidateIds, LAW #25).
 * Read-only; the actual edits happen through /api/portal/journey.
 */

export const dynamic = "force-dynamic";

// "today" in Casablanca (the business timezone) → deterministic deadline math.
function casablancaToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Casablanca", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date()); // en-CA → "YYYY-MM-DD"
}

type ProfileRow = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  profile_photo: string | null;
  b2_stage: string | null;
  b2_failed: boolean | null;
  nursing_specialty: string | null;
  years_experience: number | null;
  current_workplace: string | null;
  available_from: string | null;
  anerkennung_stage: string | null;
};

export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db = getServiceSupabase();

  // Visibility scope: null = sees all (supreme / global staff); [] or list = scoped.
  const visible = auth.role === "admin" ? null : await getVisibleCandidateIds(auth.email);

  // Load candidate profiles in scope.
  let profQ = db
    .from("candidate_profiles")
    .select("user_id, first_name, last_name, profile_photo, b2_stage, b2_failed, nursing_specialty, years_experience, current_workplace, available_from, anerkennung_stage");
  if (visible !== null) {
    if (visible.length === 0) return NextResponse.json({ today: casablancaToday(), candidates: [] });
    profQ = profQ.in("user_id", visible);
  }
  const { data: profData, error: profErr } = await profQ;
  if (profErr) {
    console.error("[journey/pipeline] profiles error:", profErr.message);
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }
  const allProfiles = (profData ?? []) as ProfileRow[];
  if (allProfiles.length === 0) return NextResponse.json({ today: casablancaToday(), candidates: [] });

  // STAFF are NOT candidates. The supreme admin, sub-admins and org members can
  // each have a candidate_profiles row (they open the candidate dashboard once),
  // but they must never appear on the people map. Strip them out.
  const staffIds = await getStaffUserIdsAmong(allProfiles.map((p) => p.user_id));
  const profiles = allProfiles.filter((p) => !staffIds.has(p.user_id));
  if (profiles.length === 0) return NextResponse.json({ today: casablancaToday(), candidates: [] });

  const ids = profiles.map((p) => p.user_id);

  // Pull every journey row for those candidates in ONE query (no N+1), then
  // group in memory and compute each candidate's status.
  const { data: itemData, error: itemErr } = await db
    .from("candidate_journey_items")
    .select("id, candidate_user_id, text, owner, done, done_at, preset_key, position, due_date, blocked, blocked_reason")
    .in("candidate_user_id", ids);
  if (itemErr) {
    console.error("[journey/pipeline] items error:", itemErr.message);
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }

  const byCandidate = new Map<string, JourneyRow[]>();
  for (const r of (itemData ?? []) as (JourneyRow & { candidate_user_id: string })[]) {
    const arr = byCandidate.get(r.candidate_user_id) ?? [];
    arr.push(r);
    byCandidate.set(r.candidate_user_id, arr);
  }

  // Documents (only what the sellable gate needs) for the same candidates — one
  // batched query. Powers the "ready to sell" verdict per candidate.
  const { data: docData } = await db
    .from("documents")
    .select("user_id, file_type, status, created_at")
    .in("user_id", ids);
  const docsByCandidate = new Map<string, { file_type: string | null; status: string | null }[]>();
  for (const d of (docData ?? []) as { user_id: string; file_type: string | null; status: string | null }[]) {
    const arr = docsByCandidate.get(d.user_id) ?? [];
    arr.push({ file_type: d.file_type, status: d.status });
    docsByCandidate.set(d.user_id, arr);
  }

  // ── Impfung (vaccination) inputs — all batched, no N+1 ──────────────────────
  // 1. each candidate's vaccines blob (candidate_status.vaccines)
  const vaxByCandidate = new Map<string, unknown>();
  {
    const { data } = await db.from("candidate_status").select("user_id, vaccines").in("user_id", ids);
    for (const r of (data ?? []) as { user_id: string; vaccines: unknown }[]) vaxByCandidate.set(r.user_id, r.vaccines);
  }
  // 2. each candidate's agency vaccine requirement (candidate_organizations → organizations.vaccine_req)
  const reqByCandidate = new Map<string, VaccineReq>();
  {
    const { data: links } = await db
      .from("candidate_organizations").select("candidate_user_id, org_id").in("candidate_user_id", ids).eq("status", "approved");
    const orgIds = [...new Set(((links ?? []) as { org_id: string }[]).map((l) => l.org_id))];
    const reqByOrg = new Map<string, VaccineReq>();
    if (orgIds.length) {
      const { data: orgs } = await db.from("organizations").select("id, vaccine_req").in("id", orgIds);
      for (const o of (orgs ?? []) as { id: string; vaccine_req: unknown }[]) reqByOrg.set(o.id, normalizeReq(o.vaccine_req));
    }
    // A candidate may link to several orgs — take the MAX requirement across them.
    for (const l of (links ?? []) as { candidate_user_id: string; org_id: string }[]) {
      const r = reqByOrg.get(l.org_id) ?? NO_REQ;
      const cur = reqByCandidate.get(l.candidate_user_id) ?? NO_REQ;
      reqByCandidate.set(l.candidate_user_id, { masern: Math.max(cur.masern, r.masern), varizell: Math.max(cur.varizell, r.varizell) });
    }
  }
  // 3. impfung document status per candidate (approved beats pending)
  const impfungDocStatus = new Map<string, "approved" | "pending">();
  for (const [uid, ds] of docsByCandidate) {
    const impfDocs = ds.filter((d) => /impf|vaccin|impfung/i.test(d.file_type ?? ""));
    if (impfDocs.some((d) => d.status === "approved")) impfungDocStatus.set(uid, "approved");
    else if (impfDocs.some((d) => d.status === "pending")) impfungDocStatus.set(uid, "pending");
  }

  // Candidate self-reports — what each candidate logged about themselves (passed
  // B2, interview, …). Most-recent-first, capped per candidate. Shown in the peek.
  const reportsByCandidate = new Map<string, { kind: string; outcome: string; note: string | null; created_at: string }[]>();
  {
    const { data } = await db
      .from("candidate_self_reports")
      .select("candidate_user_id, kind, outcome, note, created_at")
      .in("candidate_user_id", ids)
      .order("created_at", { ascending: false });
    for (const r of (data ?? []) as { candidate_user_id: string; kind: string; outcome: string; note: string | null; created_at: string }[]) {
      const arr = reportsByCandidate.get(r.candidate_user_id) ?? [];
      if (arr.length < 4) arr.push({ kind: r.kind, outcome: r.outcome, note: r.note, created_at: r.created_at });
      reportsByCandidate.set(r.candidate_user_id, arr);
    }
  }

  // Pipeline stage facts — interview outcomes + visa/flight/housing the admin
  // sets from the peek (candidate_pipeline). Batched. Drive board auto-advance.
  type PipeRow = { user_id: string; interview1_status: string | null; interview2_status: string | null; interview1_date: string | null; interview2_date: string | null; visa_appt_date: string | null; flight_date: string | null; flight_info: string | null; housing_done: boolean | null; visa_granted: boolean | null; visa_date: string | null; contract_done: boolean | null; recognition_done: boolean | null; vorab_done: boolean | null; docs_ready: boolean | null; arrived_done: boolean | null; updated_at: string | null };
  const pipeByCandidate = new Map<string, PipeRow>();
  {
    const { data } = await db
      .from("candidate_pipeline")
      .select("user_id, interview1_status, interview2_status, interview1_date, interview2_date, visa_appt_date, flight_date, flight_info, housing_done, visa_granted, visa_date, contract_done, recognition_done, vorab_done, docs_ready, arrived_done, updated_at")
      .in("user_id", ids);
    for (const r of (data ?? []) as PipeRow[]) pipeByCandidate.set(r.user_id, r);
  }

  // "Last activity" per candidate — newest of: a stage ticked, a doc uploaded, a
  // self-report, or an admin pipeline edit. Drives the weekly "needs an update"
  // reminder: no activity in 7 days (or ever) → the avatar pulses for attention.
  const nowMs = Date.now();
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const lastActivity = new Map<string, number>();
  const bump = (uid: string, ts: string | null | undefined) => {
    if (!ts) return;
    const t = Date.parse(ts);
    if (Number.isFinite(t) && t > (lastActivity.get(uid) ?? 0)) lastActivity.set(uid, t);
  };
  for (const r of (itemData ?? []) as { candidate_user_id: string; done?: boolean; done_at?: string | null }[]) {
    if (r.done && r.done_at) bump(r.candidate_user_id, r.done_at);
  }
  for (const d of (docData ?? []) as { user_id: string; created_at?: string | null }[]) bump(d.user_id, d.created_at);
  for (const [uid, reps] of reportsByCandidate) bump(uid, reps[0]?.created_at);
  for (const [uid, pp] of pipeByCandidate) bump(uid, pp.updated_at);

  const today = casablancaToday();
  const candidates = profiles.map((p) => {
    const journey = byCandidate.get(p.user_id) ?? [];
    const docs = docsByCandidate.get(p.user_id) ?? [];
    // B2 stage honors real evidence (an uploaded/approved B2 certificate) over
    // the stored field — so candidates appear on the B2 track by actually having
    // the cert, not by someone setting a dropdown.
    const b2Stage = effectiveB2Stage(normalizeB2Stage(p.b2_stage), docs);
    // Auto-derive rail milestones from REAL evidence so candidates move on the
    // map by actually doing the work, not by someone ticking a box:
    //   cv_finalized ← a Lebenslauf (German CV) document exists
    // NOTE: "Documents ready for embassy" (docs_collected) is a deliberate
    // visa-readiness judgement (ALL papers gathered) — NOT "has one approved
    // doc" — so it is NOT auto-derived; an admin/org marks it explicitly.
    const autoDone = new Set<string>();
    // CV is "finalized" only once an admin has APPROVED the Lebenslauf (green),
    // not merely uploaded — so candidates move here on real approval.
    if (docs.some((d) => d.status === "approved" && /lebenslauf/i.test(d.file_type ?? ""))) autoDone.add("cv_finalized");
    // Auto-advance from the admin's guided-peek answers (candidate_pipeline). The
    // admin walks one question at a time; each answer ticks its milestone here so
    // the board + map move in lock-step. "Documents ready for embassy" stays a
    // deliberate judgement — it advances only when the admin explicitly confirms
    // docs_ready in the wizard (never from "one approved doc exists").
    const pipe = pipeByCandidate.get(p.user_id);
    if (pipe?.interview1_status === "passed") autoDone.add("interview_first");
    if (pipe?.interview2_status === "passed") autoDone.add("interview_second");
    if (pipe?.contract_done === true) autoDone.add("contract_signed");
    if (pipe?.recognition_done === true) autoDone.add("recognition_submitted");
    if (pipe?.vorab_done === true) autoDone.add("vorabzustimmung");
    if (pipe?.docs_ready === true) autoDone.add("docs_collected");
    if (pipe?.visa_appt_date) autoDone.add("visa_appointment");
    if (pipe?.visa_granted === true || pipe?.visa_date) autoDone.add("visa_approved");
    if (pipe?.flight_date) autoDone.add("flight_booked");
    if (pipe?.housing_done === true) autoDone.add("housing_arranged");
    if (pipe?.arrived_done === true) autoDone.add("arrived");
    const status = computePipelineStatus(journey, today, isB2Passed(b2Stage), autoDone);
    const sellable = evaluateSellable({ documents: docs, journey });

    // Follow-up signal — who needs chasing. Derived from real evidence:
    //   blocked / overdue journey steps, or a rejected document sitting unfixed.
    const hasRejectedDoc = docs.some((d) => d.status === "rejected");
    const followUpReasons: string[] = [];
    if (status.blockedCount > 0) followUpReasons.push("blocked");
    if (status.overdueCount > 0) followUpReasons.push("overdue");
    if (hasRejectedDoc) followUpReasons.push("rejected_doc");
    const followUp = { needed: followUpReasons.length > 0, reasons: followUpReasons };

    // The candidate's open (unfinished) journey items — shown in the peek popup
    // so the admin sees exactly what's outstanding. Capped + ordered.
    const openTasks = journey
      .filter((j) => !j.done)
      .slice()
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .slice(0, 6)
      .map((j) => ({
        key: j.preset_key ?? null,
        text: j.text ?? null,
        owner: (j.owner ?? null) as string | null,
        dueDate: j.due_date ?? null,
        blocked: j.blocked === true,
      }));
    // Impfung stage — derived from agency requirement + vaccines + cert doc.
    const vaxReq = reqByCandidate.get(p.user_id) ?? NO_REQ;
    const vaccines = vaxByCandidate.get(p.user_id) as Record<string, { doses?: { got: boolean | null; done_date: string | null; expected_date: string | null }[]; cert_expected?: string | null }> | null;
    const impfungStage = deriveImpfungStage(vaxReq, vaccines, impfungDocStatus.get(p.user_id) ?? null);
    const impfungDoses = doseProgress(vaxReq, vaccines);
    const name = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
    return {
      userId: p.user_id,
      name: name || "—",
      photo: p.profile_photo ?? null,
      status,
      sellable,
      b2Stage,
      b2Failed: p.b2_failed === true,
      impfungStage,
      impfungDoses,
      followUp,
      openTasks,
      needsUpdate: (() => { const la = lastActivity.get(p.user_id); return !la || (nowMs - la) > WEEK_MS; })(),
      lastActivityAt: lastActivity.has(p.user_id) ? new Date(lastActivity.get(p.user_id)!).toISOString() : null,
      pipeline: {
        interview1: pipe?.interview1_status ?? null,
        interview2: pipe?.interview2_status ?? null,
        interview1Date: pipe?.interview1_date ?? null,
        interview2Date: pipe?.interview2_date ?? null,
        visaApptDate: pipe?.visa_appt_date ?? null,
        flightDate: pipe?.flight_date ?? null,
        flightInfo: pipe?.flight_info ?? null,
        housingDone: pipe?.housing_done === true,
        visaGranted: pipe?.visa_granted === true || !!pipe?.visa_date,
        contractDone: pipe?.contract_done === true,
        recognitionDone: pipe?.recognition_done === true,
        vorabDone: pipe?.vorab_done === true,
        docsReady: pipe?.docs_ready === true,
        arrivedDone: pipe?.arrived_done === true,
      },
      facts: {
        specialty: p.nursing_specialty ?? null,
        yearsExperience: p.years_experience ?? null,
        workplace: p.current_workplace ?? null,
        availableFrom: p.available_from ?? null,
      },
      anerkennungStage: normalizeAnerkennungStage(p.anerkennung_stage),
      docPack: computeDocPack(docs),
      reports: reportsByCandidate.get(p.user_id) ?? [],
    };
  });

  // Hero summary for the admin dashboard.
  const summary = {
    total: candidates.length,
    sellable: candidates.filter((c) => c.sellable.sellable).length,
    // "Almost" = one of the two gates met (CV xor diploma) but not both.
    almost: candidates.filter((c) => !c.sellable.sellable && (c.sellable.cvDone || c.sellable.diplomaApproved)).length,
    needsAttention: candidates.filter((c) => c.status.health === "blocked" || c.status.health === "overdue").length,
    needsFollowUp: candidates.filter((c) => c.followUp.needed).length,
    arrived: candidates.filter((c) => c.status.health === "done").length,
  };

  // Order: most urgent first (blocked → overdue → due_soon → on_track → done),
  // then by how overdue, so the admin's eye lands on fires immediately.
  const RANK: Record<string, number> = { blocked: 0, overdue: 1, due_soon: 2, on_track: 3, done: 4 };
  candidates.sort((a, b) => {
    const r = (RANK[a.status.health] ?? 9) - (RANK[b.status.health] ?? 9);
    if (r !== 0) return r;
    return (b.status.overdueCount + b.status.blockedCount) - (a.status.overdueCount + a.status.blockedCount);
  });

  return NextResponse.json({ today, candidates, summary });
}
