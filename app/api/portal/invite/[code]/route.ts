import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireUser, ciEmail } from "@/lib/admin-auth";
import { isSoftDeletedAuthUser } from "@/lib/softDeleted";
import { enforceRateLimit, enforceRateLimitDistributed } from "@/lib/rateLimit";

type OrgRow = { id: string; name: string };

type LookupResult = {
  org: OrgRow;
  type: "candidate" | "member" | "sub-admin";
  tokenId?: string;
  agencyId?: string | null;
  alreadyUsed?: boolean;
  usedBy?: string | null;
};

/**
 * Grant a Borivon sub-admin row, GUARANTEEING exactly one row for the email.
 *
 * sub_admins.email has no UNIQUE constraint, so prior approaches accumulated
 * duplicate rows on retry/race. Duplicates are the actual root cause of
 * "logged back in and became a candidate": every role lookup did
 * `.maybeSingle()`, which throws on >1 row → the sub-admin was demoted to a
 * candidate. Lookups are now duplicate-tolerant (lib/admin-auth.ts), and
 * here we kill the disease at the source: delete EVERY existing row for the
 * email, then insert ONE clean row. Fully idempotent, no constraint / no
 * migration needed, tolerant of a missing is_agency_admin column.
 * Returns an error message or null.
 */
async function grantSubAdmin(
  db: ReturnType<typeof getServiceSupabase>,
  email: string,
  name: string,
): Promise<string | null> {
  const ci = ciEmail(email);
  const dupOk = (m?: string) => !!m && /duplicate key|unique|already exists|23505/i.test(m);
  const colMissing = (m?: string) => !!m && /is_agency_admin|column .* does not exist|schema cache/i.test(m);

  // Remove any/all existing rows for this email (collapses duplicates).
  await db.from("sub_admins").delete().ilike("email", ci);

  // Insert exactly one canonical row.
  let { error } = await db.from("sub_admins")
    .insert({ email, name, label: "", is_agency_admin: false });
  if (error && colMissing(error.message)) {
    ({ error } = await db.from("sub_admins").insert({ email, name, label: "" }));
  }
  return error && !dupOk(error.message) ? error.message : null;
}

