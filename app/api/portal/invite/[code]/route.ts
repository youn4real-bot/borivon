import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireUser } from "@/lib/admin-auth";

type OrgRow = { id: string; name: string };

type LookupResult = {
  org: OrgRow;
  type: "candidate" | "member";
  tokenId?: string;
  alreadyUsed?: boolean;
};

async function lookupCode(code: string): Promise<LookupResult | null> {
  const db = getServiceSupabase();

  // 1. Check single-use invite_tokens first
  const { data: token } = await db
    .from("invite_tokens")
    .select("id, org_id, type, used_by")
    .eq("code", code)
    .maybeSingle();

  if (token) {
    const tokenOrgId = (token as { org_id: string | null }).org_id;
    let org: OrgRow | null = null;

    if (tokenOrgId) {
      const { data: fetchedOrg } = await db
        .from("organizations")
        .select("id, name")
        .eq("id", tokenOrgId)
        .maybeSingle();
      org = fetchedOrg as OrgRow | null;
    }

    // Standalone candidate invite — no org needed, use a placeholder
    if (!org) {
      org = { id: "", name: "Borivon" };
    }

    return {
      org,
      type: (token as { type: string }).type as "candidate" | "member",
      tokenId: (token as { id: string }).id,
      alreadyUsed: !!(token as { used_by: string | null }).used_by,
    };
  }

  // 2. Fall back to static org-level codes (backward compat)
  const upper = code.toUpperCase().replace(/[\s-]+/g, "").trim();
  const { data: byCandidate } = await db
    .from("organizations")
    .select("id, name")
    .eq("invite_code", upper)
    .maybeSingle();
  if (byCandidate) return { org: byCandidate as OrgRow, type: "candidate" };

  const { data: byMember } = await db
    .from("organizations")
    .select("id, name")
    .eq("member_invite_code", code)
    .maybeSingle();
  if (byMember) return { org: byMember as OrgRow, type: "member" };

  return null;
}

/** GET — public: resolve invite code → org name + type */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const result = await lookupCode(code);
  if (!result) return NextResponse.json({ error: "Invalid invite" }, { status: 404 });
  if (result.alreadyUsed) {
    return NextResponse.json(
      { error: "already_used", org: result.org, type: result.type },
      { status: 410 }
    );
  }
  return NextResponse.json({ org: result.org, type: result.type });
}

/** POST — authenticated: redeem invite code */
export async function POST(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { code } = await ctx.params;
  const result = await lookupCode(code);
  if (!result) return NextResponse.json({ error: "Invalid invite" }, { status: 404 });
  if (result.alreadyUsed) {
    return NextResponse.json({ error: "already_used" }, { status: 410 });
  }

  const { org, type, tokenId } = result;
  const db = getServiceSupabase();

  if (type === "candidate") {
    // Candidate invites grant platform access only — no org linking.
    // Admin manually assigns candidates to orgs later from the admin panel.
    if (tokenId) {
      await db.from("invite_tokens").update({ used_by: auth.userId, used_at: new Date().toISOString() }).eq("id", tokenId);
    }
    return NextResponse.json({ org, type, status: "joined" });
  }

  // type === "member" — add as org admin
  const { data: existing } = await db
    .from("organization_members")
    .select("role")
    .eq("org_id", org.id)
    .eq("sub_admin_email", auth.email)
    .maybeSingle();

  if (existing) {
    if (tokenId) {
      await db.from("invite_tokens").update({ used_by: auth.userId, used_at: new Date().toISOString() }).eq("id", tokenId);
    }
    return NextResponse.json({ org, type, alreadyMember: true });
  }

  // Ensure they appear in sub_admins so the admin panel can show their name
  const { data: authUser } = await db.auth.admin.getUserById(auth.userId);
  const fullName = (authUser?.user?.user_metadata?.full_name ?? "").trim();
  await db.from("sub_admins").upsert(
    { email: auth.email, name: fullName || auth.email, label: "" },
    { onConflict: "email", ignoreDuplicates: true }
  );

  await db.from("organization_members").insert({
    org_id: org.id,
    sub_admin_email: auth.email,
    role: "member",
  });

  // Auto-verify org members — they are vetted via the invite link so no
  // manual review is needed; the gold tick appears immediately.
  await db.from("candidate_profiles").upsert(
    { user_id: auth.userId, manually_verified: true },
    { onConflict: "user_id" },
  );

  // Mark token as used
  if (tokenId) {
    await db.from("invite_tokens").update({ used_by: auth.userId, used_at: new Date().toISOString() }).eq("id", tokenId);
  }

  return NextResponse.json({ org, type, status: "joined" });
}
