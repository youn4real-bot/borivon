import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireUser } from "@/lib/admin-auth";

/**
 * GET /api/portal/org/me
 * Returns the org this user is a member of, its requirements, and linked candidates.
 * Used by the org member portal.
 */
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db = getServiceSupabase();

  // Find org membership by email
  const { data: membership } = await db
    .from("organization_members")
    .select("org_id, role")
    .eq("sub_admin_email", auth.email)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Not an org member" }, { status: 403 });
  }

  // Get org details
  const { data: org } = await db
    .from("organizations")
    .select("id, name, logo_filename, footer_text, notes")
    .eq("id", membership.org_id)
    .maybeSingle();

  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 });

  // Get requirements
  const { data: reqs } = await db
    .from("org_requirements")
    .select("id, facility_type, bundesland, city, slots, start_date, notes, active, created_at, specialty, location")
    .eq("org_id", membership.org_id)
    .order("created_at", { ascending: false });

  // Get linked candidates (names + verification status only — no contact info)
  const { data: links } = await db
    .from("candidate_organizations")
    .select("candidate_user_id, status")
    .eq("org_id", membership.org_id)
    .eq("status", "approved");

  const candidateIds = ((links ?? []) as { candidate_user_id: string; status: string }[]).map(l => l.candidate_user_id);
  const candidates: { userId: string; name: string; email: string; verified: boolean; profilePhoto: string | null }[] = [];

  if (candidateIds.length > 0) {
    // Get names + emails from auth
    const adminClient = getServiceSupabase();
    const nameMap:  Record<string, string> = {};
    const emailMap: Record<string, string> = {};
    await Promise.all(candidateIds.map(async uid => {
      try {
        const { data } = await adminClient.auth.admin.getUserById(uid);
        if (data?.user) {
          nameMap[uid]  = data.user.user_metadata?.full_name ?? "—";
          emailMap[uid] = data.user.email ?? "";
        }
      } catch { /* skip */ }
    }));

    // Get verification + photo
    const { data: profiles } = await db
      .from("candidate_profiles")
      .select("user_id, manually_verified, profile_photo")
      .in("user_id", candidateIds);

    for (const uid of candidateIds) {
      const p = (profiles ?? []).find((x: { user_id: string }) => x.user_id === uid) as { user_id: string; manually_verified: boolean | null; profile_photo: string | null } | undefined;
      candidates.push({
        userId:       uid,
        name:         nameMap[uid] ?? "—",
        email:        emailMap[uid] ?? "",
        verified:     !!p?.manually_verified,
        profilePhoto: p?.profile_photo ?? null,
      });
    }
  }

  return NextResponse.json({
    org: { ...org, memberRole: membership.role },
    requirements: reqs ?? [],
    candidates,
  });
}
