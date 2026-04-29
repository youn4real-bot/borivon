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
import { createClient } from "@supabase/supabase-js";
import { getServiceSupabase } from "@/lib/supabase";

export type AdminRole = "admin" | "sub_admin";

export type AdminAuthResult =
  | { ok: true;  role: AdminRole; email: string; userId: string }
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

  // Verify the JWT against Supabase
  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL  ?? "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!url || !anon) return { ok: false, status: 401, error: "Auth not configured" };

  const supa = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supa.auth.getUser(jwt);
  if (error || !data?.user) return { ok: false, status: 401, error: "Invalid token" };

  const email = (data.user.email ?? "").trim().toLowerCase();
  if (!email) return { ok: false, status: 401, error: "User has no email" };

  // 1) Full admin?
  if (email === getAdminEmail()) {
    return { ok: true, role: "admin", email, userId: data.user.id };
  }

  // 2) Sub-admin? (lookup against `sub_admins` table)
  const db = getServiceSupabase();
  const { data: sub } = await db.from("sub_admins").select("email").eq("email", email).maybeSingle();
  if (sub) {
    return { ok: true, role: "sub_admin", email, userId: data.user.id };
  }

  return { ok: false, status: 403, error: "Forbidden" };
}

/**
 * Verify the (sub-)admin is allowed to act on a given candidate's data.
 * Full admins: always allowed. Sub-admins: only if assigned via
 * `sub_admin_assignments`.
 *
 * Returns true on allow, false on deny. Callers translate false → 403.
 */
export async function canActOnCandidate(role: AdminRole, subAdminEmail: string, candidateUserId: string): Promise<boolean> {
  if (role === "admin") return true;
  if (!candidateUserId) return false;
  const db = getServiceSupabase();
  const { data } = await db
    .from("sub_admin_assignments")
    .select("candidate_user_id")
    .eq("sub_admin_email", subAdminEmail)
    .eq("candidate_user_id", candidateUserId)
    .maybeSingle();
  return !!data;
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

  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL  ?? "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!url || !anon) return { ok: false, status: 401, error: "Auth not configured" };

  const supa = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supa.auth.getUser(jwt);
  if (error || !data?.user) return { ok: false, status: 401, error: "Invalid token" };

  return {
    ok: true,
    userId: data.user.id,
    email: (data.user.email ?? "").trim().toLowerCase(),
    jwt,
  };
}
