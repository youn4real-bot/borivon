/**
 * Batch Board API — employer intake batches + funnel. Open to ALL admins
 * (supreme + sub-admins), each SCOPED per LAW #25:
 *   - Supreme + true HQ sub-admin → every batch / candidate.
 *   - Org-scoped (agency) admin    → only their org's batches + candidates.
 *
 *   GET    → { batches (scoped), candidates (scoped), employers, organizations (scoped) }
 *   POST   → create a batch { name, employerId?, seats?, targetStart?, targetEnd?, notes?, orgId? }
 *            (a scoped admin must target one of their own orgs)
 *   PATCH  → if body.candidateUserId  → assign/restage a candidate
 *                                       (gated by canActOnCandidate + canActOnBatch)
 *            else (body.batchId)      → edit/close a batch (gated by canActOnBatch)
 *
 * All writes mirror the bot's lib/assistantWrites batch helpers (same columns,
 * same validation) so the two surfaces never diverge.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminRole, resolveAuthNames, getStaffUserIdsAmong,
  canActOnCandidate, canActOnBatch, canActOnOrg, getVisibleOrgIds, getVisibleCandidateIds,
} from "@/lib/admin-auth";
import { getServiceSupabase } from "@/lib/supabase";
import { UUID_RE } from "@/lib/uuid";
import { isFunnelStage } from "@/lib/batchBoard";
import { resyncBatchFolder } from "@/lib/driveMirror";
import { keepAlive } from "@/lib/keepAlive";
import { scheduleCandidateMirror } from "@/lib/scheduleMirror";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const db = getServiceSupabase();

  // LAW #25 scope. null = unrestricted (supreme / true HQ sub-admin).
  const visibleOrgs = auth.role === "admin" ? null : await getVisibleOrgIds(auth.email);
  const visibleCands = auth.role === "admin" ? null : await getVisibleCandidateIds(auth.email);
  const orgVisible = (orgId: string | null) => visibleOrgs === null ? true : (!!orgId && visibleOrgs.includes(orgId));

  const { data: batchesRaw, error: bErr } = await db
    .from("employer_batches")
    .select("id, employer_id, org_id, name, seats, target_start, target_end, status, notes")
    .order("created_at", { ascending: false });
  if (bErr) return NextResponse.json({ error: "batches_unavailable" }, { status: 500 });
  const batchRows = ((batchesRaw ?? []) as { id: string; employer_id: string | null; org_id: string | null; name: string; seats: number; target_start: string | null; target_end: string | null; status: string; notes: string | null }[])
    .filter((b) => orgVisible(b.org_id));

  // EVERY real candidate the caller MAY see (so the page can offer an "add to
  // the funnel" picker), each with their funnel_stage + batch_id merged in.
  const { data: profs } = await db.from("candidate_profiles").select("user_id, first_name, last_name");
  const profRows = (profs ?? []) as { user_id: string; first_name: string | null; last_name: string | null }[];
  const allIds = profRows.map((p) => p.user_id);
  const staff = allIds.length ? await getStaffUserIdsAmong(allIds) : new Set<string>();
  const visSet = visibleCands === null ? null : new Set(visibleCands);
  const realProfs = profRows.filter((p) => !staff.has(p.user_id) && (visSet === null || visSet.has(p.user_id)));

  const profNames = new Map<string, string>();
  for (const p of realProfs) {
    const n = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
    if (n) profNames.set(p.user_id, n);
  }
  const needNames = realProfs.filter((p) => !profNames.has(p.user_id)).map((p) => p.user_id);
  const names = needNames.length ? await resolveAuthNames(needNames) : {};

  const { data: pipe } = await db.from("candidate_pipeline").select("user_id, funnel_stage, batch_id");
  const pipeById = new Map<string, { funnel_stage: string | null; batch_id: string | null }>();
  for (const r of (pipe ?? []) as { user_id: string; funnel_stage: string | null; batch_id: string | null }[]) pipeById.set(r.user_id, r);

  const real = realProfs.map((p) => ({
    user_id: p.user_id,
    funnel_stage: pipeById.get(p.user_id)?.funnel_stage ?? null,
    batch_id: pipeById.get(p.user_id)?.batch_id ?? null,
  }));

  const filled = new Map<string, number>();
  for (const r of real) if (r.batch_id) filled.set(r.batch_id, (filled.get(r.batch_id) ?? 0) + 1);

  // Active employers — for the batch's employer name AND the create-form picker.
  const { data: emps } = await db.from("employers").select("id, name").eq("active", true).order("name");
  const employers = (emps ?? []) as { id: string; name: string }[];
  const empName = new Map<string, string>();
  for (const e of employers) empName.set(e.id, e.name);

  // Organizations = the AGENCIES a batch can run through (scoped for org-admins).
  const { data: orgsData } = await db.from("organizations").select("id, name").order("name");
  const organizations = ((orgsData ?? []) as { id: string; name: string }[])
    .filter((o) => orgVisible(o.id));
  const orgName = new Map<string, string>();
  for (const o of (orgsData ?? []) as { id: string; name: string }[]) orgName.set(o.id, o.name);

  return NextResponse.json({
    employers,
    organizations,
    batches: batchRows.map((row) => ({
      id: row.id, name: row.name, employerId: row.employer_id, employer: row.employer_id ? empName.get(row.employer_id) ?? null : null,
      orgId: row.org_id, agency: row.org_id ? orgName.get(row.org_id) ?? null : null,
      seats: row.seats, filled: filled.get(row.id) ?? 0, targetStart: row.target_start, targetEnd: row.target_end, status: row.status, notes: row.notes,
    })),
    candidates: real.map((r) => ({
      userId: r.user_id, name: profNames.get(r.user_id) || names[r.user_id]?.name || names[r.user_id]?.email || r.user_id,
      funnelStage: r.funnel_stage, batchId: r.batch_id,
    })).sort((a, b) => a.name.localeCompare(b.name)),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
  const row: Record<string, unknown> = { name, seats: Number.isFinite(body.seats) ? Math.max(1, Math.min(1000, Math.round(body.seats))) : 10 };
  if (typeof body.employerId === "string" && UUID_RE.test(body.employerId)) row.employer_id = body.employerId;
  if (typeof body.orgId === "string" && UUID_RE.test(body.orgId)) row.org_id = body.orgId;
  if (typeof body.targetStart === "string" && body.targetStart) row.target_start = body.targetStart;
  if (typeof body.targetEnd === "string" && body.targetEnd) row.target_end = body.targetEnd;
  if (typeof body.notes === "string" && body.notes.trim()) row.notes = body.notes.trim().slice(0, 500);

  // LAW #25: a scoped admin may only create a batch inside an org they control.
  // Supreme + true HQ sub-admin pass for any (or no) org; an org-scoped admin
  // MUST name one of their orgs (a null-org / global batch is denied to them).
  if (auth.role !== "admin") {
    const targetOrg = typeof row.org_id === "string" ? (row.org_id as string) : null;
    if (!(await canActOnOrg(auth.role, auth.email, targetOrg)))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getServiceSupabase();
  const { data, error } = await db.from("employer_batches").insert(row).select("id").single();
  if (error) return NextResponse.json({ error: "create_failed" }, { status: 500 });
  return NextResponse.json({ ok: true, id: (data as { id: string }).id });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await req.json().catch(() => ({}));
  const db = getServiceSupabase();

  // ── Assign / restage a candidate ──
  if (typeof body.candidateUserId === "string") {
    if (!UUID_RE.test(body.candidateUserId)) return NextResponse.json({ error: "Bad candidate id" }, { status: 400 });
    // LAW #25: may this admin act on THIS candidate at all?
    if (!(await canActOnCandidate(auth.role, auth.email, body.candidateUserId)))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const fields: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.batchId === null || body.batchId === "") fields.batch_id = null;
    else if (typeof body.batchId === "string") {
      if (!UUID_RE.test(body.batchId)) return NextResponse.json({ error: "Bad batch id" }, { status: 400 });
      // LAW #25: and may they put someone INTO this batch? (Removing to null is
      // fine — the candidate gate above already covers it.)
      if (!(await canActOnBatch(auth.role, auth.email, body.batchId)))
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      fields.batch_id = body.batchId;
    }
    if (typeof body.stage === "string") {
      if (!isFunnelStage(body.stage)) return NextResponse.json({ error: "Bad stage" }, { status: 400 });
      fields.funnel_stage = body.stage;
    }
    if (Object.keys(fields).length === 1) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

    // What batch were they in before? Needed to decide whether the agency's
    // Drive folder has to change — see below.
    const changingBatch = "batch_id" in fields;
    let oldBatchId: string | null = null;
    if (changingBatch) {
      const { data: prev } = await db
        .from("candidate_pipeline").select("batch_id").eq("user_id", body.candidateUserId).maybeSingle();
      oldBatchId = (prev as { batch_id?: string | null } | null)?.batch_id ?? null;
    }

    // Update-then-insert (the pipeline row may not exist yet).
    const { data: upd, error } = await db.from("candidate_pipeline").update(fields).eq("user_id", body.candidateUserId).select("user_id");
    if (error) return NextResponse.json({ error: "assign_failed" }, { status: 500 });
    if (!upd || upd.length === 0) {
      const { error: insErr } = await db.from("candidate_pipeline").insert({ user_id: body.candidateUserId, ...fields });
      if (insErr) return NextResponse.json({ error: "assign_failed" }, { status: 500 });
    }

    // FOLLOW THE DOSSIER. This branch changed batch membership and did nothing
    // about the Drive mirror, so dropping a nurse from a batch HERE left her
    // whole dossier — passport included — in the partner agency's folder, for
    // good. The Batch TRACKER (/api/portal/tracker) has always done this; this
    // route is the second way to do the same thing and was missed.
    //
    // Legacy rows carry a NULL drive_mirror_batch_id, which the mirror reads as
    // "unknown = current" and would refuse to retract — so stamp them with the
    // OLD batch first, exactly as the tracker does. Schema-tolerant: a
    // deployment without that column just skips it and the manual sync catches
    // up.
    if (changingBatch && oldBatchId !== (fields.batch_id ?? null)) {
      if (oldBatchId) {
        try {
          const r = await db.from("documents")
            .update({ drive_mirror_batch_id: oldBatchId })
            .eq("user_id", body.candidateUserId)
            .not("drive_mirror_id", "is", null)
            .is("drive_mirror_batch_id", null);
          if (r.error && !/drive_mirror_batch_id|column .* does not exist|schema cache/i.test(r.error.message ?? "")) {
            console.warn("[batches PATCH] batch-stamp backfill failed:", r.error.message);
          }
        } catch { /* best-effort */ }
      }
      scheduleCandidateMirror(body.candidateUserId);
    }
    return NextResponse.json({ ok: true });
  }

  // ── Edit / close a batch ──
  if (typeof body.batchId !== "string" || !UUID_RE.test(body.batchId)) return NextResponse.json({ error: "Missing batchId" }, { status: 400 });
  // LAW #25: may this admin act on this batch?
  if (!(await canActOnBatch(auth.role, auth.email, body.batchId)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const upd: Record<string, unknown> = {};
  if (typeof body.name === "string") upd.name = body.name.trim().slice(0, 120);
  if (Number.isFinite(body.seats)) upd.seats = Math.max(1, Math.min(1000, Math.round(body.seats)));
  if (body.employerId === null || body.employerId === "") upd.employer_id = null;
  else if (typeof body.employerId === "string" && UUID_RE.test(body.employerId)) upd.employer_id = body.employerId;
  if (body.orgId === null || body.orgId === "") upd.org_id = null;
  else if (typeof body.orgId === "string" && UUID_RE.test(body.orgId)) upd.org_id = body.orgId;
  if (typeof body.targetStart === "string") upd.target_start = body.targetStart || null;
  if (typeof body.targetEnd === "string") upd.target_end = body.targetEnd || null;
  if (typeof body.notes === "string") upd.notes = body.notes.trim().slice(0, 500) || null;
  if (body.close === true || body.status === "closed") upd.status = "closed";
  if (body.status === "open") upd.status = "open";
  if (Object.keys(upd).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  // LAW #25: re-pointing a batch at another agency must land it in an org the
  // caller controls (and a scoped admin cannot orphan it to a null/global org).
  if ("org_id" in upd && !(await canActOnOrg(auth.role, auth.email, (upd.org_id as string | null) ?? null)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // The agency's Drive folder is addressed by NAME — agencyRootFolderName(org)
  // / batchName — so renaming a batch or re-pointing it at another agency moves
  // where the dossier is SUPPOSED to live, while every mirrored file stays put.
  // Read the old values first so we only act on a real change.
  const touchesFolder = "name" in upd || "org_id" in upd;
  let folderChanged = false;
  if (touchesFolder) {
    const { data: before } = await db
      .from("employer_batches").select("name, org_id").eq("id", body.batchId).maybeSingle();
    const b = before as { name?: string | null; org_id?: string | null } | null;
    folderChanged =
      ("name" in upd && (b?.name ?? null) !== (upd.name as string | null)) ||
      ("org_id" in upd && (b?.org_id ?? null) !== (upd.org_id as string | null));
  }

  const { error } = await db.from("employer_batches").update(upd).eq("id", body.batchId);
  if (error) return NextResponse.json({ error: "update_failed" }, { status: 500 });

  // Follow the dossier to the new folder. Without this the next sync built a
  // fresh EMPTY folder under the new name and reported success, while the real
  // files — passports included — stayed in the old agency's folder for good,
  // because the upload path reuses each row's recorded drive_mirror_id and
  // updates that file in place. isMirrorInWrongBatch cannot see it: the batch
  // ID never changed, only its name did.
  //
  // Fire-and-forget through keepAlive: on Workers an unawaited promise is
  // cancelled when the response is sent, and moving 95 files is far too slow to
  // block the rename on.
  if (folderChanged) {
    keepAlive(async () => {
      const { moved, candidates } = await resyncBatchFolder(body.batchId as string);
      console.log(`[batches PATCH] folder changed → re-mirrored ${candidates} candidate(s), moved ${moved} file(s)`);
    });
  }
  return NextResponse.json({ ok: true, folderResync: folderChanged });
}
