import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, requireUser } from "@/lib/admin-auth";
import { getServiceSupabase } from "@/lib/supabase";
import { resolveAcademyVisible } from "@/lib/academyVisibility";

/**
 * Returns the caller's role for client-side routing.
 *
 *   { role: "admin",      isSuperAdmin: true  }
 *   { role: "sub_admin",  isSuperAdmin: false }  // incl. org-scoped admins
 *   { role: null,         isSuperAdmin: false }
 */
export async function GET(req: NextRequest) {
  // 1. Check admin first (full admin only — not sub_admin)
  const auth = await requireAdminRole(req);
  if (auth.ok && auth.role === "admin") {
    // Supreme always sees the Academy tab (they own its visibility).
    return NextResponse.json({ role: "admin", isSuperAdmin: true, academyVisible: true });
  }

  // 2. Verify user identity (needed for org_member and sub_admin checks)
  const user = await requireUser(req);
  if (!user.ok) return NextResponse.json({ error: user.error }, { status: user.status });

  const db = getServiceSupabase();
  const academyVisible = await resolveAcademyVisible(user.userId, user.email);

  // 3. Org people are now ORG-SCOPED sub-admins: they get the full Borivon
  //    admin dashboard (/portal/admin) restricted to their organization's
  //    candidates, and resolve through the sub_admin branch below — NOT a
  //    separate org_member role. The old org_member role + the limited
  //    /portal/org/dashboard were retired. Scope is enforced server-side by
  //    organization_members membership (canActOnCandidate / getVisibleCandidateIds),
  //    so an org admin can never see a candidate outside their org.

  // 4. Sub-admin (agent who manages candidates)
  if (auth.ok && auth.role === "sub_admin") {
    return NextResponse.json({
      role: "sub_admin",
      isSuperAdmin: false,
      agencyId: auth.agencyId ?? null,
      isAgencyAdmin: auth.isAgencyAdmin ?? false,
      academyVisible,
    });
  }

  // 5. Regular candidate — also return payment_tier so the navbar can hide
  //    the upgrade modal entirely for users who already paid for Premium.
  const { data: profile } = await db
    .from("candidate_profiles")
    .select("payment_tier")
    .eq("user_id", user.userId)
    .maybeSingle();
  const paymentTier = (profile as { payment_tier?: string | null } | null)?.payment_tier ?? null;
  return NextResponse.json({ role: "candidate", isSuperAdmin: false, paymentTier, academyVisible });
}
