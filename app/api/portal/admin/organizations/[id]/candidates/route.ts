import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET — list candidates linked to one organization (any status).
 *   { candidates: [{ user_id, status, added_by, added_at, approved_at }] }
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const db = getServiceSupabase();
  const { data } = await db
    .from("candidate_organizations")
    .select("candidate_user_id, status, added_by, added_at, approved_at, approved_by")
    .eq("org_id", id)
    .order("added_at", { ascending: false });

  type LinkRow = { candidate_user_id: string; status: string; added_by: string; added_at: string; approved_at: string | null; approved_by: string | null };
  const candidates = ((data ?? []) as LinkRow[]).map(r => ({
    userId:     r.candidate_user_id,
    status:     r.status,
    addedBy:    r.added_by,
    addedAt:    r.added_at,
    approvedAt: r.approved_at,
    approvedBy: r.approved_by,
  }));
  return NextResponse.json({ candidates });
}

/**
 * POST — link a candidate to an organization.
 * Body: { candidateUserId: string, status?: 'pending' | 'approved' }
 *
 * If status is omitted, defaults to 'approved' (admin acting directly).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid org id" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const candidateUserId = typeof body?.candidateUserId === "string" ? body.candidateUserId.trim() : "";
  const status = body?.status === "pending" ? "pending" : "approved";
  if (!UUID_RE.test(candidateUserId)) {
    return NextResponse.json({ error: "Invalid candidate id" }, { status: 400 });
  }

  const db = getServiceSupabase();
  const { error } = await db.from("candidate_organizations").upsert({
    candidate_user_id: candidateUserId,
    org_id: id,
    status,
    added_by: "admin",
    approved_at: status === "approved" ? new Date().toISOString() : null,
    approved_by: status === "approved" ? auth.email : null,
  }, { onConflict: "candidate_user_id,org_id" });

  if (error) {
    console.error("[org candidates POST] failed:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

/**
 * DELETE — unlink a candidate from an organization.
 * Body: { candidateUserId: string }
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid org id" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const candidateUserId = typeof body?.candidateUserId === "string" ? body.candidateUserId.trim() : "";
  if (!UUID_RE.test(candidateUserId)) {
    return NextResponse.json({ error: "Invalid candidate id" }, { status: 400 });
  }

  const db = getServiceSupabase();
  await db.from("candidate_organizations")
    .delete()
    .eq("org_id", id)
    .eq("candidate_user_id", candidateUserId);
  return NextResponse.json({ success: true });
}
