import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
