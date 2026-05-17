/**
 * Server-side admin / sub-admin authentication.
 *
 * Replaces the previous (broken) `x-admin-token: <email>` model where the
 * admin's email — leaked into the public JS bundle via NEXT_PUBLIC_ADMIN_EMAIL —
 * was the entire credential. Now every privileged API route requires
 *     Authorization: Bearer <supabase-jwt>
 * and we verify the JWT server-side, then look up the role.
 *
 * Server-only env: ADMIN_EMAIL (must be set; never use NEXT_PUBLIC_ADMIN_EMAIL).
 */

import { NextRequest } from "next/server";
import { getServiceSupabase, getAnonVerifyClient } from "@/lib/supabase";

/**
 * Case-insensitive EXACT email match for Postgres `ilike`.
 *
 * Historic rows in `sub_admins` / `organization_members` were stored with
 * whatever casing the admin typed, but JWT emails are normalized to
 * lowercase — so a plain `.eq("email", …)` silently misses them and the
 * sub-admin gets dumped on the candidate dashboard. We match with `ilike`
 * (case-insensitive) but escape `%` and `_` so an email like
 * `first_last@x.com` can't act as a wildcard and false-match.
 */
export function ciEmail(email: string): string {
  return email.replace(/[\\%_]/g, (c) => "\\" + c);
}

export type AdminRole = "admin" | "sub_admin";

export type AdminAuthResult =
  | { ok: true;  role: AdminRole; email: string; userId: string; agencyId: string | null; isAgencyAdmin: boolean }
  | { ok: false; status: 401 | 403; error: string };

