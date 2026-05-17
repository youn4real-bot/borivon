import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";

export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  // Audit fix: minting sub-admin invite tokens is supreme-admin ONLY.
  // A sub_admin redeeming one gains all-candidate visibility (LAW #25) →
  // privilege escalation. Mirrors /api/portal/admin/sub-admins.
  if (auth.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getServiceSupabase();

  const code =
    crypto.randomUUID().replace(/-/g, "") +
    crypto.randomUUID().replace(/-/g, "").slice(0, 8);

  // Each invite code is uniquely bound to ONE role:
  //   candidate  → type 'candidate'
  //   org-admin  → type 'member'  WITH an org_id
  //   sub-admin  → type 'sub-admin'  (clean, explicit)
  // Preferred: insert the explicit 'sub-admin' type. If the DB CHECK hasn't
  // been widened yet (run supabase/invite_tokens_allow_subadmin.sql once),
  // fall back to the still-unambiguous 'member' + NO org_id, which
  // lookupCode also resolves to 'sub-admin'. So the code is role-unique
  // either way, regardless of email confirmation.
  let { error } = await db.from("invite_tokens").insert({
    org_id: null,
    type: "sub-admin",
    code,
    agency_id: auth.agencyId ?? null,
  });
  if (error) {
    ({ error } = await db.from("invite_tokens").insert({
      org_id: null,
      type: "member",
      code,
      agency_id: auth.agencyId ?? null,
    }));
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Role word = human label ("subadmin") so the link is self-evident; the
  // real role is still resolved server-side from the code, never the word.
  const url = `${req.nextUrl.origin}/join/subadmin/${code}`;
  return NextResponse.json({ url, code });
}
