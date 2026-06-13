/**
 * Batch Board API (supreme-admin only) — employer intake batches + funnel.
 *
 *   GET    → { batches: [...with filled count + employer name], candidates: [...
 *            every real candidate with their funnel_stage + batch_id + name] }
 *   POST   → create a batch { name, employerId?, seats?, targetStart?, targetEnd?, notes? }
 *   PATCH  → if body.candidateUserId  → assign/restage a candidate
 *                                       (batch_id = body.batchId|null, funnel_stage = body.stage?)
 *            else (body.batchId)      → edit/close a batch
 *
 * All writes mirror the bot's lib/assistantWrites batch helpers (same columns,
 * same validation) so the two surfaces never diverge. Fail-safe: if
 * supabase/employer_batches.sql hasn't been run, the queries error → 500 with a
 * clear message (the page shows an empty board).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, resolveAuthNames, getStaffUserIdsAmong } from "@/lib/admin-auth";
import { getServiceSupabase } from "@/lib/supabase";
import { UUID_RE } from "@/lib/uuid";
import { isFunnelStage } from "@/lib/batchBoard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireSupreme(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return { ok: false as const, res: NextResponse.json({ error: auth.error }, { status: auth.status }) };
  if (auth.role !== "admin") return { ok: false as const, res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { ok: true as const };
}

export async function GET(req: NextRequest) {
  const gate = await requireSupreme(req);
  if (!gate.ok) return gate.res;
  const db = getServiceSupabase();

  const { data: batches, error: bErr } = await db
    .from("employer_batches")
    .select("id, employer_id, name, seats, target_start, target_end, status, notes")
    .order("created_at", { ascending: false });
  if (bErr) return NextResponse.json({ error: "batches_unavailable" }, { status: 500 });

  // EVERY real candidate (so the page can also offer an "add to the funnel"
  // picker), each with their funnel_stage + batch_id merged from the pipeline.
  const { data: profs } = await db.from("candidate_profiles").select("user_id, first_name, last_name");
  const profRows = (profs ?? []) as { user_id: string; first_name: string | null; last_name: string | null }[];
  const allIds = profRows.map((p) => p.user_id);
  const staff = allIds.length ? await getStaffUserIdsAmong(allIds) : new Set<string>();
  const realProfs = profRows.filter((p) => !staff.has(p.user_id));

  const profNames = new Map<string, string>();
  for (const p of realProfs) {
    const n = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
    if (n) profNames.set(p.user_id, n);
  }
  // Resolve auth full_name only for the ones whose profile name is blank.
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

  return NextResponse.json({
    employers,
    batches: (batches ?? []).map((b) => {
      const row = b as { id: string; employer_id: string | null; name: string; seats: number; target_start: string | null; target_end: string | null; status: string; notes: string | null };
      return {
        id: row.id, name: row.name, employerId: row.employer_id, employer: row.employer_id ? empName.get(row.employer_id) ?? null : null,
        seats: row.seats, filled: filled.get(row.id) ?? 0, targetStart: row.target_start, targetEnd: row.target_end, status: row.status, notes: row.notes,
      };
    }),
    candidates: real.map((r) => ({
      userId: r.user_id, name: profNames.get(r.user_id) || names[r.user_id]?.name || names[r.user_id]?.email || r.user_id,
      funnelStage: r.funnel_stage, batchId: r.batch_id,
    })).sort((a, b) => a.name.localeCompare(b.name)),
  });
}

export async function POST(req: NextRequest) {
  const gate = await requireSupreme(req);
  if (!gate.ok) return gate.res;
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
  const row: Record<string, unknown> = { name, seats: Number.isFinite(body.seats) ? Math.max(1, Math.min(1000, Math.round(body.seats))) : 10 };
  if (typeof body.employerId === "string" && UUID_RE.test(body.employerId)) row.employer_id = body.employerId;
  if (typeof body.targetStart === "string" && body.targetStart) row.target_start = body.targetStart;
  if (typeof body.targetEnd === "string" && body.targetEnd) row.target_end = body.targetEnd;
  if (typeof body.notes === "string" && body.notes.trim()) row.notes = body.notes.trim().slice(0, 500);
  const db = getServiceSupabase();
  const { data, error } = await db.from("employer_batches").insert(row).select("id").single();
  if (error) return NextResponse.json({ error: "create_failed" }, { status: 500 });
  return NextResponse.json({ ok: true, id: (data as { id: string }).id });
}

export async function PATCH(req: NextRequest) {
  const gate = await requireSupreme(req);
  if (!gate.ok) return gate.res;
  const body = await req.json().catch(() => ({}));
  const db = getServiceSupabase();

  // ── Assign / restage a candidate ──
  if (typeof body.candidateUserId === "string") {
    if (!UUID_RE.test(body.candidateUserId)) return NextResponse.json({ error: "Bad candidate id" }, { status: 400 });
    const fields: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.batchId === null || body.batchId === "") fields.batch_id = null;
    else if (typeof body.batchId === "string") {
      if (!UUID_RE.test(body.batchId)) return NextResponse.json({ error: "Bad batch id" }, { status: 400 });
      fields.batch_id = body.batchId;
    }
    if (typeof body.stage === "string") {
      if (!isFunnelStage(body.stage)) return NextResponse.json({ error: "Bad stage" }, { status: 400 });
      fields.funnel_stage = body.stage;
    }
    if (Object.keys(fields).length === 1) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    // Update-then-insert (the pipeline row may not exist yet).
    const { data: upd, error } = await db.from("candidate_pipeline").update(fields).eq("user_id", body.candidateUserId).select("user_id");
    if (error) return NextResponse.json({ error: "assign_failed" }, { status: 500 });
    if (!upd || upd.length === 0) {
      const { error: insErr } = await db.from("candidate_pipeline").insert({ user_id: body.candidateUserId, ...fields });
      if (insErr) return NextResponse.json({ error: "assign_failed" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  // ── Edit / close a batch ──
  if (typeof body.batchId !== "string" || !UUID_RE.test(body.batchId)) return NextResponse.json({ error: "Missing batchId" }, { status: 400 });
  const upd: Record<string, unknown> = {};
  if (typeof body.name === "string") upd.name = body.name.trim().slice(0, 120);
  if (Number.isFinite(body.seats)) upd.seats = Math.max(1, Math.min(1000, Math.round(body.seats)));
  if (body.employerId === null || body.employerId === "") upd.employer_id = null;
  else if (typeof body.employerId === "string" && UUID_RE.test(body.employerId)) upd.employer_id = body.employerId;
  if (typeof body.targetStart === "string") upd.target_start = body.targetStart || null;
  if (typeof body.targetEnd === "string") upd.target_end = body.targetEnd || null;
  if (typeof body.notes === "string") upd.notes = body.notes.trim().slice(0, 500) || null;
  if (body.close === true || body.status === "closed") upd.status = "closed";
  if (body.status === "open") upd.status = "open";
  if (Object.keys(upd).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  const { error } = await db.from("employer_batches").update(upd).eq("id", body.batchId);
  if (error) return NextResponse.json({ error: "update_failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
