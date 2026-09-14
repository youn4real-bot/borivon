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
 * which the two app routes under app/api/storage/v1/object/ serve. The layout
 * mirrors Supabase's on purpose: rewriting a stored supabase.co photo URL later
 * is a pure prefix swap.
 *
 * That is also why this is NOT meant for lib/d1/serviceFetch.ts's
 * STORAGE_HANDLER hook on its own: a fetch layer there answers the operations
 * but leaves both URL builders on supabase.co.
 *
 * Supabase Storage is kept in step while it lives (see StorageMirror in
 * r2StorageFetch.ts): every upload and remove that succeeds on R2 is repeated
 * through the ORIGINAL storage client, so a delete really deletes and a
 * rollback finds every file written meanwhile.
 *
 * Safe to import from lib/supabase.ts, which is in the BROWSER bundle: this
 * file imports nothing at runtime. The handler (crypto, lib/r2, the AWS SDK)
 * is loaded on the first storage call, server-side only — a static import here
 * would ship all of that to every portal page (tests/r2Storage.test.ts guards it).
 *
 * The vars (wrangler.jsonc, never .env.local — OpenNext bakes that file in):
 *   STORAGE_BACKEND          unset   : Supabase, routes 404 — the site as it is today
 *                            "r2"    : R2 answers; routes serve from R2
 *                            "supabase": ROLLBACK — Supabase answers again; the
 *                                      routes stay up and redirect to Supabase,
 *                                      so URLs handed out while R2 was active
 *                                      keep working. One value to flip, either way.
 *   STORAGE_SUPABASE_MIRROR  "off" stops the mirror (only once Supabase Storage
 *                            is retired). Anything else mirrors: a typo keeps
 *                            Supabase in step, which costs latency, not files.
 *   STORAGE_MEDIA_ROUTES     "on" keeps the routes up with any backend value.
 *
 * Wiring (for the orchestrator, in lib/supabase.ts composeStorage):
 *   withR2Storage(client)                                   // or, with the write freeze:
 *   withR2Storage(client, { wrap: withWriteFreeze })
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { R2StorageOptions, StorageMirror } from "@/lib/storage/r2StorageFetch";

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

/**
 * The public / signed serving routes answer (else they 404, exactly as before
 * they existed). "supabase" is the explicit rollback value: URLs minted on our
 * domain while R2 was active are stored in rows (profile_photo, image_url), so
 * the routes must outlive the flip back.
 */
export function r2MediaRoutesEnabled(env: Env = process.env): boolean {
  return r2StorageEnabled(env) || env.STORAGE_BACKEND === "supabase" || env.STORAGE_MEDIA_ROUTES === "on";
}

/** Repeat R2 writes on Supabase Storage. Only an exact "off" stops it. */
export function supabaseMirrorEnabled(env: Env = process.env): boolean {
  return env.STORAGE_SUPABASE_MIRROR !== "off";
}

/** Base URL the swapped storage client builds public and signed URLs on. Same env the bot's BASE_URL reads. */
export function r2StorageBaseUrl(env: Env = process.env): string {
  const origin = (env.PUBLIC_BASE_URL || env.NEXT_PUBLIC_BASE_URL || "https://www.borivon.com").replace(/\/+$/, "");
  return `${origin}/api/storage/v1`;
}

/**
 * The mirror, through the storage client that was there before the swap — the
 * real Supabase one, on the client's own fetch (so the write freeze and any
 * other layer of the service fetch still apply to it).
 */
export function supabaseStorageMirror(original: StorageClientLike): StorageMirror {
  return {
    async upload(bucket, path, bytes, contentType, cacheControl) {
      const { error } = await original.from(bucket).upload(path, bytes, { contentType, upsert: true, ...(cacheControl ? { cacheControl } : {}) });
      if (error) throw error;
    },
    async remove(bucket, paths) {
      const { error } = await original.from(bucket).remove(paths);
      if (error) throw error;
    },
  };
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

export type WithR2StorageOptions = Omit<R2StorageOptions, "mirror"> & {
  /** Tests only: ignore STORAGE_BACKEND. Also turns the default mirror off — a test must never write to live Supabase by accident. */
  force?: boolean;
  /** Tests only: build URLs on this base instead of PUBLIC_BASE_URL. */
  baseUrl?: string;
  /** Override the mirror: a custom one, or false for R2 only. Default: Supabase, unless STORAGE_SUPABASE_MIRROR=off. */
  mirror?: StorageMirror | false;
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
  const { force, baseUrl, wrap, mirror: mirrorOpt, ...storageOpts } = opts;

  const original = client.storage;
  const mirror = mirrorOpt !== undefined
    ? mirrorOpt || null
    : !force && supabaseMirrorEnabled() ? supabaseStorageMirror(original) : null;

  // Loaded once, on the first storage call. If the module cannot load, the call
  // rejects and storage-js hands it back as `error` — never a silent fall back
  // to Supabase, where a write would land in the backend being left.
  let loaded: Promise<Fetch> | null = null;
  const handler = ((input: RequestInfo | URL, init?: RequestInit) => {
    loaded ??= import("@/lib/storage/r2StorageFetch").then((m) =>
      m.makeR2StorageFetch({ ...storageOpts, mirror, passthrough: storageOpts.passthrough ?? refuseNetwork }),
    );
    return loaded.then((f) => f(input as RequestInfo, init));
  }) as Fetch;

  // Built from the existing instance's class, so no direct dependency on
  // @supabase/storage-js (a transitive package) is needed. No headers: nothing
  // leaves the process, so the service-role key has nowhere to go.
  const Ctor = original.constructor as StorageClientCtor;
  client.storage = new Ctor(baseUrl ?? r2StorageBaseUrl(), {}, wrap ? wrap(handler) : handler);
  return client;
}
