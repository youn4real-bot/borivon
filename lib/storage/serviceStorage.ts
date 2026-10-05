/**
 * The service client's R2 storage fetch — the lazily loaded half of the swap in
 * lib/supabase.ts composeStorage().
 *
 * The swap itself (a storage client on our own base URL) has to happen
 * synchronously inside lib/supabase.ts, or getPublicUrl() would stop being
 * synchronous and every profile/feed photo route would store a Promise. What it
 * sends requests to is built here, loaded on the first storage call, and only
 * ever through a loader Next compiles out of the client and edge bundles: this
 * file pulls in the adapter, the AWS SDK path of lib/r2.ts and the D1 service
 * fetch, none of which may reach a browser or the instrumentation/edge build.
 *
 * Outermost first:
 *   write freeze   MAINTENANCE_WRITES="1": uploads and removes refused before R2
 *                  (lib/d1/serviceFetch.ts withWriteFreeze — the same rule, the
 *                  same 503 body, as a frozen table write)
 *   R2 adapter     answers every /storage/v1 request (lib/storage/r2StorageFetch.ts)
 *   mirror         each upload/remove that succeeded on R2 repeated on Supabase
 *                  Storage through the ORIGINAL client, unless STORAGE_SUPABASE_MIRROR=off
 *   network        never: a request the adapter does not recognise is refused
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { makeR2StorageFetch, type R2StorageOptions } from "@/lib/storage/r2StorageFetch";
import { refuseNetwork, supabaseMirrorEnabled, supabaseStorageMirror } from "@/lib/storage/withR2Storage";
import { withWriteFreeze } from "@/lib/d1/serviceFetch";

type Env = Record<string, string | undefined>;

export type ServiceStorageOptions = {
  /** MAINTENANCE_WRITES is on (lib/dataBackend.ts servicePlan().freeze). */
  freeze: boolean;
  env?: Env;
  /** Tests only: the object store (production resolves R2 per runtime). */
  store?: R2StorageOptions["store"];
};

export function buildServiceStorageFetch(original: SupabaseClient["storage"], opts: ServiceStorageOptions): typeof fetch {
  const mirror = supabaseMirrorEnabled(opts.env) ? supabaseStorageMirror(original) : null;
  const r2 = makeR2StorageFetch({ store: opts.store, mirror, passthrough: refuseNetwork });
  return opts.freeze ? withWriteFreeze(r2) : r2;
}
