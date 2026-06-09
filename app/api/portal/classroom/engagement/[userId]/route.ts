import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, requireUser, canActOnCandidate, ciEmail } from "@/lib/admin-auth";
import { getServiceSupabase } from "@/lib/supabase";
import { UUID_RE } from "@/lib/uuid";
import { computeEngagement, type ClassroomEvent, type ClassroomSession } from "@/lib/classroomEngagement";

/**
 * One candidate's engagement profile — the EMPLOYER view (also used by staff).
 *
 * Access:
 *   • supreme admin / scoped sub-admin → always (internal; they run the class).
 *   • org member (employer) → only for a candidate linked to their org, and
 *     ONLY if that candidate has ACTIVE consent (GDPR — withdrawal hides it).
 *   • anyone else → 404 (no UUID enumeration).
 *
 * GET → { consented, row } where row is null until there's ledger data /
 *       consent. The heavy ledger is aggregated server-side; only the small
 *       profile crosses the wire.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  if (!UUID_RE.test(userId)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const db = getServiceSupabase();
  let allowed = false;
  let consentRequired = true;

  // Staff path (admin / sub-admin). NB org admins are sub_admins with
  // isAgencyAdmin=true — they ARE the employer, so they're consent-gated; the
  // supreme admin + regular Borivon sub-admins are internal (no gate).
  const staff = await requireAdminRole(req);
  if (staff.ok) {
    allowed = staff.role === "admin" ? true : await canActOnCandidate("sub_admin", staff.email, userId);
    consentRequired = staff.role === "sub_admin" && staff.isAgencyAdmin === true;
  } else {
    // Org-member (employer) path — mirror the dossier's scoping exactly.
    const user = await requireUser(req);
    if (!user.ok) return NextResponse.json({ error: user.error }, { status: user.status });
    const { data: memberRows } = await db.from("organization_members").select("org_id").ilike("sub_admin_email", ciEmail(user.email)).limit(1);
    const orgId = (memberRows ?? [])[0] as { org_id: string } | undefined;
    if (orgId) {
      const { data: link } = await db.from("candidate_organizations").select("status").eq("org_id", orgId.org_id).eq("candidate_user_id", userId).maybeSingle();
      if (link) allowed = true;
    }
  }
  if (!allowed) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Consent gate for employer viewers (GDPR — withdrawal must hide the profile).
  const { data: consentRow } = await db.from("classroom_consent").select("revoked_at").eq("user_id", userId).maybeSingle();
  const consented = !!consentRow && !(consentRow as { revoked_at: string | null }).revoked_at;
  if (consentRequired && !consented) return NextResponse.json({ consented: false, row: null });

  // Aggregate just this candidate's ledger.
  const { data: evRows } = await db
    .from("classroom_events")
    .select("session_id, user_id, display_name, kind, value, at")
    .eq("user_id", userId)
    .order("at", { ascending: true })
    .limit(20000);
  const events = (evRows ?? []) as ClassroomEvent[];

  const { data: sessRows } = await db.from("classroom_sessions").select("id, ended_at");
  const sessions = (sessRows ?? []) as ClassroomSession[];

  const { data: prof } = await db.from("candidate_profiles").select("first_name, last_name").eq("user_id", userId).maybeSingle();
  const p = prof as { first_name: string | null; last_name: string | null } | null;
  const names: Record<string, string> = {};
  const nm = [p?.first_name, p?.last_name].filter(Boolean).join(" ").trim();
  if (nm) names[userId] = nm;

  const rows = computeEngagement(events, sessions, names);
  const row = rows.find((r) => r.userId === userId) ?? null;
  return NextResponse.json({ consented, row });
}