function getAdminEmail(): string {
  // Server-only — do NOT fall back to NEXT_PUBLIC_*
  return (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
}

/**
 * Extract & verify the Supabase JWT, then resolve the caller's role.
 *
 * Returns either { ok:true, role, email, userId } or { ok:false, status, error }.
 * Callers should:
 *   const auth = await requireAdminRole(req);
 *   if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
 */
export async function requireAdminRole(req: NextRequest): Promise<AdminAuthResult> {
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return { ok: false, status: 401, error: "Missing bearer token" };
  const jwt = m[1].trim();
  if (!jwt) return { ok: false, status: 401, error: "Empty token" };

  // Verify the JWT against Supabase using the cached anon client
  const { data, error } = await getAnonVerifyClient().auth.getUser(jwt);
  if (error || !data?.user) return { ok: false, status: 401, error: "Invalid token" };

  const email = (data.user.email ?? "").trim().toLowerCase();
  if (!email) return { ok: false, status: 401, error: "User has no email" };

  // 1) Full admin?
  if (email === getAdminEmail()) {
    return { ok: true, role: "admin", email, userId: data.user.id, agencyId: null, isAgencyAdmin: false };
  }

  // 2) Sub-admin? (lookup against `sub_admins` table)
  // NOTE: sub_admins.email has no UNIQUE constraint, so duplicate rows for
  // the same email are possible (redeem retries / races). `.maybeSingle()`
  // THROWS on >1 row → that error would wrongly demote a real sub-admin to
  // candidate (the "logged back in and became a candidate" bug). Take the
  // first matching row instead — duplicate-tolerant.
  const db = getServiceSupabase();
  const { data: subRows } = await db
    .from("sub_admins")
    .select("email, agency_id, is_agency_admin")
    .ilike("email", ciEmail(email))
    .limit(1);
  const sub = (subRows ?? [])[0];
  if (sub) {
    return {
      ok: true, role: "sub_admin", email, userId: data.user.id,
      agencyId: (sub as { agency_id: string | null }).agency_id ?? null,
      isAgencyAdmin: (sub as { is_agency_admin: boolean }).is_agency_admin ?? false,
    };
  }

  return { ok: false, status: 403, error: "Forbidden" };
}

/**
 * Verify the (sub-)admin is allowed to act on a given candidate's data.
 *
 * LAW #25 — visibility rules:
 *   Supreme admin  → all candidates
 *   Sub-admin (isAgencyAdmin=false) → all candidates
 *   Org admin (isAgencyAdmin=true)  → only candidates linked to their org
 *
 * Returns true on allow, false on deny. Callers translate false → 403.
 */
export async function canActOnCandidate(role: AdminRole, subAdminEmail: string, candidateUserId: string): Promise<boolean> {
  if (role === "admin") return true;
  if (!candidateUserId) return false;
  const db = getServiceSupabase();

  // Determine if this sub-admin is an org admin or a regular sub-admin.
  // Duplicate-tolerant (sub_admins.email has no UNIQUE constraint — see
  // requireAdminRole). `.maybeSingle()` would throw on dupes and silently
  // strip the sub-admin's access.
  const { data: subRows } = await db
    .from("sub_admins")
    .select("is_agency_admin")
    .ilike("email", ciEmail(subAdminEmail))
    .limit(1);
  const isAgencyAdmin = ((subRows ?? [])[0] as { is_agency_admin: boolean } | undefined)?.is_agency_admin ?? false;

  // Regular sub-admin sees all candidates (LAW #25).
  if (!isAgencyAdmin) return true;

  // Org admin: only candidates approved-linked to their org.
  const { data: myOrgsData } = await db
    .from("organization_members")
    .select("org_id")
    .ilike("sub_admin_email", ciEmail(subAdminEmail));
  type OrgIdRow = { org_id: string };
  const myOrgs = ((myOrgsData ?? []) as OrgIdRow[]).map(r => r.org_id);
  if (myOrgs.length === 0) return false;

  const { data: candOrg } = await db
    .from("candidate_organizations")
    .select("org_id")
    .eq("candidate_user_id", candidateUserId)
    .eq("status", "approved")
    .in("org_id", myOrgs)
    .maybeSingle();
  return !!candOrg;
}

/**
 * Returns the list of candidate user_ids a sub-admin can see, or null meaning "all".
 *
 * LAW #25:
 *   Regular sub-admin (isAgencyAdmin=false) → null (no filter — sees all)
 *   Org admin (isAgencyAdmin=true)          → only their org's approved candidates
 */
export async function getVisibleCandidateIds(subAdminEmail: string): Promise<string[] | null> {
  const db = getServiceSupabase();

  // Duplicate-tolerant (sub_admins.email has no UNIQUE constraint — see
  // requireAdminRole). `.maybeSingle()` would throw on dupes and silently
  // strip the sub-admin's access.
  const { data: subRows } = await db
    .from("sub_admins")
    .select("is_agency_admin")
    .ilike("email", ciEmail(subAdminEmail))
    .limit(1);
  const isAgencyAdmin = ((subRows ?? [])[0] as { is_agency_admin: boolean } | undefined)?.is_agency_admin ?? false;

  // Regular sub-admin sees all candidates.
  if (!isAgencyAdmin) return null;

  // Org admin: only candidates approved-linked to their org.
  const { data: myOrgsData } = await db
    .from("organization_members")
    .select("org_id")
    .ilike("sub_admin_email", ciEmail(subAdminEmail));
  type OrgIdRow = { org_id: string };
  const myOrgs = ((myOrgsData ?? []) as OrgIdRow[]).map(r => r.org_id);

  if (myOrgs.length === 0) return [];

  const { data: linksData } = await db
    .from("candidate_organizations")
    .select("candidate_user_id")
    .eq("status", "approved")
    .in("org_id", myOrgs);
  type LinkRow = { candidate_user_id: string };
  return [...new Set(((linksData ?? []) as LinkRow[]).map(l => l.candidate_user_id))];
}

/**
 * Lightweight wrapper for routes that authenticate any logged-in user
 * (not just admins) — verifies the Bearer JWT and returns the user.
 */
export async function requireUser(req: NextRequest): Promise<
  | { ok: true; userId: string; email: string; jwt: string }
  | { ok: false; status: 401; error: string }
> {
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return { ok: false, status: 401, error: "Missing bearer token" };
  const jwt = m[1].trim();
  if (!jwt) return { ok: false, status: 401, error: "Empty token" };

  // Verify the JWT using the cached anon client
  const { data, error } = await getAnonVerifyClient().auth.getUser(jwt);
  if (error || !data?.user) return { ok: false, status: 401, error: "Invalid token" };

  return {
    ok: true,
    userId: data.user.id,
    email: (data.user.email ?? "").trim().toLowerCase(),
    jwt,
  };
}
