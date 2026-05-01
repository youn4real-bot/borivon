import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";

/** POST /api/portal/admin/organizations/[id]/generate-invite
 *  Body: { type: "candidate" | "member" }
 *  Creates a single-use invite token and returns its URL.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id: orgId } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const type: "candidate" | "member" = body.type === "member" ? "member" : "candidate";

  const db = getServiceSupabase();

  // Verify org exists
  const { data: org } = await db
    .from("organizations")
    .select("id, name")
    .eq("id", orgId)
    .maybeSingle();
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 });

  // Generate a unique code (UUID, no dashes)
  const code = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 8);

  const { error } = await db.from("invite_tokens").insert({
    org_id: orgId,
    type,
    code,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const origin = req.nextUrl.origin;
  const url = `${origin}/join/${code}`;

  return NextResponse.json({ url, code });
}
