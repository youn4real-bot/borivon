import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireUser, requireAdminRole, canActOnCandidate } from "@/lib/admin-auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The logged-in candidate's assigned employer for the Motivationsschreiben
 * recipient block. Source: candidate_profiles.employer_id → employers.
 *
 * GET /api/portal/me/employer
 *   200 { assigned: true, name, lines: string[] }
 *   200 { assigned: false }
 */
export async function GET(req: NextRequest) {
  // Target resolution mirrors /me/letter-data: ?userId= present →
  // admin acting on another candidate (must canActOnCandidate); absent
  // → caller's own row.
  const paramUid = req.nextUrl.searchParams.get("userId");
  let targetUid: string;
  if (paramUid) {
    if (!UUID_RE.test(paramUid)) {
      return NextResponse.json({ error: "Invalid userId" }, { status: 400 });
    }
    const aAuth = await requireAdminRole(req);
    if (!aAuth.ok) return NextResponse.json({ error: aAuth.error }, { status: aAuth.status });
    if (!(await canActOnCandidate(aAuth.role, aAuth.email, paramUid))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    targetUid = paramUid;
  } else {
    const auth = await requireUser(req);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
    targetUid = auth.userId;
  }

  const db = getServiceSupabase();

  const { data: profile } = await db
    .from("candidate_profiles")
    .select("employer_id")
    .eq("user_id", targetUid)
    .maybeSingle();

  const employerId = (profile as { employer_id?: string } | null)?.employer_id ?? null;

  type Emp = { name: string; address_lines: string[] };
  let employer: Emp | null = null;

  if (employerId) {
    const { data, error } = await db
      .from("employers")
      .select("name, address_lines")
      .eq("id", employerId)
      .maybeSingle<Emp>();
    if (error) {
      console.error("[me/employer] lookup failed:", error);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
    employer = data ?? null;
  }

  if (!employer) return NextResponse.json({ assigned: false });

  return NextResponse.json({
    assigned: true,
    name: employer.name,
    lines: employer.address_lines ?? [],
  });
}
