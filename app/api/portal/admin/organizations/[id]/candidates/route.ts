import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";
import { isOrgSide } from "@/lib/messagesAuth";
import { serverBroadcast, ASSIGNMENTS_TOPIC } from "@/lib/serverBroadcast";
import { UUID_RE } from "@/lib/uuid";

/**
 * THE BORIVON TEAM CAN ALL PLACE CANDIDATES — not just the supreme admin.
 *
 * These three handlers were gated `auth.role !== "admin"`, so linking a
 * candidate to an agency was the founder's job alone. Every sub-admin could
 * review documents, run the pipeline and assign an EMPLOYER (see
 * ../assign-employer, which has always used per-candidate scoping rather than a
 * role check) — but the one action that actually places a nurse funnelled
 * through one person. That is a bottleneck on the business, not a safety
 * property.
 *
 * The line that DOES matter is Borivon staff vs the agencies themselves. An
 * org-side account — an agency admin (`sub_admins.is_agency_admin = true`) or
 * anyone with an `organization_members` row — must never be able to link
 * candidates into an organization: they would be able to pull nurses into their
 * own agency, or move another agency's candidates, and the GET would hand them
 * the full roster of an org they do not belong to. That is the LAW #25 boundary
 * and it stays exactly where it was.
 *
 * isOrgSide (lib/messagesAuth.ts) is the codebase's existing answer to that
 * question, already used to gate the shared support inbox, and it FAILS CLOSED —
 * any lookup error is treated as org-side. Reusing it means the two surfaces can
 * never drift into disagreeing about who counts as staff.
 */
async function requireBorivonTeam(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return { ok: false as const, res: NextResponse.json({ error: auth.error }, { status: auth.status }) };
  if (await isOrgSide(getServiceSupabase(), auth.role, auth.email)) {
    return { ok: false as const, res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true as const, auth };
}


/**
 * GET — list candidates linked to one organization (any status).
 *   { candidates: [{ user_id, status, added_by, added_at, approved_at }] }
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireBorivonTeam(req);
  if (!gate.ok) return gate.res;

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
  const gate = await requireBorivonTeam(req);
  if (!gate.ok) return gate.res;
  const auth = gate.auth;

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

  // Silent placement — no candidate notification, no email, no
  // celebration. The candidate sees the org appear on their dashboard
  // via the /api/portal/me/organizations poll, and that surface is the
  // only signal. (Removed at user request 2026-05.)

  // Ping open admin bells so the org admin's SCOPED notification list picks
  // up this candidate instantly (instead of waiting for the 15s poll).
  await serverBroadcast(ASSIGNMENTS_TOPIC, "changed");

  return NextResponse.json({ success: true });
}

/**
 * DELETE — unlink a candidate from an organization.
 * Body: { candidateUserId: string }
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireBorivonTeam(req);
  if (!gate.ok) return gate.res;

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

  // Ping open admin bells — the org admin's scoped list drops this candidate
  // (and everything tied to them) immediately, not on the next 15s poll.
  await serverBroadcast(ASSIGNMENTS_TOPIC, "changed");

  return NextResponse.json({ success: true });
}