async function lookupCode(code: string): Promise<LookupResult | null> {
  const db = getServiceSupabase();

  // 1. Check single-use invite_tokens first
  const { data: token } = await db
    .from("invite_tokens")
    .select("id, org_id, type, used_by, agency_id")
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

    // Sub-admin invites are stored as the DB-allowed type 'member' with NO
    // org_id (real org-member invites always carry an org_id). Resolve that
    // shape back to 'sub-admin' so the whole downstream flow works.
    const rawType = (token as { type: string }).type;
    const resolvedType: "candidate" | "member" | "sub-admin" =
      rawType === "member" && !tokenOrgId ? "sub-admin"
      : (rawType as "candidate" | "member" | "sub-admin");

    return {
      org,
      type: resolvedType,
      tokenId: (token as { id: string }).id,
      agencyId: (token as { agency_id: string | null }).agency_id ?? null,
      alreadyUsed: !!(token as { used_by: string | null }).used_by,
      usedBy: (token as { used_by: string | null }).used_by ?? null,
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
export async function GET(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  // Public, unauthenticated code oracle. A legit user opens a join link once;
  // anything beyond that is someone brute-forcing static member/candidate
  // codes to discover a redeemable one. Trusted-IP throttle.
  const rl = enforceRateLimit(req, "invite-lookup", { limit: 20, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  const { code } = await ctx.params;
  const result = await lookupCode(code);
  if (!result) return NextResponse.json({ error: "Invalid invite" }, { status: 404 });
  if (result.alreadyUsed) {
    // "Deleted = free": if the only thing holding this token is a redeemer
    // who has since been deleted (hard) or is a deleted ghost (soft), the
    // link is reclaimable — don't show the dead-end "already used" screen.
    let blocked = true;
    if (result.usedBy) {
      const { data: prior } = await getServiceSupabase().auth.admin.getUserById(result.usedBy);
      if (!prior?.user || isSoftDeletedAuthUser(prior.user)) blocked = false;
    }
    if (blocked) {
      return NextResponse.json(
        { error: "already_used", org: result.org, type: result.type },
        { status: 410 }
      );
    }
  }
  return NextResponse.json({ org: result.org, type: result.type });
}

/** POST — authenticated: redeem invite code */
export async function POST(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // Redeeming a `member` code grants org-admin + auto gold tick; `sub-admin`
  // grants full candidate visibility. The code is the only secret — throttle
  // redemption attempts so a guessed static code can't be found by spraying.
  const rl = await enforceRateLimitDistributed(req, "invite-redeem", { limit: 8, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many attempts — try again shortly" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  const { code } = await ctx.params;
  const result = await lookupCode(code);
  if (!result) return NextResponse.json({ error: "Invalid invite" }, { status: 404 });
  // Single-use, BUT idempotent for the SAME user. The join flow can fire the
  // redeem from several places (join page, signup, login effect, auth
  // callback). If an earlier attempt already consumed the token, a later one
  // by the same person must NOT 410 → that's exactly what stranded a fresh
  // sub-admin on the candidate dashboard. Re-running just re-grants their
  // role idempotently (upserts below). Only block if a DIFFERENT user holds
  // it (real "already used by someone else").
  if (result.alreadyUsed && result.usedBy && result.usedBy !== auth.userId) {
    // The token was consumed by a DIFFERENT user id. RULE: anyone deleted is
    // FREE — if the prior redeemer is gone (hard-deleted) OR is a deleted
    // ghost (soft-deleted: banned / scrambled / user_metadata.deleted), the
    // token is orphaned and this fresh account may claim it. Only a
    // still-active different user counts as genuinely "already used".
    const { data: prior } = await getServiceSupabase().auth.admin.getUserById(result.usedBy);
    if (prior?.user && !isSoftDeletedAuthUser(prior.user)) {
      return NextResponse.json({ error: "already_used" }, { status: 410 });
    }
    // prior redeemer deleted (hard or soft) → fall through and grant.
  }

  const { org, type, tokenId, agencyId: inviteAgencyId } = result;
  const db = getServiceSupabase();

  if (type === "candidate") {
    // Candidate invites grant platform access only — no org linking.
    // Admin manually assigns candidates to orgs later from the admin panel.
    if (tokenId) {
      await db.from("invite_tokens").update({ used_by: auth.userId, used_at: new Date().toISOString() }).eq("id", tokenId);
    }
    // Tag candidate with agency_id from the invite token (if any)
    if (inviteAgencyId) {
      await db.from("candidate_profiles").upsert(
        { user_id: auth.userId, agency_id: inviteAgencyId },
        { onConflict: "user_id" }
      );
    }
    return NextResponse.json({ org, type, status: "joined" });
  }

  if (type === "sub-admin") {
    const { data: authUser } = await db.auth.admin.getUserById(auth.userId);
    const fullName = (authUser?.user?.user_metadata?.full_name ?? "").trim();
    // email is already lowercased by requireUser → matches the
    // case-insensitive role lookup. is_agency_admin:false = regular sub-admin
    // (full candidate visibility, LAW #25). Surface failures — a silent miss
    // here is exactly what dumps the new sub-admin on the candidate dashboard.
    const subErr = await grantSubAdmin(db, auth.email, fullName || auth.email);
    if (subErr) {
      console.error("[invite redeem] sub_admins grant failed:", subErr);
      return NextResponse.json({ error: "Could not grant sub-admin: " + subErr }, { status: 500 });
    }
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

  // Ensure they appear in sub_admins so the admin panel can show their name.
  // Use the same constraint-free grant as the sub-admin branch — the old
  // `.upsert(onConflict:"email")` 500'd (no unique index on sub_admins.email).
  const { data: authUser } = await db.auth.admin.getUserById(auth.userId);
  const fullName = (authUser?.user?.user_metadata?.full_name ?? "").trim();
  await grantSubAdmin(db, auth.email, fullName || auth.email);

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
