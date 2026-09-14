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
let _serviceFetch: Promise<typeof fetch> | null = null;
function serviceFetch(): typeof fetch | undefined {
  const plan = servicePlan();
  if (!plan) return undefined;
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    _serviceFetch ??= import("@/lib/d1/serviceFetch")
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

let _serviceClient: SupabaseClient<any, any, any> | null = null;
export function getServiceSupabase(): SupabaseClient<any, any, any> {
  // Decided once per isolate: the vars only change with a deploy, and a deploy
  // is a fresh isolate.
  const custom = serviceFetch();
  return (_serviceClient ??= createClient(
    url,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "placeholder",
    custom ? { global: { fetch: custom } } : undefined,
  ));
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
