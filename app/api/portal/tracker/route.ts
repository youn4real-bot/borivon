/**
 * Batch Tracker API (ALL admins, scoped) — the per-candidate PROGRESS board for
 * an employer intake batch. Where /api/portal/batches is supreme-only and edits
 * only the funnel stage, this exposes + edits the FULL journey milestones
 * (interviews, contract, visa, arrival) AND is open to sub-admins, scoped to the
 * candidates they may act on (LAW #25). It never exposes the supreme-only stage
 * locks (recognition/embassy/integration/start_unlocked) — those stay in the
 * pipeline route + admin panel.
 *
 *   GET   → { role, batches:[open], candidates:[visible candidates w/ progress] }
 *   PATCH → { candidateUserId, patch:{ curated fields } } — canActOnCandidate gate
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, getVisibleCandidateIds, getVisibleOrgIds, canActOnCandidate, canActOnBatch, resolveAuthNames, getStaffUserIdsAmong } from "@/lib/admin-auth";
import { getServiceSupabase } from "@/lib/supabase";
import { UUID_RE } from "@/lib/uuid";
import { isFunnelStage } from "@/lib/batchBoard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROGRESS_COLS =
  "user_id, funnel_stage, batch_id, interview1_status, interview1_date, interview2_status, interview2_date, agreement_signed, contract_done, visa_appt_date, visa_granted, arrived_done";

// Editable fields the tracker exposes (deliberately NOT the supreme-only stage locks).
const BOOL_FIELDS = new Set(["agreement_signed", "contract_done", "visa_granted", "arrived_done"]);
const DATE_FIELDS = new Set(["interview1_date", "interview2_date", "visa_appt_date"]);
const STATUS_FIELDS = new Set(["interview1_status", "interview2_status"]);
const VALID_STATUS = new Set(["pending", "passed", "failed"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const db = getServiceSupabase();
  // Supreme → all; regular sub-admin → all; org admin → only their org's candidates.
  const visible = auth.role === "admin" ? null : await getVisibleCandidateIds(auth.email);
  // LAW #25 (agency dimension): scope the BATCH list the same way as candidates —
  // an org admin must not see other agencies' batch names/employers. null = all.
  const orgScope = auth.role === "admin" ? null : await getVisibleOrgIds(auth.email);

  const { data: batches, error: bErr } = await db
    .from("employer_batches")
    .select("id, employer_id, org_id, name, seats, target_start, target_end, status, notes")
    .order("created_at", { ascending: false });
  if (bErr) return NextResponse.json({ error: "batches_unavailable" }, { status: 500 });

  const { data: emps } = await db.from("employers").select("id, name").eq("active", true).order("name");
  const employers = (emps ?? []) as { id: string; name: string }[];
  const empName = new Map<string, string>(employers.map((e) => [e.id, e.name]));
  const { data: orgsData } = await db.from("organizations").select("id, name").order("name");
  const organizations = (orgsData ?? []) as { id: string; name: string }[];
  const orgName = new Map<string, string>(organizations.map((o) => [o.id, o.name]));

  // Candidate roster (scoped), minus staff. B2 (German exam) lives here too —
  // the founder tracks who passes B2 by which date to weed out anyone who can't
  // be ready in time for the batch window.
  let profQ = db.from("candidate_profiles").select("user_id, first_name, last_name, b2_stage, b2_failed, b2_exam_date");
  if (visible !== null) profQ = profQ.in("user_id", visible.length ? visible : ["00000000-0000-0000-0000-000000000000"]);
  const { data: profs } = await profQ;
  const profRows = (profs ?? []) as { user_id: string; first_name: string | null; last_name: string | null; b2_stage: string | null; b2_failed: boolean | null; b2_exam_date: string | null }[];
  const allIds = profRows.map((p) => p.user_id);
  const staff = allIds.length ? await getStaffUserIdsAmong(allIds) : new Set<string>();
  const realProfs = profRows.filter((p) => !staff.has(p.user_id));

  const profNames = new Map<string, string>();
  for (const p of realProfs) { const n = [p.first_name, p.last_name].filter(Boolean).join(" ").trim(); if (n) profNames.set(p.user_id, n); }
  const needNames = realProfs.filter((p) => !profNames.has(p.user_id)).map((p) => p.user_id);
  const names = needNames.length ? await resolveAuthNames(needNames) : {};

  const realIds = realProfs.map((p) => p.user_id);
  type Pipe = Record<string, string | boolean | null>;
  const pipe = realIds.length
    ? ((await db.from("candidate_pipeline").select(PROGRESS_COLS).in("user_id", realIds)).data ?? [])
    : [];
  const pipeById = new Map<string, Pipe>();
  for (const r of pipe as Pipe[]) pipeById.set(String(r.user_id), r);

  const filled = new Map<string, number>();
  for (const r of pipe as Pipe[]) if (r.batch_id) filled.set(String(r.batch_id), (filled.get(String(r.batch_id)) ?? 0) + 1);

  const candidates = realProfs
    .map((p) => {
      const pr = pipeById.get(p.user_id) ?? {};
      return {
        userId: p.user_id,
        name: profNames.get(p.user_id) || names[p.user_id]?.name || names[p.user_id]?.email || p.user_id,
        b2Stage: p.b2_stage ?? null,
        b2Failed: p.b2_failed === true,
        b2ExamDate: p.b2_exam_date ?? null,
        batchId: (pr.batch_id as string | null) ?? null,
        funnelStage: (pr.funnel_stage as string | null) ?? null,
        interview1Status: (pr.interview1_status as string | null) ?? null,
        interview1Date: (pr.interview1_date as string | null) ?? null,
        interview2Status: (pr.interview2_status as string | null) ?? null,
        interview2Date: (pr.interview2_date as string | null) ?? null,
        agreementSigned: pr.agreement_signed === true,
        contractDone: pr.contract_done === true,
        visaApptDate: (pr.visa_appt_date as string | null) ?? null,
        visaGranted: pr.visa_granted === true,
        arrivedDone: pr.arrived_done === true,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const isSupreme = auth.role === "admin";
  return NextResponse.json({
    role: auth.role,
    // The create-form pickers are only meaningful (and only sent) to the supreme admin.
    employers: isSupreme ? employers : undefined,
    organizations: isSupreme ? organizations : undefined,
    batches: (batches ?? [])
      .map((b) => b as { id: string; employer_id: string | null; org_id: string | null; name: string; seats: number; target_start: string | null; target_end: string | null; status: string; notes: string | null })
      .filter((b) => b.status === "open")
      // org-scoped admins only see their own agency's batches (null-org HQ
      // batches included in "all" for HQ, excluded for an org admin).
      .filter((b) => orgScope === null || (b.org_id != null && orgScope.includes(b.org_id)))
      .map((b) => ({
        id: b.id, name: b.name,
        agency: b.org_id ? orgName.get(b.org_id) ?? null : null,
        employer: b.employer_id ? empName.get(b.employer_id) ?? null : null,
        // ids so the supreme admin's Edit form can prefill its dropdowns
        orgId: b.org_id, employerId: b.employer_id,
        notes: b.notes ?? "",
        seats: b.seats, filled: filled.get(b.id) ?? 0, targetStart: b.target_start, targetEnd: b.target_end,
      })),
    candidates,
  });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await req.json().catch(() => ({}));

  // ── BATCH NOTES ── a shared note on the batch itself. Writable by EVERY admin
  // (supreme + sub-admins) — deliberately NOT routed through /api/portal/batches,
  // which is supreme-only. Candidates can never reach this route at all.
  if (typeof body.batchId === "string" && typeof body.notes === "string") {
    if (!UUID_RE.test(body.batchId)) return NextResponse.json({ error: "Bad batch id" }, { status: 400 });
    // LAW #25 — an org admin can only edit notes on their OWN agency's batches.
    if (!(await canActOnBatch(auth.role, auth.email, body.batchId))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const notes = body.notes.trim().slice(0, 5000);
    const { error } = await getServiceSupabase()
      .from("employer_batches")
      .update({ notes: notes || null })
      .eq("id", body.batchId);
    if (error) return NextResponse.json({ error: "update_failed" }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const candidateUserId = typeof body.candidateUserId === "string" ? body.candidateUserId : "";
  if (!UUID_RE.test(candidateUserId)) return NextResponse.json({ error: "Bad candidate id" }, { status: 400 });
  // LAW #25 — a sub-admin/org-admin can only touch candidates they may act on.
  if (!(await canActOnCandidate(auth.role, auth.email, candidateUserId))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const patch = (body.patch ?? {}) as Record<string, unknown>;
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (k === "funnel_stage") {
      if (v === null || v === "") fields.funnel_stage = null;
      else if (typeof v === "string" && isFunnelStage(v)) fields.funnel_stage = v;
      else return NextResponse.json({ error: "Bad stage" }, { status: 400 });
    } else if (k === "batch_id") {
      if (v === null || v === "") fields.batch_id = null;
      else if (typeof v === "string" && UUID_RE.test(v)) fields.batch_id = v;
      else return NextResponse.json({ error: "Bad batch id" }, { status: 400 });
    } else if (STATUS_FIELDS.has(k)) {
      if (v === null || v === "") fields[k] = null;
      else if (typeof v === "string" && VALID_STATUS.has(v)) fields[k] = v;
      else return NextResponse.json({ error: "Bad status" }, { status: 400 });
    } else if (DATE_FIELDS.has(k)) {
      if (v === null || v === "") fields[k] = null;
      else if (typeof v === "string" && DATE_RE.test(v)) fields[k] = v;
      else return NextResponse.json({ error: "Bad date" }, { status: 400 });
    } else if (BOOL_FIELDS.has(k)) {
      fields[k] = v === true || v === "true";
    } else {
      return NextResponse.json({ error: `Field not allowed: ${k}` }, { status: 400 });
    }
  }
  if (Object.keys(fields).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  // LAW #25 — assigning a candidate INTO a batch must respect batch scope too, or
  // an org admin could move one of their candidates into another agency's batch.
  // (Un-assigning — batch_id → null — is always allowed for a candidate in scope.)
  if (typeof fields.batch_id === "string" && fields.batch_id) {
    if (!(await canActOnBatch(auth.role, auth.email, fields.batch_id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  fields.updated_at = new Date().toISOString();

  const db = getServiceSupabase();
  // Update-then-insert (the pipeline row may not exist yet).
  const { data: upd, error } = await db.from("candidate_pipeline").update(fields).eq("user_id", candidateUserId).select("user_id");
  if (error) return NextResponse.json({ error: "update_failed" }, { status: 500 });
  if (!upd || upd.length === 0) {
    const { error: insErr } = await db.from("candidate_pipeline").insert({ user_id: candidateUserId, ...fields });
    if (insErr) return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
