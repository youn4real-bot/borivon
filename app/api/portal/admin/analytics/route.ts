/**
 * Admin Analytics — the AGGREGATE funnel view (read-only). Where the Batch
 * Tracker drives ONE candidate at a time, this answers "how's the whole pipeline
 * doing right now": how many candidates sit at each funnel stage, interview-1/2
 * pass rates, milestone counts, B2 readiness, and open-batch fill.
 *
 * ALL admins, scoped exactly like /api/portal/tracker (LAW #25): a sub-admin sees
 * every candidate, an org-admin only their org's candidates + their org's
 * batches. Purely read-only — no writes, no candidate-facing behavior.
 *
 *   GET → { role, totals, funnel[], interviews, milestones, b2, batches[] }
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, getVisibleCandidateIds, getVisibleOrgIds, getStaffUserIdsAmong } from "@/lib/admin-auth";
import { getServiceSupabase } from "@/lib/supabase";
import { FUNNEL_STAGES } from "@/lib/batchBoard";
import { effectiveB2Stage, normalizeB2Stage } from "@/lib/b2Journey";
import { readAllRows } from "@/lib/readAllRows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NONE = "__none__"; // bucket for candidates with no funnel stage set

export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const db = getServiceSupabase();

  // Same scoping as the tracker: candidate ids (null = all) + batch org scope.
  const visible = auth.role === "admin" ? null : await getVisibleCandidateIds(auth.email);
  const orgScope = auth.role === "admin" ? null : await getVisibleOrgIds(auth.email);

  // Candidate roster (scoped), minus staff — the denominator for every rate.
  let profQ = db.from("candidate_profiles").select("user_id, b2_stage, b2_failed");
  if (visible !== null) profQ = profQ.in("user_id", visible.length ? visible : ["00000000-0000-0000-0000-000000000000"]);
  const { data: profs } = await profQ;
  const profRows = (profs ?? []) as { user_id: string; b2_stage: string | null; b2_failed: boolean | null }[];
  const allIds = profRows.map((p) => p.user_id);
  const staff = allIds.length ? await getStaffUserIdsAmong(allIds) : new Set<string>();
  const realProfs = profRows.filter((p) => !staff.has(p.user_id));
  const realIds = realProfs.map((p) => p.user_id);

  // Pipeline rows for the scoped candidates (the funnel + interview + milestone state).
  type Pipe = {
    user_id: string; funnel_stage: string | null; batch_id: string | null;
    interview1_status: string | null; interview2_status: string | null;
    agreement_signed: boolean | null; contract_done: boolean | null;
    visa_granted: boolean | null; arrived_done: boolean | null;
  };
  const pipe = realIds.length
    ? ((await db.from("candidate_pipeline")
        .select("user_id, funnel_stage, batch_id, interview1_status, interview2_status, agreement_signed, contract_done, visa_granted, arrived_done")
        .in("user_id", realIds)).data ?? [])
    : [];
  const pipeById = new Map<string, Pipe>();
  for (const r of pipe as Pipe[]) pipeById.set(String(r.user_id), r);

  // ── Funnel breakdown — count per stage, in ladder order, plus a "not on the
  // funnel yet" bucket so the numbers always sum to the total. ──
  const funnelCount = new Map<string, number>();
  for (const id of realIds) {
    const stage = pipeById.get(id)?.funnel_stage || NONE;
    funnelCount.set(stage, (funnelCount.get(stage) ?? 0) + 1);
  }
  const funnel = [
    ...FUNNEL_STAGES.map((s) => ({ key: s.key, label: s.label, waiting: s.waiting, count: funnelCount.get(s.key) ?? 0 })),
    { key: NONE, label: "Not started", waiting: false, count: funnelCount.get(NONE) ?? 0 },
  ];

  // ── Interview conversion — passed / failed / not-yet for I1 and I2. ──
  const tally = (get: (p: Pipe | undefined) => string | null) => {
    let passed = 0, failed = 0;
    for (const id of realIds) {
      const v = get(pipeById.get(id));
      if (v === "passed") passed++;
      else if (v === "failed") failed++;
    }
    return { passed, failed, notYet: realIds.length - passed - failed };
  };
  const interviews = {
    i1: tally((p) => p?.interview1_status ?? null),
    i2: tally((p) => p?.interview2_status ?? null),
  };

  // ── Milestone counts (how many candidates have reached each). ──
  const countTrue = (get: (p: Pipe | undefined) => boolean | null | undefined) =>
    realIds.reduce((n, id) => n + (get(pipeById.get(id)) === true ? 1 : 0), 0);
  const milestones = {
    agreement: countTrue((p) => p?.agreement_signed),
    contract: countTrue((p) => p?.contract_done),
    visa: countTrue((p) => p?.visa_granted),
    arrived: countTrue((p) => p?.arrived_done),
  };

  // ── B2 readiness — passed / in-progress / failed / not-set. ──
  //
  // Read the CERTIFICATE, not just the column. b2_stage is barely maintained —
  // 81 of 85 rows still hold the 'not_started' default — so counting it raw put
  // 15 candidates with an approved B2 certificate on file into "in progress",
  // while the B2 board and the printed PDF (both of which use effectiveB2Stage)
  // called the same people "passed".
  const b2CertDocs = new Map<string, { file_type: string | null; status: string | null }[]>();
  if (realIds.length) {
    try {
      const { data: docRows } = await readAllRows<{ user_id: string; file_type: string | null; status: string | null; superseded_at: string | null }>((from, to) =>
        db
          .from("documents")
          .select("user_id, file_type, status, superseded_at")
          .in("user_id", realIds)
          .eq("status", "approved")
          .order("id")
          .range(from, to));
      for (const d of (docRows ?? []) as { user_id: string; file_type: string | null; status: string | null; superseded_at: string | null }[]) {
        if (d.superseded_at) continue; // archived (LAW #33)
        const list = b2CertDocs.get(d.user_id) ?? [];
        list.push({ file_type: d.file_type, status: d.status });
        b2CertDocs.set(d.user_id, list);
      }
    } catch { /* documents unreadable → fall back to the stored stage alone */ }
  }
  const b2 = { passed: 0, inProgress: 0, failed: 0, notSet: 0 };
  for (const p of realProfs) {
    const stage = effectiveB2Stage(normalizeB2Stage(p.b2_stage), b2CertDocs.get(p.user_id) ?? []);
    // "Not set" must key off the sentinel, not falsiness: the column DEFAULTS to
    // the string 'not_started', which is truthy, so `!p.b2_stage` never fired and
    // this tile was permanently — and silently — zero.
    const untouched = !p.b2_stage || p.b2_stage === "not_started";
    if (stage === "passed") b2.passed++;
    else if (p.b2_failed === true) b2.failed++;
    else if (untouched) b2.notSet++;
    else b2.inProgress++;
  }

  // ── Open batches (org-scoped) with fill counts (within the scoped candidates). ──
  const filled = new Map<string, number>();
  for (const r of pipe as Pipe[]) if (r.batch_id) filled.set(String(r.batch_id), (filled.get(String(r.batch_id)) ?? 0) + 1);

  const { data: batchRows } = await db
    .from("employer_batches")
    .select("id, employer_id, org_id, name, seats, target_start, target_end, status")
    .order("created_at", { ascending: false });
  const { data: emps } = await db.from("employers").select("id, name").eq("active", true);
  const empName = new Map<string, string>(((emps ?? []) as { id: string; name: string }[]).map((e) => [e.id, e.name]));
  const { data: orgsData } = await db.from("organizations").select("id, name");
  const orgName = new Map<string, string>(((orgsData ?? []) as { id: string; name: string }[]).map((o) => [o.id, o.name]));

  const batches = ((batchRows ?? []) as { id: string; employer_id: string | null; org_id: string | null; name: string; seats: number; target_start: string | null; target_end: string | null; status: string }[])
    .filter((b) => b.status === "open")
    .filter((b) => orgScope === null || (b.org_id != null && orgScope.includes(b.org_id)))
    .map((b) => ({
      id: b.id, name: b.name,
      agency: b.org_id ? orgName.get(b.org_id) ?? null : null,
      employer: b.employer_id ? empName.get(b.employer_id) ?? null : null,
      seats: b.seats, filled: filled.get(b.id) ?? 0,
      targetStart: b.target_start, targetEnd: b.target_end,
    }));

  return NextResponse.json({
    role: auth.role,
    totals: { candidates: realIds.length },
    funnel,
    interviews,
    milestones,
    b2,
    batches,
  });
}
