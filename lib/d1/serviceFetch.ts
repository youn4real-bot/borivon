/**
 * The service client's fetch, composed from the flags (see lib/dataBackend.ts).
 *
 * Outermost first:
 *
 *   write freeze      MAINTENANCE_WRITES="1" — refuse data/storage writes      (either backend)
 *   write journal     every successful mutation appended to _write_journal     (d1 only)
 *   bvFetch           D1 answers /rest/v1 tables + RPC; everything else passes (d1 only)
 *   shadow reads      a sample of reads replayed against D1 and compared       (supabase only)
 *   fetch             Supabase: auth, realtime, storage, and data on "supabase"
 *
 * Files are NOT composed here: the R2 storage branch swaps the whole storage
 * CLIENT (its getPublicUrl/createSignedUrl build URLs without any fetch), so it
 * plugs in at the client — see composeStorage() in lib/supabase.ts.
 *
 * Loaded dynamically by lib/supabase.ts, server-side only, so none of this can
 * reach the browser bundle.
 */
import { makeBvFetch, isPostgrestUrl } from "@/lib/d1/bvFetch";
import { withShadowReads } from "@/lib/d1/shadow";
import { withWriteJournal, EPHEMERAL_RPCS, type JournalOptions } from "@/lib/d1/writeJournal";
import { isMutatingMethod } from "@/lib/maintenance";
import type { ServicePlan } from "@/lib/dataBackend";
import type { D1Runner } from "@/lib/d1/client";

