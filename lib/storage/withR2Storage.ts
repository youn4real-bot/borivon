/**
 * The switch for "files from R2 instead of Supabase Storage".
 *
 * Why the storage CLIENT is swapped, not just the fetch: two storage-js calls
 * never touch the network. getPublicUrl() and the URL half of createSignedUrl()
 * are string-built from the client's storage base URL — <supabase-url>/storage/v1.
 * A fetch-only swap would keep returning supabase.co URLs, and a photo uploaded
 * after the switch exists only in R2, so its stored URL would 404. Re-creating
 * the storage client on OUR base URL makes both produce
 *   https://www.borivon.com/api/storage/v1/object/public/<bucket>/<path>
 *   https://www.borivon.com/api/storage/v1/object/sign/<bucket>/<path>?token=…
 * which the two app routes under app/api/storage/v1/object/ serve from R2. The
 * layout mirrors Supabase's on purpose: rewriting a stored supabase.co photo
 * URL later is a pure prefix swap.
 *
 * OFF unless STORAGE_BACKEND=r2. Wiring (for the orchestrator, in
 * lib/supabase.ts getServiceSupabase):  withR2Storage(createClient(...))
 * Rollback = unset STORAGE_BACKEND. STORAGE_MEDIA_ROUTES=on keeps the two
 * serving routes alive during a rollback, so photo URLs written while R2 was
 * active keep loading.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { makeR2StorageFetch, type R2StorageOptions } from "@/lib/storage/r2StorageFetch";

type StorageClientLike = SupabaseClient["storage"];
type StorageClientCtor = new (url: string, headers?: Record<string, string>, fetch?: typeof fetch) => StorageClientLike;

type Env = Record<string, string | undefined>;

const flag = (v: string | undefined) => (v ?? "").trim().toLowerCase();

/** storage calls go to R2 */
export function r2StorageEnabled(env: Env = process.env): boolean {
  return flag(env.STORAGE_BACKEND) === "r2";
}

/** the public / signed serving routes answer (else they 404, exactly as before they existed) */
export function r2MediaRoutesEnabled(env: Env = process.env): boolean {
  return r2StorageEnabled(env) || flag(env.STORAGE_MEDIA_ROUTES) === "on";
}

/** Base URL the swapped storage client builds public and signed URLs on. */
export function r2StorageBaseUrl(env: Env = process.env): string {
  const origin = (env.PUBLIC_BASE_URL || env.NEXT_PUBLIC_BASE_URL || "https://www.borivon.com").replace(/\/+$/, "");
  return `${origin}/api/storage/v1`;
}

/**
 * Give `client` an R2-backed storage client when the flag is on; otherwise
 * return it untouched. Server-only — the browser never holds the service client.
 * `force` exists for tests, which must not depend on the environment.
 */
export function withR2Storage<C extends { storage: StorageClientLike }>(
  client: C,
  opts: R2StorageOptions & { force?: boolean; baseUrl?: string } = {},
): C {
  if (typeof window !== "undefined") return client;
  if (!opts.force && !r2StorageEnabled()) return client;
  // Built from the existing instance's class, so no direct dependency on
  // @supabase/storage-js (a transitive package) is needed.
  const Ctor = client.storage.constructor as StorageClientCtor;
  client.storage = new Ctor(opts.baseUrl ?? r2StorageBaseUrl(), {}, makeR2StorageFetch(opts));
  return client;
}
