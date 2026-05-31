import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";
import { UUID_RE } from "@/lib/uuid";


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
  // Optional: lock this single-use invite to ONE email. Sensitive
  // (org-admin) invites should use this so a forwarded/leaked link can't be
  // redeemed by anyone else. Empty = unbound (legacy behaviour).
  const rawEmail = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const invitedEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail) ? rawEmail : null;

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

  // Insert with invited_email when bound. Tolerate a not-yet-migrated DB
  // (column missing) by retrying without it — invite generation must never
  // break just because the migration hasn't been applied yet.
  let insErr = (await db.from("invite_tokens").insert(
    invitedEmail ? { org_id: orgId, type, code, invited_email: invitedEmail }
                 : { org_id: orgId, type, code },
  )).error;
  if (insErr && invitedEmail && /invited_email|column|schema cache/i.test(insErr.message)) {
    insErr = (await db.from("invite_tokens").insert({ org_id: orgId, type, code })).error;
  }
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  const origin = req.nextUrl.origin;
  // Human-readable role word in the path so a shared link is self-evident
  // (candidate vs organization). Cosmetic only — the real role is resolved
  // server-side from the code, so an edited word can't change anything.
  const word = type === "member" ? "organization" : "candidate";
  const url = `${origin}/join/${word}/${code}`;

  return NextResponse.json({ url, code });
}
