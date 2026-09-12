/**
 * The database FUNCTIONS the portal calls, re-expressed for D1.
 *
 * `db.rpc("name", args)` is a POST to /rest/v1/rpc/<name>, and Postgres runs a
 * stored function. SQLite has no stored functions, so each one the codebase
 * actually calls is implemented here — as a SINGLE statement, because that is
 * the only atomicity D1 offers (no interactive transactions), and atomicity is
 * the whole reason these exist rather than being written in TypeScript.
 *
 * Five call sites, five functions (see supabase/rate_limits_prune.sql,
 * supabase/upload_links_claim_rpc.sql, supabase/hard_delete_user.sql,
 * supabase/admin_force_logout.sql):
 *
 *   rl_hit               shared rate limiter          → implemented
 *   claim_upload_key     one-time upload link claim   → implemented
 *   release_upload_key   roll back a failed claim     → implemented
 *   app_delete_user      hard-delete incl. auth.users → auth phase
 *   admin_force_logout   revoke auth sessions         → auth phase
 *
 * The last two reach into Supabase's `auth` schema, which the copy does not
 * hold, so they answer with PostgREST's own "function not found" — the same
 * thing a missing migration produces, which the call sites already handle.
 * They must be implemented with the auth move, not faked here.
 */
import type { PostgrestError } from "@/lib/d1/pgrest/types";
import type { D1Runner } from "@/lib/d1/client";

/** PostgREST's answer for a function it cannot find. */
export function rpcNotFound(name: string): PostgrestError {
  return {
    code: "PGRST202",
    message: `Could not find the function public.${name} in the schema cache`,
    details: null,
    hint: null,
    status: 404,
  };
}

function badArgs(name: string, why: string): PostgrestError {
  return { code: "PGRST203", message: `${name}: ${why}`, details: null, hint: null, status: 400 };
}

/** Is this URL an RPC call, and for which function? */
export function rpcName(url: string): string | null {
  const m = url.match(/\/rest\/v1\/rpc\/([A-Za-z0-9_]+)/);
  return m ? m[1] : null;
}

type Args = Record<string, unknown>;
type RpcOutcome = { body: unknown; status: number } | PostgrestError;

export function isRpcError(x: RpcOutcome): x is PostgrestError {
  return typeof (x as PostgrestError).code === "string" && typeof (x as PostgrestError).status === "number";
}

/**
 * One window bucket per key, incremented atomically.
 *
 * Postgres: INSERT … ON CONFLICT DO UPDATE SET count = count + 1 RETURNING
 * count. SQLite's UPSERT is the same statement, and D1 supports RETURNING, so
 * the counter stays exact under concurrency — which matters, because a limiter
 * that loses increments is a limiter that does not limit.
 */
async function rlHit(args: Args, run: D1Runner["run"]): Promise<RpcOutcome> {
  const key = String(args.p_key ?? "");
  const windowMs = Number(args.p_window_ms ?? 0);
  const nowMs = Number(args.p_now_ms ?? Date.now());
  if (!key || !Number.isFinite(windowMs) || windowMs <= 0) return badArgs("rl_hit", "p_key and a positive p_window_ms are required");

  const windowStart = Math.floor(nowMs / windowMs) * windowMs;

  // The same opportunistic GC the Postgres function does — keeps the table
  // flat without a scheduled job. Failure here is irrelevant to the caller.
  if (Math.random() < 0.001) {
    try { await run(`DELETE FROM "rate_limits" WHERE "window_start" < ?`, [nowMs - 172_800_000]); } catch { /* best effort */ }
  }

  const answer = await run(
    `INSERT INTO "rate_limits" ("bucket_key", "window_start", "count") VALUES (?, ?, 1)
       ON CONFLICT ("bucket_key", "window_start") DO UPDATE SET "count" = "count" + 1
     RETURNING "count"`,
    [key, windowStart],
  );
  const count = Number(Object.values(answer.results[0] ?? {})[0] ?? 0);
  // A table-returning function answers as an array of rows.
  return { body: [{ new_count: count, reset_ms: windowStart + windowMs }], status: 200 };
}

/**
 * Append one key to a live link's uploaded_keys, or do nothing.
 *
 * The guard is the point: two tiles tapped in quick succession must not read
 * the same array and clobber each other. Postgres appends inside the UPDATE;
 * here json_each does the same work in the same single statement. text[] is
 * stored as a JSON array (d1/gen-schema.mjs), so the value type matches what
 * every other read of this column already expects.
 *
 * Returns the NEW array, or null when nothing was claimed — the call site
 * reads null as "already uploaded".
 */
async function claimUploadKey(args: Args, run: D1Runner["run"]): Promise<RpcOutcome> {
  const linkId = String(args.p_link_id ?? "");
  const key = String(args.p_key ?? "");
  if (!linkId || !key) return badArgs("claim_upload_key", "p_link_id and p_key are required");

  const answer = await run(
    `UPDATE "upload_links"
        SET "uploaded_keys" = (
              SELECT json_group_array(v) FROM (
                SELECT "value" AS v FROM json_each(COALESCE("upload_links"."uploaded_keys", '[]'))
                UNION SELECT ?
              )
            )
      WHERE "id" = ?
        AND "used_at" IS NULL
        AND "revoked_at" IS NULL
        AND NOT EXISTS (
              SELECT 1 FROM json_each(COALESCE("upload_links"."uploaded_keys", '[]')) WHERE "value" = ?
            )
      RETURNING "uploaded_keys"`,
    [key, linkId, key],
  );
  const raw = answer.results[0] ? Object.values(answer.results[0])[0] : null;
  if (raw == null) return { body: null, status: 200 };           // 0 rows → claimed already, or link closed
  try {
    return { body: JSON.parse(String(raw)), status: 200 };        // text[] → a JSON array, as PostgREST returns it
  } catch {
    return { body: null, status: 200 };
  }
}

/** Remove one key after a failed upload — never a whole-array reset. */
async function releaseUploadKey(args: Args, run: D1Runner["run"]): Promise<RpcOutcome> {
  const linkId = String(args.p_link_id ?? "");
  const key = String(args.p_key ?? "");
  if (!linkId || !key) return badArgs("release_upload_key", "p_link_id and p_key are required");

  await run(
    `UPDATE "upload_links"
        SET "uploaded_keys" = (
              SELECT json_group_array("value") FROM json_each(COALESCE("upload_links"."uploaded_keys", '[]')) WHERE "value" <> ?
            )
      WHERE "id" = ?`,
    [key, linkId],
  );
  return { body: null, status: 204 };                             // returns void
}

const IMPLEMENTED: Record<string, (args: Args, run: D1Runner["run"]) => Promise<RpcOutcome>> = {
  rl_hit: rlHit,
  claim_upload_key: claimUploadKey,
  release_upload_key: releaseUploadKey,
};

/** Run one RPC, or say the function isn't there. */
export async function callRpc(name: string, args: Args, run: D1Runner["run"]): Promise<RpcOutcome> {
  const fn = IMPLEMENTED[name];
  if (!fn) return rpcNotFound(name);
  return fn(args, run);
}
