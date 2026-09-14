/**
 * The switch for "files from R2 instead of Supabase Storage".
 *
 * Why the storage CLIENT is swapped, not just the fetch: two storage-js calls
 * never touch the network. getPublicUrl() and the URL half of createSignedUrl()
 * are string-built from the client's storage base URL — <supabase-url>/storage/v1.
 * A fetch-only swap would keep returning supabase.co URLs: a photo uploaded
 * after the switch exists only in R2, so its stored URL would 404, and a signed
 * URL would carry our token to Supabase, which cannot check it — every
 * sign-request preview would break. Re-creating the storage client on OUR base
 * URL makes both produce
 *   https://www.borivon.com/api/storage/v1/object/public/<bucket>/<path>
 *   https://www.borivon.com/api/storage/v1/object/sign/<bucket>/<path>?token=…
 * which the two app routes under app/api/storage/v1/object/ serve from R2. The
 * layout mirrors Supabase's on purpose: rewriting a stored supabase.co photo
 * URL later is a pure prefix swap.
 *
 * That is also why this is NOT meant for lib/d1/serviceFetch.ts's
 * STORAGE_HANDLER hook on its own: a fetch layer there answers the operations
 * but leaves both URL builders on supabase.co.
 *
 * OFF unless STORAGE_BACKEND is exactly "r2". Wiring (for the orchestrator, in
 * lib/supabase.ts getServiceSupabase):
 *   withR2Storage(createClient(...))                       // or, with the write freeze:
 *   withR2Storage(createClient(...), { wrap: withWriteFreeze })
 * Rollback = unset STORAGE_BACKEND. STORAGE_MEDIA_ROUTES=on keeps the two
 * serving routes alive during a rollback, so photo URLs written while R2 was
 * active keep loading.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { makeR2StorageFetch, type R2StorageOptions } from "@/lib/storage/r2StorageFetch";

type Fetch = typeof globalThis.fetch;
type StorageClientLike = SupabaseClient["storage"];
type StorageClientCtor = new (url: string, headers?: Record<string, string>, fetchImpl?: Fetch) => StorageClientLike;

type Env = Record<string, string | undefined>;

/**
 * storage calls go to R2. Anything but exactly "r2" is Supabase: a typo ("R2",
 * "r2 ") must fail toward the backend that holds every file today, never toward
 * a half-configured new one — same rule as DATA_BACKEND.
 */
export function r2StorageEnabled(env: Env = process.env): boolean {
  return env.STORAGE_BACKEND === "r2";
}

/** the public / signed serving routes answer (else they 404, exactly as before they existed) */
export function r2MediaRoutesEnabled(env: Env = process.env): boolean {
  return r2StorageEnabled(env) || env.STORAGE_MEDIA_ROUTES === "on";
}

/** Base URL the swapped storage client builds public and signed URLs on. Same env the bot's BASE_URL reads. */
export function r2StorageBaseUrl(env: Env = process.env): string {
  const origin = (env.PUBLIC_BASE_URL || env.NEXT_PUBLIC_BASE_URL || "https://www.borivon.com").replace(/\/+$/, "");
  return `${origin}/api/storage/v1`;
}

/**
 * The swapped client must never put a storage request on the network. Its base
 * URL is our own domain, and only two GET routes live there — an upload that
 * slipped past the R2 handler would 404 against our site instead of failing
 * loudly here. The handler answers every /storage/v1 path itself, so reaching
 * this means something unexpected; refuse in storage-js's error shape.
 */
const refuseNetwork: Fetch = async () =>
  new Response(
    JSON.stringify({ statusCode: "500", error: "internal", message: "R2 storage adapter: request is not a storage URL", code: "InternalError" }),
    { status: 500, headers: { "content-type": "application/json; charset=utf-8" } },
  );

export type WithR2StorageOptions = R2StorageOptions & {
  /** Tests only: ignore STORAGE_BACKEND. */
  force?: boolean;
  /** Tests only: build URLs on this base instead of PUBLIC_BASE_URL. */
  baseUrl?: string;
  /**
   * Wrap the storage fetch, outermost — e.g. the maintenance write freeze
   * (lib/d1/serviceFetch.ts withWriteFreeze), so a frozen upload is refused
   * before it reaches R2 exactly as a frozen table write is.
   */
  wrap?: (next: Fetch) => Fetch;
};

/**
 * Give `client` an R2-backed storage client when the flag is on; otherwise
 * return it untouched. Server-only — the browser never holds the service client.
 */
export function withR2Storage<C extends { storage: StorageClientLike }>(client: C, opts: WithR2StorageOptions = {}): C {
  if (typeof window !== "undefined") return client;
  if (!opts.force && !r2StorageEnabled()) return client;
  const { force: _force, baseUrl, wrap, ...storageOpts } = opts;
  void _force;
  const handler = makeR2StorageFetch({ ...storageOpts, passthrough: storageOpts.passthrough ?? refuseNetwork });
  // Built from the existing instance's class, so no direct dependency on
  // @supabase/storage-js (a transitive package) is needed. No headers: nothing
  // leaves the process, so the service-role key has nowhere to go.
  const Ctor = client.storage.constructor as StorageClientCtor;
  client.storage = new Ctor(baseUrl ?? r2StorageBaseUrl(), {}, wrap ? wrap(handler) : handler);
  return client;
}
