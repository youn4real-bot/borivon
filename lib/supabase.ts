import { createClient, SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://placeholder.supabase.co";
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "placeholder";

// Single client instance — works in browser and server components
export const supabase = createClient(url, anon);

// Service role client — server-side API routes only, bypasses RLS
// Cached singleton so we don't recreate it on every request
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _serviceClient: SupabaseClient<any, any, any> | null = null;
export function getServiceSupabase(): SupabaseClient<any, any, any> {
  return (_serviceClient ??= createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY ?? "placeholder"));
}
