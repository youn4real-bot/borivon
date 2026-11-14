/**
 * "Deleted = gone everywhere" for tokens checked locally (lib/authVerify.ts).
 *
 * A locally verified token carries the account as it was when the token was
 * minted. Supabase's auth.getUser(jwt) used to read the CURRENT account on every
 * request, so a deleted or soft-disabled person was refused at once; a token
 * checked against the public key alone would keep working until it expires.
 *
 * So both delete paths (app/api/portal/admin/delete-user, the bot's
 * deleteCandidateAccount in lib/assistantWrites.ts) put the user id on this D1
 * list BEFORE they remove anything, and the verifier refuses a listed id. Ids
 * are never reused (a re-registration is a new uuid), so an entry never needs
 * to come off. Raw D1 (like lib/track/server.ts): one tiny table, created on
 * first use, outside the Supabase-shaped adapter and d1/types.json.
 *
 * The lookup is one primary-key read. "Not listed" is remembered per isolate for
 * NEGATIVE_TTL_MS, so a delete reaches every isolate within that time (the
 * isolate that ran the delete knows at once). "Listed" is remembered for good.
 * A lookup that FAILS answers null — the verifier then asks Supabase instead, so
 * a D1 blip neither locks anyone out nor lets a deleted person in.
 */
import { getD1, type D1Runner } from "@/lib/d1/client";
import { scheduleBackground } from "@/lib/d1/background";

const TABLE = "auth_revoked_users";
const DDL = `CREATE TABLE IF NOT EXISTS ${TABLE} (
  user_id TEXT PRIMARY KEY,
  revoked_at TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT ''
)`;

/** How long "not listed" is trusted per isolate. */
export const NEGATIVE_TTL_MS = 30_000;
const MAX_REMEMBERED = 5_000;

const clearUntil = new Map<string, number>(); // user id → "not listed" trusted until (ms)
const listed = new Set<string>();             // user ids known to be on the list
const lookups = new Map<string, Promise<boolean | null>>(); // one D1 read per id at a time

function remember(userId: string, isListed: boolean): void {
  if (isListed) {
    clearUntil.delete(userId);
    if (listed.size >= MAX_REMEMBERED) listed.clear(); // D1 stays the source of truth
    listed.add(userId);
    return;
  }
  if (clearUntil.size >= MAX_REMEMBERED) clearUntil.clear();
  clearUntil.set(userId, Date.now() + NEGATIVE_TTL_MS);
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function lookup(userId: string): Promise<boolean | null> {
  let db: D1Runner | null;
  try { db = await getD1(); } catch { return null; }
  if (!db) return null; // no D1 here → the verifier falls back to Supabase
  try {
    const { results } = await db.run(`SELECT 1 AS hit FROM ${TABLE} WHERE user_id = ? LIMIT 1`, [userId]);
    const hit = results.length > 0;
    remember(userId, hit);
    return hit;
  } catch (e) {
    // No table yet = nobody was ever put on the list. Create it for next time.
    if (/no such table/i.test(message(e))) {
      try { await db.run(DDL); } catch { /* the next lookup tries again */ }
      remember(userId, false);
      return false;
    }
    return null;
  }
}

/**
 * Is this user on the revoked list?
 *   true  → refuse the token (fail closed for a listed user)
 *   false → not listed
 *   null  → could not tell: the caller must decide some other way (ask Supabase)
 */
export function isUserRevoked(userId: string): Promise<boolean | null> {
  if (!userId) return Promise.resolve(null);
  if (listed.has(userId)) return Promise.resolve(true);
  const until = clearUntil.get(userId);
  if (until !== undefined && until > Date.now()) return Promise.resolve(false);
  const running = lookups.get(userId);
  if (running) return running;
  const p = lookup(userId);
  lookups.set(userId, p);
  void p.finally(() => { if (lookups.get(userId) === p) lookups.delete(userId); });
  // Shared across concurrent requests: keep it alive even if the request that started it ends.
  scheduleBackground(async () => { await p; });
  return p;
}

/**
 * Put a user on the list — call it BEFORE deleting or disabling the account.
 * ok:false → the caller must NOT go on: the person's still-valid tokens would
 * keep passing after the delete. stored:false → this environment has no D1, so
 * no verifier here can take the local path for that user either (it falls back
 * to Supabase, which refuses a deleted account by itself).
 */
export async function revokeUserTokens(
  userId: string,
  reason: string,
): Promise<{ ok: true; stored: boolean } | { ok: false; error: string }> {
  if (!userId) return { ok: false, error: "no user id" };
  let db: D1Runner | null;
  try { db = await getD1(); } catch (e) { return { ok: false, error: message(e) }; }
  if (!db) {
    remember(userId, true);
    return { ok: true, stored: false };
  }
  try {
    await db.run(DDL);
    await db.run(
      `INSERT INTO ${TABLE} (user_id, revoked_at, reason) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET revoked_at = excluded.revoked_at, reason = excluded.reason`,
      [userId, new Date().toISOString(), reason.slice(0, 80)],
    );
  } catch (e) {
    return { ok: false, error: message(e) };
  }
  remember(userId, true);
  return { ok: true, stored: true };
}

/** Tests: forget everything this isolate remembered. */
export function resetRevokedCacheForTests(): void {
  clearUntil.clear();
  listed.clear();
  lookups.clear();
}
