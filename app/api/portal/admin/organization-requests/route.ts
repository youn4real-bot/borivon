import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET — list ALL pending candidate-org link requests across every organization.
 * Used to power the admin's "Pending requests" inbox.
 *
 *   { requests: [{ orgId, orgName, candidateUserId, addedBy, addedAt }] }
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = getServiceSupabase();
  const { data: links } = await db
    .from("candidate_organizations")
    .select("candidate_user_id, org_id, status, added_by, added_at")
    .eq("status", "pending")
    .order("added_at", { ascending: false });

  type LinkRow = { candidate_user_id: string; org_id: string; status: string; added_by: string; added_at: string };
  const linkRows = (links ?? []) as LinkRow[];

  const orgIds = [...new Set(linkRows.map(l => l.org_id))];
  type OrgRow = { id: string; name: string };
  let orgs: OrgRow[] = [];
  if (orgIds.length > 0) {
    const { data } = await db.from("organizations").select("id, name").in("id", orgIds);
    orgs = (data ?? []) as OrgRow[];
  }
  const nameById: Record<string, string> = {};
  for (const o of orgs) nameById[o.id] = o.name;

  const requests = linkRows.map(l => ({
    candidateUserId: l.candidate_user_id,
    orgId:           l.org_id,
    orgName:         nameById[l.org_id] ?? "(deleted org)",
    addedBy:         l.added_by,
    addedAt:         l.added_at,
  }));
  return NextResponse.json({ requests });
}

/**
 * POST — approve a pending request.
 * Body: { candidateUserId: string, orgId: string }
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const candidateUserId = typeof body?.candidateUserId === "string" ? body.candidateUserId.trim() : "";
  const orgId           = typeof body?.orgId           === "string" ? body.orgId.trim()           : "";
  if (!UUID_RE.test(candidateUserId)) return NextResponse.json({ error: "Invalid candidate id" }, { status: 400 });
  if (!UUID_RE.test(orgId))           return NextResponse.json({ error: "Invalid org id" },       { status: 400 });

  const db = getServiceSupabase();
  const { error } = await db.from("candidate_organizations").update({
    status: "approved",
    approved_at: new Date().toISOString(),
    approved_by: auth.email,
  }).eq("candidate_user_id", candidateUserId).eq("org_id", orgId).eq("status", "pending");

  if (error) {
    console.error("[org-requests POST] failed:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

/**
 * DELETE — reject a pending request.
 * Writes status='rejected' (audit trail) instead of hard-deleting the row.
 * Rejected rows are excluded from the pending inbox (filtered by status='pending')
 * and treated as "not linked" in the org candidates panel.
 * Body: { candidateUserId: string, orgId: string }
 */
export async function DELETE(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const candidateUserId = typeof body?.candidateUserId === "string" ? body.candidateUserId.trim() : "";
  const orgId           = typeof body?.orgId           === "string" ? body.orgId.trim()           : "";
  if (!UUID_RE.test(candidateUserId)) return NextResponse.json({ error: "Invalid candidate id" }, { status: 400 });
  if (!UUID_RE.test(orgId))           return NextResponse.json({ error: "Invalid org id" },       { status: 400 });

  const db = getServiceSupabase();
  // Mark as rejected — preserves the audit trail of who applied to which org.
  // The pending inbox filters by status='pending' so this row disappears from the inbox.
  await db.from("candidate_organizations")
    .update({ status: "rejected" })
    .eq("candidate_user_id", candidateUserId)
    .eq("org_id", orgId)
    .eq("status", "pending");
  return NextResponse.json({ success: true });
}
