import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole, canActOnCandidate } from "@/lib/admin-auth";
import { UUID_RE } from "@/lib/uuid";

/**
 * Admin assigns the candidate's employer (canonical:
 * candidate_profiles.employer_id → employers.id). Drives the recipient block
 * on the hospital Motivationsschreiben.
 *
 * GET  /api/portal/admin/assign-employer?candidateUserId=UUID
 *   200 { employerId: string | null }
 *
 * POST /api/portal/admin/assign-employer
 *   body { candidateUserId, employerId }   employerId: UUID | null (clears)
 *   200 { success: true, employerId }
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const uid = (req.nextUrl.searchParams.get("candidateUserId") ?? "").trim();
  if (!UUID_RE.test(uid)) return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  // LAW #25 scope: an org-admin (is_agency_admin=true) sub-admin must
  // only read employer assignment for candidates linked to their org.
  if (!(await canActOnCandidate(auth.role, auth.email, uid))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getServiceSupabase();
  const { data, error } = await db
    .from("candidate_profiles")
    .select("employer_id")
    .eq("user_id", uid)
    .maybeSingle();

  if (error) {
    console.error("[assign-employer] read failed:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  return NextResponse.json({ employerId: (data as { employer_id?: string } | null)?.employer_id ?? null });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({}));
  const uid  = typeof body?.candidateUserId === "string" ? body.candidateUserId.trim() : "";
  const raw  = body?.employerId;
  if (!UUID_RE.test(uid)) return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  // LAW #25 scope: same gate on writes — org-admins cannot reassign a
  // candidate that belongs to a different org.
  if (!(await canActOnCandidate(auth.role, auth.email, uid))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let employerId: string | null;
  if (raw === null) {
    employerId = null;
  } else if (typeof raw === "string" && UUID_RE.test(raw.trim())) {
    employerId = raw.trim();
  } else {
    return NextResponse.json({ error: "Invalid employer id" }, { status: 400 });
  }

  const db = getServiceSupabase();

  // Validate the employer exists + is active (skip when clearing).
  if (employerId) {
    const { data: emp } = await db
      .from("employers")
      .select("id, active")
      .eq("id", employerId)
      .maybeSingle();
    if (!emp || (emp as { active: boolean }).active === false) {
      return NextResponse.json({ error: "Unknown or inactive employer" }, { status: 400 });
    }
  }

  const { error } = await db
    .from("candidate_profiles")
    .upsert({ user_id: uid, employer_id: employerId }, { onConflict: "user_id" });

  if (error) {
    console.error("[assign-employer] update failed:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  return NextResponse.json({ success: true, employerId });
}
