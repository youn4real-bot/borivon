/**
 * Soft-deleted auth account detection — the SINGLE source of truth.
 *
 * If a hard delete is ever blocked by an unmapped FK, delete-user used to
 * ban + scramble the account (email → deleted+<uuid>@borivon.invalid,
 * user_metadata.deleted = true). Such a "ghost" must NEVER surface in ANY
 * admin-facing list (Users panel, candidate dossier list, messages, …).
 * Every list that enumerates auth users runs each row through this so a
 * deleted person is gone everywhere, even if the auth row itself lingers.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isSoftDeletedAuthUser(u: any): boolean {
  if (!u) return false;
  if (u.user_metadata?.deleted === true) return true;
  if (u.raw_user_meta_data?.deleted === true) return true;
  const email = (u.email ?? "").toLowerCase();
  if (/^deleted\+.*@borivon\.invalid$/.test(email)) return true;
  const b = u.banned_until ? Date.parse(u.banned_until) : 0;
  return Number.isFinite(b) && b > Date.now();
}
