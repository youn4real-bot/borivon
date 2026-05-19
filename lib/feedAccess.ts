/**
 * Feed channel access — the SINGLE source of truth for "can this user touch
 * this post / this channel".
 *
 * The community has a global Borivon channel (feed_posts.org_id IS NULL) plus
 * one private channel per organization (org_id set). `feed/route.ts` already
 * enforced this on GET/POST, but the per-post sub-routes
 * (/[id]/like, /[id]/comments, /[id] DELETE) trusted a raw post UUID with NO
 * channel check — any logged-in candidate could like/comment/read a private
 * org channel's posts by guessing an id, and a sub-admin scoped to org A could
 * delete org B's posts. This module closes that by gating every per-post
 * action on the post's channel.
 *
 * Keep ALL feed channel-access logic flowing through this file.
 */

import { getServiceSupabase } from "@/lib/supabase";

type Db = ReturnType<typeof getServiceSupabase>;

/**
 * Org IDs a user may read posts from / post into.
 * - admin (env ADMIN_EMAIL): every org
 * - org_member: orgs they're listed in via organization_members
 * - candidate: orgs they're APPROVED-linked to via candidate_organizations
 */
export async function getAccessibleOrgIds(
  db: Db,
  userId: string,
  email: string,
): Promise<{ orgIds: Set<string>; isOrgMember: boolean }> {
  const adminEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  if (email === adminEmail) {
    const { data: orgs } = await db.from("organizations").select("id");
    return {
      orgIds: new Set(((orgs ?? []) as { id: string }[]).map(o => o.id)),
      isOrgMember: false,
    };
  }
  const { data: memberRows, error: memberErr } = await db
    .from("organization_members")
    .select("org_id")
    .eq("sub_admin_email", email);
  const { data: candRows, error: candErr } = await db
    .from("candidate_organizations")
    .select("org_id")
    .eq("candidate_user_id", userId)
    .eq("status", "approved");

  // FAIL CLOSED: the old code ignored errors → on a transient blip an
  // org-member was misclassified isOrgMember=false, which SKIPS the
  // global-feed block → they could read/post the global Borivon channel.
  // On any error, treat them as an org member with NO accessible orgs:
  // blocked from global AND from every org channel until it recovers.
  if (memberErr || candErr) {
    return { orgIds: new Set<string>(), isOrgMember: true };
  }

  const memberOrgIds = ((memberRows ?? []) as { org_id: string }[]).map(r => r.org_id);
  const candOrgIds = ((candRows ?? []) as { org_id: string }[]).map(r => r.org_id);

  return {
    orgIds: new Set([...memberOrgIds, ...candOrgIds]),
    isOrgMember: memberOrgIds.length > 0,
  };
}

export type PostAccess =
  | { ok: true }
  | { ok: false; status: 403 | 404 };

/**
 * Can `userId`/`email` act on the post identified by `postId`?
 *
 * Mirrors feed/route.ts GET semantics exactly:
 *   • post not found              → 404
 *   • global post (org_id NULL)   → everyone EXCEPT org members (supreme ok)
 *   • org post (org_id set)       → only users with access to that org
 *
 * Legacy DB without the org_id column → treat as global (preserve old
 * behavior so a not-yet-migrated DB doesn't 403 the whole feed).
 */
export async function canAccessPost(
  db: Db,
  postId: string,
  userId: string,
  email: string,
): Promise<PostAccess> {
  const adminEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();

  // Try to read org_id; fall back ONLY if the column genuinely doesn't exist.
  let orgId: string | null = null;
  let columnMissing = false;
  {
    const { data, error } = await db
      .from("feed_posts")
      .select("org_id")
      .eq("id", postId)
      .maybeSingle();
    if (error) {
      // SECURITY: the old check was `error.message.includes("org_id")` — ANY
      // error string mentioning the column (a transient permission/RLS error)
      // tripped the "no org channels" branch and granted access. Only Postgres
      // 42703 (undefined_column) is a real missing column. Anything else →
      // fail closed.
      const undefinedColumn =
        (error as { code?: string }).code === "42703" ||
        /column .*org_id.* does not exist/i.test(error.message ?? "");
      if (!undefinedColumn) return { ok: false, status: 403 };
      columnMissing = true;
    } else {
      if (!data) return { ok: false, status: 404 };
      orgId = (data as { org_id: string | null }).org_id ?? null;
    }
  }

  const { orgIds, isOrgMember } = await getAccessibleOrgIds(db, userId, email);

  if (columnMissing) {
    // No org_id column → every post is the global Borivon channel. Confirm
    // the post exists, and still enforce the global rule: org members are
    // blocked from the global feed (supreme always allowed).
    if (isOrgMember && email !== adminEmail) return { ok: false, status: 403 };
    const { data } = await db.from("feed_posts").select("id").eq("id", postId).maybeSingle();
    return data ? { ok: true } : { ok: false, status: 404 };
  }

  if (orgId === null) {
    // Global Borivon community — org members are blocked (it's not theirs),
    // supreme admin always allowed.
    if (isOrgMember && email !== adminEmail) return { ok: false, status: 403 };
    return { ok: true };
  }
  return orgIds.has(orgId) ? { ok: true } : { ok: false, status: 403 };
}
