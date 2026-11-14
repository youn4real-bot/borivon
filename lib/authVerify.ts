/**
 * Bearer token → user. The ONE server-side path: requireUser / requireAdminRole
 * (lib/admin-auth.ts) and every route that used to call
 * getAnonVerifyClient().auth.getUser(jwt) itself.
 *
 *  1. Local check (lib/jwtVerify.ts): ES256 signature against Supabase's
 *     published key + exp / iss / aud / sub / role. No network.
 *  2. Deleted = gone everywhere. The claims are from mint time, so both delete
 *     paths put the id on a D1 list first (lib/authRevoked.ts) and a listed id
 *     is refused here; the soft-delete flags inside the claims are checked too.
 *  3. Whatever the local check cannot decide — or a list that cannot be read —
 *     goes to Supabase exactly as before (auth.getUser + isSoftDeletedAuthUser).
 *     Worst case = yesterday's behaviour, never weaker.
 *  4. What only Supabase knows (signed out, banned or deleted in the Supabase
 *     dashboard): the same auth.getUser runs AFTER the response (keepAlive →
 *     waitUntil), once per session per REVALIDATE_EVERY_MS per isolate. When it
 *     says the session is over, this isolate refuses that session from then on.
 *     Only a definitive answer counts (session / user not found, soft-deleted);
 *     a blip or an "expired" inside our clock leeway changes nothing.
 */
import { getAnonVerifyClient } from "@/lib/supabase";
import { isSoftDeletedAuthUser } from "@/lib/softDeleted";
import { keepAlive } from "@/lib/keepAlive";
import { verifySupabaseJwt, type SupabaseJwtClaims, type JwtVerdict } from "@/lib/jwtVerify";
import { isUserRevoked } from "@/lib/authRevoked";

export type VerifiedUser = {
  id: string;
  email?: string;
  phone?: string;
  user_metadata: Record<string, unknown>;
  app_metadata: Record<string, unknown>;
};

type Refused = { ok: false; error: "Invalid token" | "Account disabled" };
export type TokenCheck = { ok: true; user: VerifiedUser; via: "local" | "supabase" } | Refused;

const INVALID: Refused = { ok: false, error: "Invalid token" };
const DISABLED: Refused = { ok: false, error: "Account disabled" };

/** Background re-check of a locally accepted session: at most this often per isolate. */
export const REVALIDATE_EVERY_MS = 60_000;
const MAX_SESSIONS = 5_000;

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function userFromClaims(c: SupabaseJwtClaims): VerifiedUser {
  return {
    id: c.sub,
    email: typeof c.email === "string" ? c.email : undefined,
    phone: typeof c.phone === "string" ? c.phone : undefined,
    user_metadata: record(c.user_metadata),
    app_metadata: record(c.app_metadata),
  };
}

function userFromSupabase(u: { id: string; email?: string; phone?: string; user_metadata?: unknown; app_metadata?: unknown }): VerifiedUser {
  return { id: u.id, email: u.email, phone: u.phone, user_metadata: record(u.user_metadata), app_metadata: record(u.app_metadata) };
}

/* ── per-isolate session state (step 4) ────────────────────────────────────── */

type SessionState = { checkedAt: number; ended: Refused | null };
const sessions = new Map<string, SessionState>();
const running = new Set<Promise<void>>();

function sessionKey(c: SupabaseJwtClaims): string {
  return typeof c.session_id === "string" && c.session_id ? `s:${c.session_id}` : `t:${c.sub}:${String(c.iat ?? "")}`;
}

/** Supabase's live answer: a refusal = the session is over, null = fine, undefined = no definitive answer. */
function liveAnswer(user: unknown, error: unknown): Refused | null | undefined {
  if (error) {
    const e = error as { name?: unknown; code?: unknown };
    // auth-js maps GoTrue's session_not_found to AuthSessionMissingError (no code).
    if (e.name === "AuthSessionMissingError" || e.code === "session_not_found" || e.code === "user_not_found" || e.code === "user_banned") return INVALID;
    return undefined;
  }
  if (!user) return undefined;
  return isSoftDeletedAuthUser(user) ? DISABLED : null;
}

function revalidateLater(token: string, key: string): void {
  const now = Date.now();
  const prev = sessions.get(key);
  if (prev && now - prev.checkedAt < REVALIDATE_EVERY_MS) return;
  if (!prev && sessions.size >= MAX_SESSIONS) sessions.clear();
  sessions.set(key, { checkedAt: now, ended: prev?.ended ?? null });
  keepAlive(() => {
    const p = (async () => {
      try {
        const { data, error } = await getAnonVerifyClient().auth.getUser(token);
        const ended = liveAnswer(data?.user, error);
        if (ended !== undefined) sessions.set(key, { checkedAt: Date.now(), ended });
      } catch {
        /* no definitive answer — keep what we had */
      }
    })();
    running.add(p);
    void p.finally(() => running.delete(p));
    return p;
  });
}

/* ── the check ─────────────────────────────────────────────────────────────── */

async function acceptLocally(token: string, claims: SupabaseJwtClaims): Promise<TokenCheck | null> {
  const user = userFromClaims(claims);
  if (isSoftDeletedAuthUser(user)) return DISABLED; // deleted flags already inside the token
  const key = sessionKey(claims);
  const ended = sessions.get(key)?.ended;
  if (ended) {
    revalidateLater(token, key);
    return ended;
  }
  const listed = await isUserRevoked(user.id);
  if (listed === true) return DISABLED;
  if (listed === null) return null; // list unreadable → Supabase decides
  revalidateLater(token, key);
  return { ok: true, user, via: "local" };
}

async function viaSupabase(token: string): Promise<TokenCheck> {
  const { data, error } = await getAnonVerifyClient().auth.getUser(token);
  if (error || !data?.user) return INVALID;
  // A "deleted" account whose hard delete was FK-blocked is only banned +
  // email-scrambled + user_metadata.deleted — its JWT still verifies.
  if (isSoftDeletedAuthUser(data.user)) return DISABLED;
  return { ok: true, user: userFromSupabase(data.user), via: "supabase" };
}

/**
 * Verify a Supabase access token (the raw JWT, no "Bearer ").
 * { ok:true, user } or { ok:false, error: "Invalid token" | "Account disabled" } (→ 401).
 */
export async function verifyAccessToken(jwt: string): Promise<TokenCheck> {
  const token = typeof jwt === "string" ? jwt.trim() : "";
  if (!token) return INVALID;
  const verdict: JwtVerdict = await verifySupabaseJwt(token);
  if (verdict.kind === "invalid") return INVALID;
  if (verdict.kind === "valid") {
    const local = await acceptLocally(token, verdict.claims);
    if (local) return local;
  }
  return viaSupabase(token);
}

/**
 * Drop-in for `getAnonVerifyClient().auth.getUser(jwt)` in a route: the same
 * `{ data: { user }, error }` shape, so a call site changes one line. A deleted /
 * disabled account comes back as an error too (several routes never checked).
 */
export async function getUserFromToken(jwt: string): Promise<
  | { data: { user: VerifiedUser }; error: null }
  | { data: { user: null }; error: { message: string; status: 401 } }
> {
  const r = await verifyAccessToken(jwt);
  return r.ok ? { data: { user: r.user }, error: null } : { data: { user: null }, error: { message: r.error, status: 401 } };
}

/** Tests: wait for the background re-checks started so far. */
export async function settleAuthBackgroundForTests(): Promise<void> {
  while (running.size) await Promise.all([...running]);
}

/** Tests: forget the per-isolate session state. */
export function resetAuthVerifyForTests(): void {
  sessions.clear();
}
