/**
 * Does `admin_notifications.doc_id` exist yet?
 *
 * THE COST OF ASKING EVERY TIME. doc_id is what lets a bell notification OPEN
 * the document instead of dropping the admin on the candidate; it arrives with
 * supabase/admin_notifications_doc_id.sql, which the founder runs by hand. The
 * two places that care each paid for that uncertainty on EVERY request:
 *
 *   - the bell's list route ran a separate `select doc_id limit 1` PROBE,
 *     sequentially, before its four real queries — so every poll and every tap
 *     that refreshes the feed carried a whole extra Supabase round trip whose
 *     answer never changes within a deployment;
 *   - the upload route's notification insert always tried WITH doc_id and
 *     retried without it on failure — two writes per upload whenever the
 *     column is not there.
 *
 * Neither is wrong, both are doomed to the same answer over and over. So the
 * answer is remembered per isolate: the first query that touches the column
 * teaches this module, and from then on the path that works is taken FIRST.
 *
 * Three states on purpose, and "unknown" leans towards trying:
 *   unknown  — nothing has told us yet. Ask for doc_id: if the migration HAS
 *              been run, we must use it, and the cost of being wrong is one
 *              retry, once, per isolate.
 *   present  — use it, with no probe in front.
 *   absent   — skip it, with no failed attempt in front. This is the fallback
 *              becoming the fast path.
 *
 * Per-isolate and in memory by design: a Worker isolate is short-lived, so a
 * migration run by hand is picked up within minutes by every new isolate with
 * no deploy, no cache to bust and nothing to clear. Nothing here is ever
 * persisted — a stale "absent" written to a table is how a shipped migration
 * would stay invisible.
 */

export type ColumnState = "unknown" | "present" | "absent";

let state: ColumnState = "unknown";

/** What this isolate currently believes. */
export function adminNotifDocIdState(): ColumnState {
  return state;
}

/**
 * Should this query/insert ask for doc_id?
 *
 * True unless we have already been told the column is missing — being wrong in
 * this direction costs one retry; being wrong the other way silently drops the
 * deep link the migration was run to enable.
 */
export function shouldUseAdminNotifDocId(): boolean {
  return state !== "absent";
}

/** A query that used doc_id succeeded: stop wondering. */
export function noteAdminNotifDocIdPresent(): void {
  state = "present";
}

/**
 * A query that used doc_id was refused BECAUSE of the column.
 *
 * Only ever called after isMissingColumnError() has agreed, so a network blip
 * or an RLS refusal can never be mistaken for "the migration is not run" and
 * turn the deep link off for the life of the isolate.
 */
export function noteAdminNotifDocIdMissing(): void {
  state = "absent";
}

/** Tests only — module state would otherwise leak between cases. */
export function resetAdminNotifDocIdState(): void {
  state = "unknown";
}

/**
 * Is this PostgREST error "that column is not there", as opposed to anything
 * else that can go wrong?
 *
 * 42703 is Postgres' own undefined_column; PGRST204 is PostgREST failing to
 * find it in its schema cache on a write payload. The message match is the
 * belt to that pair of braces, and mirrors the wording the D1 shim reproduces
 * on purpose (lib/d1/pgrest/errors.ts).
 */
export function isMissingColumnError(err: unknown, column = "doc_id"): boolean {
  if (!err) return false;
  const code = (err as { code?: string }).code ?? "";
  const message = (err as { message?: string }).message ?? "";
  if (code === "42703" || code === "PGRST204") return true;
  if (!message) return false;
  return (
    new RegExp(`\\b${column}\\b`, "i").test(message) &&
    /does not exist|schema cache|could not find/i.test(message)
  );
}

/**
 * Record what an attempt that USED doc_id just taught us, and say whether the
 * caller should now retry without it.
 *
 * One function so the two call sites cannot learn different lessons from the
 * same error — that divergence is how a "schema-tolerant" path quietly stops
 * being tolerant on one side only.
 */
export function learnFromDocIdAttempt(
  usedDocId: boolean,
  error: unknown,
): { retryWithoutDocId: boolean } {
  if (!usedDocId) return { retryWithoutDocId: false };
  if (!error) {
    noteAdminNotifDocIdPresent();
    return { retryWithoutDocId: false };
  }
  if (isMissingColumnError(error)) {
    noteAdminNotifDocIdMissing();
    return { retryWithoutDocId: true };
  }
  // Some other failure. Say nothing about the column: guessing "absent" here
  // would switch the deep link off until the isolate dies, for a reason that
  // has nothing to do with the schema.
  return { retryWithoutDocId: false };
}
