/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { servicePlan, type ServicePlan } from "@/lib/dataBackend";

const url  = process.env.NEXT_PUBLIC_SUPABASE_URL  ?? "https://placeholder.supabase.co";
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "placeholder";

// ─── Browser / server-component client (anon key, respects RLS) ──────────────
// Single shared instance — safe to use in any React Server Component or
// client component. Never bypasses Row-Level Security.
export const supabase = createClient(url, anon);

// ─── Service-role client (bypasses RLS) ──────────────────────────────────────
// Server-side API routes only. Never import this in client components.
// Cached singleton so we don't recreate it on every request.
//
// NOTE: typed as any because we don't have a generated Supabase schema file.
// To add strict typing: run `supabase gen types typescript > types/supabase.ts`
// and replace `any` with the generated Database type.
// ─── Which database answers (Supabase → D1 migration) ─────────────────────────
// Three server-side vars decide what the service client's fetch is
// (lib/dataBackend.ts servicePlan(), composed in lib/d1/serviceFetch.ts):
//
//   DATA_BACKEND="d1"       D1 answers every /rest/v1 read, write and RPC, and
//                           each successful write is journaled for rollback.
//                           Auth, storage and realtime keep going to Supabase.
//   SHADOW_D1_RATE="0.25"   (Supabase backend only) that share of READS is also
//                           replayed against D1 after the response and compared.
//   MAINTENANCE_WRITES="1"  data + storage writes are refused (the final copy).
//
// All at their defaults → servicePlan() is null → plain fetch, byte-for-byte the
// client the site has always had. Loaded dynamically and gated on `window` so no
// part of the adapter, and no server-only import it pulls in, can reach the
// browser bundle. getAnonVerifyClient / getAuthSchemaClient below never take
// this fetch: logins stay on Supabase.
//
// Why a `typeof window` ternary and not only the runtime check in servicePlan():
// Next's compiler folds `typeof window` to a constant ("object" in client
// bundles) before webpack looks for imports, so in the browser build this is
// `null` and the import() is never seen — the adapter, the write journal and
// d1/types.json (every table and column name) get no public static chunk. A
// runtime-only guard still made webpack emit that chunk: 146 KB that no browser
// requested but anyone holding its URL could download.
const loadServiceFetch = typeof window === "undefined" ? () => import("@/lib/d1/serviceFetch") : null;

let _serviceFetch: Promise<typeof fetch> | null = null;
function serviceFetch(): typeof fetch | undefined {
  const plan = servicePlan();
  if (!plan || !loadServiceFetch) return undefined;
  const load = loadServiceFetch;
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    _serviceFetch ??= load()
      .then((m) => m.buildServiceFetch(plan, { base: fetch }))
      .catch((err) => adapterUnavailable(plan, err));
    return _serviceFetch.then((f) => f(input as RequestInfo, init));
  }) as typeof fetch;
}

/**
 * The composition could not be loaded at all.
 *
 * On the Supabase backend that only costs a testing aid (shadow reads) or the
 * second layer of the freeze (middleware still holds the first), so fall back
 * to the plain fetch — neither may take the portal's reads down with it.
 *
 * On D1 a silent fallback would be split-brain: this isolate writing Supabase
 * while the others write D1. Refuse data requests instead, loudly, and let auth
 * and storage through.
 */
function adapterUnavailable(plan: ServicePlan, err: unknown): typeof fetch {
  if (plan.backend !== "d1") return fetch;
  console.error("[d1-backend] adapter failed to load; refusing data requests:", err instanceof Error ? err.message : String(err));
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!/\/rest\/v1\//.test(u)) return fetch(input as RequestInfo, init);
    return Promise.resolve(new Response(
      JSON.stringify({ code: "PGRST000", details: "d1-backend: adapter unavailable", hint: null, message: "Could not connect with the database" }),
      { status: 503, headers: { "content-type": "application/json; charset=utf-8" } },
    ));
  }) as typeof fetch;
}

