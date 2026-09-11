/**
 * "Delete means gone" — the bytes too.
 *
 * app_delete_user (supabase/hard_delete_user.sql) removes every ROW that points
 * at a user, but storage objects are not reachable by a DB cascade. Without this
 * sweep a deleted person's passport stays in R2, their CV preview and legacy
 * doc-cache copies stay in `sign-documents`, and their avatar + feed images stay
 * downloadable from the PUBLIC `profile-photos` / `feed-photos` buckets.
 *
 * Two phases because the object paths are derived FROM the rows the delete
 * removes: collect first (while the rows exist), remove after. Every step is
 * best-effort — one failed object must never abort an account deletion.
 *
 * Shared by the website's delete-user route and the bot's deleteCandidateAccount
 * so the two paths can never drift apart again.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { r2List, r2Delete } from "@/lib/r2";

export type UserStoragePlan = {
  /** `sign-documents` bucket: sign_request PDFs, doc-cache/<drive_file_id>, cv-preview/<userId>.pdf */
  signDocPaths: string[];
  /** R2 object keys: every documents.r2_key + everything under candidates/<userId>/ */
  r2Keys: string[];
  /** `feed-photos` bucket (PUBLIC): <postId>.<ext> for the user's posts */
  feedPhotoPaths: string[];
  /** `profile-photos` bucket (PUBLIC): <userId>.<ext> */
  profilePhotoPaths: string[];
};

const IMAGE_EXTS = ["jpg", "png", "webp", "gif"];
const LOG = "[deleteUserStorage]";

/** Gather every storage path owned by this user. Call BEFORE the rows are deleted. */
export async function collectUserStorage(db: SupabaseClient, userId: string): Promise<UserStoragePlan> {
  const signDocPaths: string[] = [`cv-preview/${userId}.pdf`];
  const r2Keys: string[] = [];
  const feedPhotoPaths: string[] = [];
  const profilePhotoPaths = IMAGE_EXTS.map((ext) => `${userId}.${ext}`);

  // sign_requests PDFs — the rows cascade away, the blobs don't.
  try {
    const { data, error } = await db
      .from("sign_requests")
      .select("pdf_storage_path, signed_pdf_path")
      .eq("candidate_user_id", userId);
    if (error) console.warn(LOG, "sign_requests:", error.message);
    for (const r of (data ?? []) as { pdf_storage_path: string | null; signed_pdf_path: string | null }[]) {
      if (r.pdf_storage_path) signDocPaths.push(r.pdf_storage_path);
      if (r.signed_pdf_path) signDocPaths.push(r.signed_pdf_path);
    }
  } catch (e) { console.warn(LOG, "sign_requests threw:", e instanceof Error ? e.message : e); }

  // Documents (live AND superseded): the R2 bytes + the legacy Drive-era
  // doc-cache/<drive_file_id> mirror the file proxy can still serve.
  try {
    const { data, error } = await db
      .from("documents")
      .select("r2_key, drive_file_id")
      .eq("user_id", userId);
    if (error) console.warn(LOG, "documents:", error.message);
    const rows = (data ?? []) as { r2_key: string | null; drive_file_id: string | null }[];
    let keys = [...new Set(rows.map((r) => r.r2_key).filter(Boolean) as string[])];
    let driveIds = [...new Set(rows.map((r) => r.drive_file_id).filter(Boolean) as string[])];

    // Never delete bytes ANOTHER user's row still points at (e.g. one bot chat
    // upload stored for two candidates). If that check can't run, fall back to
    // what is unambiguously this user's: their own R2 prefix only.
    const own = `candidates/${userId}/`;
    const sharedR2 = await referencedByOthers(db, userId, "r2_key", keys);
    const sharedDrive = await referencedByOthers(db, userId, "drive_file_id", driveIds);
    keys = sharedR2 ? keys.filter((k) => !sharedR2.has(k)) : keys.filter((k) => k.startsWith(own));
    driveIds = sharedDrive ? driveIds.filter((id) => !sharedDrive.has(id)) : [];

    r2Keys.push(...keys);
    for (const id of driveIds) signDocPaths.push(`doc-cache/${id}`);
  } catch (e) { console.warn(LOG, "documents threw:", e instanceof Error ? e.message : e); }

  // Anything under the candidate's own prefix — catches an archived copy whose
  // row was already removed. Listing is a bonus; the row-derived keys are the guarantee.
  try {
    for (const o of await r2List(`candidates/${userId}/`)) if (o.key) r2Keys.push(o.key);
  } catch (e) { console.warn(LOG, "r2 list threw:", e instanceof Error ? e.message : e); }

  // Feed post images — feed_posts rows cascade, the PUBLIC images don't.
  try {
    const { data, error } = await db.from("feed_posts").select("id").eq("user_id", userId);
    if (error) console.warn(LOG, "feed_posts:", error.message);
    for (const p of (data ?? []) as { id: string }[]) {
      for (const ext of IMAGE_EXTS) feedPhotoPaths.push(`${p.id}.${ext}`);
    }
  } catch (e) { console.warn(LOG, "feed_posts threw:", e instanceof Error ? e.message : e); }

  return {
    signDocPaths: [...new Set(signDocPaths)],
    r2Keys: [...new Set(r2Keys)],
    feedPhotoPaths,
    profilePhotoPaths,
  };
}

/** Delete everything a plan names. Best-effort; never throws. */
export async function removeUserStorage(db: SupabaseClient, plan: UserStoragePlan): Promise<void> {
  await removeFromBucket(db, "sign-documents", plan.signDocPaths);
  await removeFromBucket(db, "feed-photos", plan.feedPhotoPaths);
  await removeFromBucket(db, "profile-photos", plan.profilePhotoPaths);
  for (const k of plan.r2Keys) {
    try { await r2Delete(k); } catch (e) { console.warn(LOG, "r2 delete failed for", k, e instanceof Error ? e.message : e); }
  }
}

/** Collect + remove in one go — for callers that sweep before the row delete. */
export async function deleteUserStorage(db: SupabaseClient, userId: string): Promise<void> {
  await removeUserStorage(db, await collectUserStorage(db, userId));
}

/** Values in `values` that some OTHER user's documents row references. Null = the check failed. */
async function referencedByOthers(
  db: SupabaseClient, userId: string, col: "r2_key" | "drive_file_id", values: string[],
): Promise<Set<string> | null> {
  const out = new Set<string>();
  for (let i = 0; i < values.length; i += 100) {
    const { data, error } = await db.from("documents").select(col).in(col, values.slice(i, i + 100)).neq("user_id", userId);
    if (error) { console.warn(LOG, `shared ${col} check:`, error.message); return null; }
    for (const r of (data ?? []) as Record<string, string | null>[]) if (r[col]) out.add(r[col] as string);
  }
  return out;
}

async function removeFromBucket(db: SupabaseClient, bucket: string, paths: string[]): Promise<void> {
  for (let i = 0; i < paths.length; i += 500) {
    try {
      const { error } = await db.storage.from(bucket).remove(paths.slice(i, i + 500));
      if (error) console.warn(LOG, `${bucket} remove:`, error.message);
    } catch (e) { console.warn(LOG, `${bucket} remove threw:`, e instanceof Error ? e.message : e); }
  }
}
