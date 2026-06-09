"use client";

/**
 * Single source of truth for "what is the signed-in user's role" on the client.
 *
 * Two problems this solves for the global chrome (navbar tabs + the 4 top-right
 * icons: checklist, chat, bell, profile):
 *
 *  1. STAGGER — each of those components independently called
 *     `fetch("/api/portal/me/role")` on mount, so on a cold load / refresh they
 *     popped in one-by-one as their separate requests resolved. `fetchMyRole`
 *     MEMOIZES the in-flight request per access-token, so all callers share ONE
 *     network round-trip and flip to "ready" together.
 *
 *  2. FIRST-PAINT GAP / "missing buttons" — `cachedRole(uid)` returns the role
 *     persisted from the last resolve (keyed by user id), so on every load after
 *     the first the chrome can render the CORRECT variant instantly, before the
 *     network even answers. Keyed by uid → a different user (or post-logout)
 *     never reads a stale role.
 *
 * The network result always overwrites the cached seed, so a real role change
 * self-corrects within one request.
 */

export type RoleName = "admin" | "sub_admin" | "org_member" | "candidate";
export type RoleInfo = {
  role: RoleName | null;
  isSuperAdmin?: boolean;
  isAgencyAdmin?: boolean;
  academyVisible?: boolean;
  orgName?: string | null;
  paymentTier?: string | null;
  /** Private-test allowlist for the live classroom (candidates only). */
  classroomTester?: boolean;
  /** Standing test pair (supreme admin + Soufiane) — sees experimental/in-test
   *  features before any rollout. The client gate for new features. */
  experimental?: boolean;
};

const CACHE_KEY = "bv_role_v1";

/** Read the cached role for a given user id (null if absent or for another user). */
export function cachedRole(uid: string | null | undefined): RoleName | null {
  if (!uid || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const e = JSON.parse(raw) as { uid: string; role: RoleName };
    return e.uid === uid ? e.role : null;
  } catch { return null; }
}

function writeCache(uid: string, role: RoleName | null) {
  if (typeof window === "undefined" || !uid || !role) return;
  try { window.localStorage.setItem(CACHE_KEY, JSON.stringify({ uid, role })); } catch { /* private mode */ }
}

let inflight: { token: string; p: Promise<RoleInfo> } | null = null;

/**
 * Fetch /api/portal/me/role, deduped per access-token (the burst of mounts on a
 * cold load share one request). Persists the resolved role to the uid-keyed
 * cache. Never throws — returns { role: null } on any failure.
 */
export function fetchMyRole(token: string, uid?: string | null): Promise<RoleInfo> {
  if (!token) return Promise.resolve({ role: null });
  if (inflight && inflight.token === token) return inflight.p;
  const p = fetch("/api/portal/me/role", { headers: { Authorization: `Bearer ${token}` } })
    .then((r) => (r.ok ? r.json() : { role: null }))
    .then((j: RoleInfo) => { if (uid && j?.role) writeCache(uid, j.role); return j; })
    .catch(() => ({ role: null as RoleName | null }));
  inflight = { token, p };
  return p;
}

/** Drop the memoized request + cache (call on sign-out). */
export function clearMyRole() {
  inflight = null;
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
}

/** The portal home a given role should land on — used for the navbar Dashboard tab. */
export function homeForRole(role: RoleName | null | undefined): string {
  if (role === "admin" || role === "sub_admin") return "/portal/admin";
  if (role === "org_member") return "/portal/org/dashboard";
  return "/portal/dashboard";
}
