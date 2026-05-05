import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, requireUser } from "@/lib/admin-auth";
import { getServiceSupabase } from "@/lib/supabase";

/**
 * Returns the caller's role for client-side routing.
 *
 *   { role: "admin",      isSuperAdmin: true  }
 *   { role: "sub_admin",  isSuperAdmin: false }
 *   { role: "org_member", isSuperAdmin: false, orgId: "...", orgName: "..." }
 *   { role: null,         isSuperAdmin: false }
 */
export async function GET(req: NextRequest) {
  // 1. Check admin first (full admin only — not sub_admin)
  const auth = await requireAdminRole(req);
  if (auth.ok && auth.role === "admin") {
    return NextResponse.json({ role: "admin", isSuperAdmin: true });
  }

  // 2. Verify user identity (needed for org_member and sub_admin checks)
  const user = await requireUser(req);
  if (!user.ok) return NextResponse.json({ error: user.error }, { status: user.status });

  const db = getServiceSupabase();

  // 3. Check org membership BEFORE sub_admin — org members are also added to
  //    sub_admins (so the admin panel can show their name), but they should be
  //    routed to the org dashboard, not the admin panel.
  const { data: membership } = await db
    .from("organization_members")
    .select("org_id, role")
    .eq("sub_admin_email", user.email)
    .maybeSingle();

  if (membership) {
    const { data: org } = await db
      .from("organizations")
      .select("name")
      .eq("id", (membership as { org_id: string; role: string }).org_id)
      .maybeSingle();

    // Ensure org members are always verified — awaited so the write completes
    // before the response returns (void would be killed by the serverless runtime).
    await db.from("candidate_profiles").upsert(
      { user_id: user.userId, manually_verified: true },
      { onConflict: "user_id" },
    );

    return NextResponse.json({
      role:        "org_member",
      isSuperAdmin: false,
      orgId:       (membership as { org_id: string }).org_id,
      orgName:     (org as { name: string } | null)?.name ?? "",
    });
  }

  // 4. Sub-admin (agent who manages candidates)
  if (auth.ok && auth.role === "sub_admin") {
    return NextResponse.json({
      role: "sub_admin",
      isSuperAdmin: false,
      agencyId: auth.agencyId ?? null,
      isAgencyAdmin: auth.isAgencyAdmin ?? false,
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
  return NextResponse.json({ role: "candidate", isSuperAdmin: false, paymentTier });
}
