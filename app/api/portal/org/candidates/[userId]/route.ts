import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireUser } from "@/lib/admin-auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/portal/org/candidates/[userId]
 *
 * Returns a read-only dossier for a candidate that belongs to the caller's org.
 * Org members only — candidates and plain admins are rejected.
 *
 * Audit fix: returns 404 (not 403) for non-existent OR not-in-your-org
 * candidates so an org member can't enumerate UUIDs to learn which candidates
 * exist system-wide. UUID is also validated up front to fail fast on garbage.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId: candidateId } = await params;
  if (!UUID_RE.test(candidateId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db = getServiceSupabase();

  // Verify caller is an org member and get their org id
  const { data: membership } = await db
    .from("organization_members")
    .select("org_id")
    .eq("sub_admin_email", auth.email)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const orgId = (membership as { org_id: string }).org_id;

  // Verify candidate belongs to this org. Return 404 (not 403) so the caller
  // can't distinguish "candidate doesn't exist" from "exists but not in
  // your org" — prevents enumeration.
  const { data: link } = await db
    .from("candidate_organizations")
    .select("status")
    .eq("org_id", orgId)
    .eq("candidate_user_id", candidateId)
    .maybeSingle();

  if (!link) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Get auth user info (name + email)
  let name = "—";
  let email = "";
  try {
    const { data } = await db.auth.admin.getUserById(candidateId);
    if (data?.user) {
      name  = data.user.user_metadata?.full_name ?? data.user.email ?? "—";
      email = data.user.email ?? "";
    }
  } catch { /* skip */ }

  // Get candidate profile data
  const { data: profile } = await db
    .from("candidate_profiles")
    .select("manually_verified, profile_photo, payment_tier, passport_status, cv_draft")
    .eq("user_id", candidateId)
    .maybeSingle();

  const p = profile as {
    manually_verified: boolean | null;
    profile_photo: string | null;
    payment_tier: string | null;
    passport_status: string | null;
    cv_draft: unknown;
  } | null;

  // Count documents by status
  const { data: docs } = await db
    .from("documents")
    .select("status")
    .eq("user_id", candidateId);

  const docRows = (docs ?? []) as { status: string }[];
  const docCount   = docRows.length;
  const docsOk     = docRows.filter(d => d.status === "approved").length;
  const docsPending = docRows.filter(d => d.status === "pending").length;

  return NextResponse.json({
    candidateId,
    name,
    email,
    photo:          p?.profile_photo ?? null,
    verified:       !!p?.manually_verified,
    tier:           p?.payment_tier ?? null,
    passportStatus: p?.passport_status ?? null,
    hasCvDraft:     !!p?.cv_draft,
    docCount,
    docsOk,
    docsPending,
    linkStatus:     (link as { status: string }).status,
  });
}
