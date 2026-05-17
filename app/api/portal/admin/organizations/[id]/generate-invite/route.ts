import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** POST /api/portal/admin/organizations/[id]/generate-invite
 *  Body: { type: "candidate" | "member" }
 *  Creates a single-use invite token and returns its URL.
 *
 *  Supreme-admin ONLY. A `member` token grants org-admin access (full
 *  candidate-dossier visibility for that org, LAW #25). A sub_admin minting
 *  one for an arbitrary org = privilege escalation — mirror the supreme gate
 *  every sibling org route already enforces (see regenerate-code).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id: orgId } = await ctx.params;
  if (!UUID_RE.test(orgId)) return NextResponse.json({ error: "Invalid org id" }, { status: 400 });
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
  // Human-readable role word in the path so a shared link is self-evident
  // (candidate vs organization). Cosmetic only — the real role is resolved
  // server-side from the code, so an edited word can't change anything.
  const word = type === "member" ? "organization" : "candidate";
  const url = `${origin}/join/${word}/${code}`;

  return NextResponse.json({ url, code });
}
