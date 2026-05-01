import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";

/**
 * POST /api/portal/admin/invite-candidate
 * Creates a standalone single-use candidate invite (not linked to any org).
 * Candidates invited this way get platform access — admins assign them to orgs later.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db = getServiceSupabase();

  // Generate a unique code
  const code =
    crypto.randomUUID().replace(/-/g, "") +
    crypto.randomUUID().replace(/-/g, "").slice(0, 8);

  const { error } = await db.from("invite_tokens").insert({
    org_id: null,   // standalone — no org association
    type: "candidate",
    code,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const origin = req.nextUrl.origin;
  const url = `${origin}/join/${code}`;

  return NextResponse.json({ url, code });
}
