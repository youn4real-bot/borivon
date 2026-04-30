/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient, SupabaseClient } from "@supabase/supabase-js";

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
let _serviceClient: SupabaseClient<any, any, any> | null = null;
export function getServiceSupabase(): SupabaseClient<any, any, any> {
  return (_serviceClient ??= createClient(
    url,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "placeholder",
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
