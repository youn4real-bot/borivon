/**
 * A FAILED READ IS NOT AN EMPTY LIST.
 *
 * The pattern this file exists to kill, found in a dozen GET handlers:
 *
 *     const { data } = await db.from("phase_slots").select("*")...;
 *     return NextResponse.json({ slots: (data ?? []) as PhaseSlot[] });
 *
 * The `error` half of the supabase-js result is destructured away, so a
 * connection blip, a statement timeout or a PostgREST 5xx becomes HTTP 200 with
 * an empty array. Proved on the live portal: one hiccup on the slot read and
 * every Bearbeitung and Visum box on a nurse's dashboard vanished behind a calm
 * "no documents yet" sentence. The client CANNOT tell empty from broken,
 * because on the wire they are the same response -- so no amount of client work
 * fixes it alone. The server has to stop lying first.
 *
 * THE CONTRACT every route in this codebase now follows:
 *
 *   200 + { slots: [] }            -- the read succeeded and there are none.
 *   503 + { error, code:"READ_FAILED" } -- the read failed; the answer is unknown,
 *                                  try again. NEVER an empty list.
 *
 * 503 rather than 500 on purpose: a transient database read is retryable, and
 * it keeps "the query broke" distinct from "the handler threw".
 *
 * THE ONE EXCEPTION -- a pending migration. The founder runs SQL by hand, so a
 * feature may legitimately reference a column that does not exist yet. CLAUDE.md
 * requires that to degrade gracefully rather than 500, so `isSchemaMissing()`
 * separates "this column/table was never created" (fall back, keep serving)
 * from "the read failed" (say so). Losing a nicety is fine; losing a lead is
 * not, and so is blanking a nurse's document list.
 */

export const READ_FAILED = "READ_FAILED";

type PgErr = { code?: string | null; message?: string | null } | null | undefined;

/**
 * Is this error "the schema has not been migrated yet" rather than a real
 * failure? Missing COLUMN: 42703 (Postgres) / PGRST204 (PostgREST). Missing
 * TABLE: 42P01 / PGRST205. PostgREST also answers a stale schema cache in
 * prose, which is why the message is matched too.
 */
export function isSchemaMissing(err: PgErr): boolean {
  if (!err) return false;
  const code = err.code ?? "";
  const msg = err.message ?? "";
  return code === "42703" || code === "42P01" || code === "PGRST204" || code === "PGRST205"
    || /does not exist|could not find the table|schema cache/i.test(msg);
}

/**
 * Should this route answer 503 instead of pretending the list is empty?
 * True for every error that is not a pending migration.
 */
export function isReadFailure(err: PgErr): boolean {
  return !!err && !isSchemaMissing(err);
}

/** The body + status a route returns when a read it cannot fake has failed. */
export function readFailureResponse(where: string, err: PgErr): {
  body: { error: string; code: string };
  status: 503;
} {
  // Logged with the call site so the Worker log names which read died -- the
  // previous code logged nothing at all, which is why this took a six-angle
  // hunt to find rather than one glance at the tail.
  console.error(`[${where}] read failed:`, err?.code ?? "", err?.message ?? String(err));
  return {
    body: { error: "Could not load right now. Please try again.", code: READ_FAILED },
    status: 503,
  };
}
