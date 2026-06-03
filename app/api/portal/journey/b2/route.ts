import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireUser, ciEmail } from "@/lib/admin-auth";
import { UUID_RE } from "@/lib/uuid";
import { isB2Stage } from "@/lib/b2Journey";

/**
 * Set a candidate's B2 sub-journey stage (candidate_profiles.b2_stage).
 * Managing parties only — supreme admin, global staff, or the partner org linked
 * to this candidate (mirrors the journey route's access model, LAW #25). The
 * candidate does NOT set their own B2 stage.
 *
 * POST { candidateId, stage }
 */
export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (!user.ok) return NextResponse.json({ error: user.error }, { status: user.status });

  const body = await req.json().catch(() => ({}));
  const candidateId = typeof body?.candidateId === "string" ? body.candidateId : "";
  const stage = body?.stage;
  const hasStage = stage !== undefined;
  const hasFailed = typeof body?.failed === "boolean";
  if (!UUID_RE.test(candidateId)) return NextResponse.json({ error: "candidateId required" }, { status: 400 });
  if (hasStage && !isB2Stage(stage)) return NextResponse.json({ error: "invalid stage" }, { status: 400 });
  if (!hasStage && !hasFailed) return NextResponse.json({ error: "nothing to update" }, { status: 400 });

  const email = user.email;
  const db = getServiceSupabase();
  const adminEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();

  // Resolve authority: supreme admin, OR a member of an org this candidate is
  // linked to (approved), OR a global (non-agency) sub-admin.
  let allowed = !!email && email === adminEmail;
  if (!allowed) {
    const { data: memRows } = await db
      .from("organization_members").select("org_id").ilike("sub_admin_email", ciEmail(email));
    const myOrgs = ((memRows ?? []) as { org_id: string }[]).map((r) => r.org_id);
    if (myOrgs.length > 0) {
      const { data: link } = await db
        .from("candidate_organizations").select("org_id")
        .eq("candidate_user_id", candidateId).eq("status", "approved").in("org_id", myOrgs).maybeSingle();
      allowed = !!link;
    } else {
      const { data: subRows } = await db
        .from("sub_admins").select("is_agency_admin").ilike("email", ciEmail(email)).limit(1);
      const sub = (subRows ?? [])[0] as { is_agency_admin: boolean } | undefined;
      allowed = !!sub && sub.is_agency_admin === false; // global staff
    }
  }
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const patch: Record<string, unknown> = {};
  if (hasStage) patch.b2_stage = stage;
  if (hasFailed) patch.b2_failed = body.failed;
  const { error } = await db
    .from("candidate_profiles")
    .update(patch)
    .eq("user_id", candidateId);
  if (error) {
    console.error("[journey/b2] update error:", error.message);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, stage, failed: hasFailed ? body.failed : undefined });
}