/* ═══════════════════════════════ STORAGE HOOK ═══════════════════════════════
 * Where FILES move to R2 (STORAGE_BACKEND="r2"; see lib/storage/withR2Storage.ts
 * for the vars). It has to swap the storage CLIENT, not the fetch: storage-js
 * builds getPublicUrl() and the URL half of createSignedUrl() from the client's
 * base URL without any network call, so a fetch-only swap would keep handing out
 * supabase.co URLs for files that only exist in R2.
 *
 * Three rules this code is shaped by:
 *   • getPublicUrl() stays synchronous — the photo routes store its return value —
 *     so the swap happens here, at once, and only the fetch behind it is loaded
 *     later. That is why this is withR2Storage()'s swap written inline: this file
 *     may not statically import lib/storage (tests/dataBackendSwitch.test.ts).
 *   • Every storage module is reached only through loadStorage, which Next folds
 *     to `null` in the CLIENT compilation (typeof window) and the EDGE one
 *     (NEXT_RUNTIME). A dynamic import is still bundled into every compilation
 *     that can reach it: a first attempt without the NEXT_RUNTIME half broke
 *     cf:build — instrumentation.ts → reportError → telegram → here pulled the
 *     adapter into the edge build, where Node's `crypto` does not resolve.
 *   • The swapped client no longer passes through the service fetch, so the
 *     write freeze is applied to it again (withWriteFreeze, inside the loaded
 *     module) — a frozen upload is refused before R2 exactly as a table write is.
 * ═══════════════════════════════════════════════════════════════════════════ */
const loadStorage =
  typeof window !== "undefined" ? null
  : process.env.NEXT_RUNTIME === "edge" ? null
  : () => import("@/lib/storage/serviceStorage");

/** Where no loader exists (edge) the swapped client refuses, in storage-js's error shape. */
function storageUnreachable(): Response {
  return new Response(
    JSON.stringify({ statusCode: "500", error: "internal", message: "R2 storage is not reachable from this runtime", code: "InternalError" }),
    { status: 500, headers: { "content-type": "application/json; charset=utf-8" } },
  );
}

function composeStorage(client: SupabaseClient<any, any, any>): SupabaseClient<any, any, any> {
  // Exactly "r2", as in withR2Storage.ts r2StorageEnabled: a typo ("R2") must fail
  // toward Supabase, which holds every file today. The browser never gets it.
  if (typeof window !== "undefined" || process.env.STORAGE_BACKEND !== "r2") return client;

  const original = client.storage;
  const freeze = servicePlan()?.freeze === true;
  const load = loadStorage;
  let handler: Promise<typeof fetch> | null = null;
  const storageFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    // No loader (edge): refuse. Falling back to `original` would put a file in
    // Supabase that the R2 backend never gets.
    if (!load) return Promise.resolve(storageUnreachable());
    // A failed load rejects this call — storage-js hands it back as `error` —
    // and is forgotten, so one dropped chunk fetch does not disable files for
    // the life of the isolate.
    handler ??= load()
      .then((m) => m.buildServiceStorageFetch(original, { freeze }))
      .catch((err) => { handler = null; throw err; });
    return handler.then((f) => f(input as RequestInfo, init));
  }) as typeof fetch;

  // Read through a variable so Next never inlines a build-time value: same
  // lookup as withR2Storage.ts r2StorageBaseUrl (tests/storageBackendSwitch.test.ts
  // pins the two together).
  const env = process.env;
  const origin = (env.PUBLIC_BASE_URL || env.NEXT_PUBLIC_BASE_URL || "https://www.borivon.com").replace(/\/+$/, "");
  // Built from the existing instance's class (no direct @supabase/storage-js
  // dependency). No headers: nothing leaves the process, so the service-role key
  // has nowhere to go.
  const Ctor = original.constructor as new (url: string, headers: Record<string, string>, fetchImpl: typeof fetch) => typeof original;
  client.storage = new Ctor(`${origin}/api/storage/v1`, {}, storageFetch);
  return client;
}

let _serviceClient: SupabaseClient<any, any, any> | null = null;
export function getServiceSupabase(): SupabaseClient<any, any, any> {
  // Decided once per isolate: the vars only change with a deploy, and a deploy
  // is a fresh isolate.
  if (_serviceClient) return _serviceClient;
  const custom = serviceFetch();
  return (_serviceClient = composeStorage(createClient(
    url,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "placeholder",
    custom ? { global: { fetch: custom } } : undefined,
  )));
}

// ─── Anon JWT-verification client ────────────────────────────────────────────
// Used by requireUser / requireAdminRole to verify Bearer tokens server-side.
// No session persistence — lightweight, stateless, safe to reuse across requests.
let _anonVerifyClient: SupabaseClient<any, any, any> | null = null;
export function getAnonVerifyClient(): SupabaseClient<any, any, any> {
  return (_anonVerifyClient ??= createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  }));
}

// ─── Auth-schema client ───────────────────────────────────────────────────────
// Service-role client scoped to the `auth` schema.
// Only used for direct auth.users table lookups — faster than paginating listUsers.
let _authSchemaClient: SupabaseClient<any, any, any> | null = null;
export function getAuthSchemaClient(): SupabaseClient<any, any, any> {
  return (_authSchemaClient ??= createClient(
    url,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "placeholder",
    { db: { schema: "auth" } },
  ));
}