function urlOf(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  return (init?.method ?? (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET")).toUpperCase();
}

/**
 * RPCs that only touch Supabase's `auth` schema, so they are LOGIN operations
 * wearing a PostgREST URL. admin_force_logout is `delete from auth.sessions` and
 * nothing else (supabase/admin_force_logout.sql). Logins stay on Supabase for
 * this whole migration, so on "d1" it must still reach Supabase: D1 has no auth
 * schema and answers PGRST202, and reset-password logs that as "non-fatal" —
 * an admin resetting a compromised account would leave every stolen session and
 * refresh token alive. They are not data: never journaled, never frozen.
 *
 * app_delete_user is deliberately NOT here: it deletes public rows too, and
 * delete-user/route.ts already falls back to the D1 row sweep plus
 * auth.admin.deleteUser when D1 answers PGRST202.
 */
export const AUTH_RPCS = new Set(["admin_force_logout"]);

export function isAuthRpc(url: string): boolean {
  let pathname: string;
  try { pathname = new URL(url, "http://auth-rpc.invalid").pathname; } catch { return false; }
  const rpc = pathname.match(/\/rest\/v1\/rpc\/([A-Za-z0-9_]+)$/);
  return !!rpc && AUTH_RPCS.has(rpc[1]);
}

/** Auth-only RPCs to Supabase; every other request to the data backend. */
export function routeAuthRpcs(supabase: typeof fetch, data: typeof fetch): typeof fetch {
  return function authRpcRouter(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    return isAuthRpc(urlOf(input)) ? supabase(input as RequestInfo, init) : data(input as RequestInfo, init);
  } as typeof fetch;
}

/**
 * Is this service-client request a WRITE the final copy would miss?
 *
 *   /rest/v1  any mutation, including RPCs — except rl_hit (ephemeral, not copied)
 *             and the auth-only RPCs (AUTH_RPCS: logins are not part of the copy).
 *   /storage/v1  any mutation — except the POSTs that only READ: list, list-v2 and
 *             sign (a download URL). Blocking those would break every document
 *             preview for the ten minutes of the freeze, for no safety gained.
 *   anything else (auth, realtime broadcast): not part of the copy — auth stays
 *             on Supabase through this whole migration.
 */
export function isFrozenWrite(method: string, url: string): boolean {
  if (!isMutatingMethod(method)) return false;
  let pathname: string;
  try { pathname = new URL(url, "http://freeze.invalid").pathname; } catch { return false; }
  if (/\/rest\/v1\//.test(pathname)) {
    const rpc = pathname.match(/\/rest\/v1\/rpc\/([A-Za-z0-9_]+)/);
    return !(rpc && (EPHEMERAL_RPCS.has(rpc[1]) || AUTH_RPCS.has(rpc[1])));
  }
  if (/\/storage\/v1\//.test(pathname)) {
    return !/\/storage\/v1\/object\/(list|list-v2|sign)\//.test(pathname);
  }
  return false;
}

/**
 * The refusal, in the shape each client parses: supabase-js reads a PostgREST
 * error body `{code, details, hint, message}` straight into `error`; storage-js
 * reads `message`/`statusCode`. 25006 is Postgres' own "read-only transaction"
 * code — the honest description of the state, and it matches none of the codes
 * call sites branch on (23505, 42703, PGRST116…), so it takes their generic
 * error path rather than being mistaken for "already exists" or "not found".
 */
export function frozenResponse(url: string): Response {
  const storage = /\/storage\/v1\//.test(url);
  const body = storage
    ? { statusCode: "503", error: "Service Unavailable", message: "writes are paused for maintenance (MAINTENANCE_WRITES)" }
    : { code: "25006", details: null, hint: "MAINTENANCE_WRITES is on", message: "cannot execute write: writes are paused for maintenance" };
  return new Response(JSON.stringify(body), {
    status: 503,
    statusText: "Service Unavailable",
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function withWriteFreeze(next: typeof fetch): typeof fetch {
  return async function freezingFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = urlOf(input);
    if (isFrozenWrite(methodOf(input, init), url)) {
      console.warn(`[write-freeze] refused ${methodOf(input, init)} ${new URL(url, "http://x").pathname.replace(/^.*\/(rest|storage)\/v1\//, "$1/")}`);
      return frozenResponse(url);
    }
    return next(input as RequestInfo, init);
  } as typeof fetch;
}

/**
 * bvFetch hands a PostgREST request to its passthrough when this runtime has no
 * D1 (its safe choice while D1 was only a shadow). Once D1 IS the backend that
 * fallback is split-brain: some isolates writing Supabase, others D1, and a
 * rollback replay that cannot know about the first kind. So on "d1" a data
 * request with no D1 FAILS CLOSED with PostgREST's own "database unreachable"
 * answer, loudly; auth/storage/realtime still pass through.
 */
export function failClosedForData(base: typeof fetch): typeof fetch {
  return async function failClosed(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = urlOf(input);
    if (!isPostgrestUrl(url)) return base(input as RequestInfo, init);
    console.error("[d1-backend] DATA REQUEST REFUSED: DATA_BACKEND=d1 but no D1 is reachable from this runtime");
    return new Response(JSON.stringify({
      code: "PGRST000",
      details: "d1-backend: the D1 database is not reachable from this runtime",
      hint: null,
      message: "Could not connect with the database",
    }), { status: 503, statusText: "Service Unavailable", headers: { "content-type": "application/json; charset=utf-8" } });
  } as typeof fetch;
}

export type ServiceFetchDeps = {
  /** The real network fetch (Supabase). */
  base: typeof fetch;
  /** Tests inject a D1 runner; production resolves the binding per request. */
  runner?: D1Runner;
  /** Journal options, or false to leave it out (tests of the bare switch). */
  journal?: JournalOptions | false;
};

export function buildServiceFetch(plan: ServicePlan, deps: ServiceFetchDeps): typeof fetch {
  let f: typeof fetch;
  if (plan.backend === "d1") {
    f = makeBvFetch({ runner: deps.runner, passthrough: failClosedForData(deps.base) });
    if (deps.journal !== false) {
      const runner = deps.runner;
      f = withWriteJournal(f, { ...(deps.journal ?? {}), runner: deps.journal?.runner ?? (runner ? async () => runner : undefined) });
    }
    // Outside the journal: an auth RPC is not a data write a rollback replays.
    f = routeAuthRpcs(deps.base, f);
  } else {
    f = plan.shadow ? withShadowReads(deps.base) : deps.base;
  }
  return plan.freeze ? withWriteFreeze(f) : f;
}
