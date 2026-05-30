import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole, ciEmail } from "@/lib/admin-auth";

/**
 * POST /api/portal/admin/invite-candidate
 *
 * Borivon HQ admins (supreme + plain sub-admins) → a standalone SINGLE-USE
 * candidate invite (no org). They assign candidates to orgs manually later.
 *
 * ORG admins (sub_admin tied to an organization) → their org's PERMANENT
 * candidate link (the static `organizations.invite_code`). It never expires
 * and anyone who signs up through it is AUTO-ASSIGNED to that org (the link is
 * org-scoped; see /api/portal/invite/[code] POST candidate branch). Borivon HQ
 * still sees those candidates + their notifications (link is approved, global
 * admin_notifications fire).
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db = getServiceSupabase();
  const origin = req.nextUrl.origin;

  // ── Org admin → permanent, org-scoped candidate link ───────────────────────
  if (auth.role === "sub_admin" && auth.isAgencyAdmin) {
    const { data: mem } = await db
      .from("organization_members")
      .select("org_id")
      .ilike("sub_admin_email", ciEmail(auth.email))
      .limit(1);
    const orgId = ((mem ?? [])[0] as { org_id: string } | undefined)?.org_id ?? null;
    if (orgId) {
      const { data: org } = await db
        .from("organizations")
        .select("invite_code")
        .eq("id", orgId)
        .maybeSingle();
      const code = (org as { invite_code?: string } | null)?.invite_code ?? "";
      if (code) {
        // Static org code → /join/candidate/<code> resolves to this org and
        // auto-assigns on redeem. Permanent + reusable.
        return NextResponse.json({ url: `${origin}/join/candidate/${code}`, code });
      }
    }
    // No org / no code → fall through to a standalone invite (shouldn't happen).
  }

  // ── HQ admins → standalone single-use candidate invite ─────────────────────
  const code =
    crypto.randomUUID().replace(/-/g, "") +
    crypto.randomUUID().replace(/-/g, "").slice(0, 8);

  const { error } = await db.from("invite_tokens").insert({
    org_id: null,   // standalone — no org association
    type: "candidate",
    code,
    agency_id: auth.agencyId ?? null,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Role word is a human label so anyone seeing the link knows it's for a
  // candidate — not trusted (server resolves the real role from the code).
  const url = `${origin}/join/candidate/${code}`;

  return NextResponse.json({ url, code });
}
