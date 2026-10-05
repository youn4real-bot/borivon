/**
 * The bytes behind the storage adapter: one small interface, two ways to reach
 * the same R2 bucket (borivon-files).
 *
 *   • Cloudflare Workers — the native binding env.R2, chosen by the same
 *     "am I on Workers" test lib/r2.ts uses, so the adapter and the candidate
 *     document code can never end up talking to two different buckets.
 *   • Node with the Cloudflare account token (CLOUDFLARE_ACCOUNT_ID /
 *     CLOUDFLARE_API_TOKEN, what .env.local has) — Cloudflare's R2 REST API,
 *     the same endpoints storage/copy-to-r2.mjs used to make the copy. This is
 *     what the live parity test runs on.
 *
 * THERE WAS A THIRD: "Node with S3 credentials", which delegated to an
 * @aws-sdk/client-s3 client inside lib/r2.ts. That client is gone — it compiled
 * 946 KB into the single Worker script and could not run anywhere, since
 * R2_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY are set in no
 * environment (see the note at the top of lib/r2.ts). Its wrapper here was kept
 * alive by nothing but this comment: lib/r2.ts's functions now require the
 * native binding, so on Node every call through it threw "no native R2
 * binding" — and because it was CHOSEN before the REST path, setting those
 * three variables would have broken the one path that does work in Node
 * instead of enabling anything. Both are removed.
 *
 * The interface is deliberately tiny so the unit tests can hand the adapter an
 * in-memory Map and prove every storage-js shape without a network.
 */

/**
 * The bucket by NAME, which only the REST path needs — the native binding IS
 * the bucket and never names it. Same expression the repo's other R2 callers
 * use (storage/listing.mjs, scripts/cftest/backfillDriveToR2.mjs) and the same
 * default as wrangler.jsonc's `bucket_name`.
 */
const R2_BUCKET = process.env.R2_BUCKET || "borivon-files";

export type ObjectHead = {
  size: number;
  contentType: string | null;
  uploaded: Date | null;
  /** Bare etag, no quotes. */
  etag: string | null;
};
export type StoredObject = ObjectHead & { body: Uint8Array<ArrayBuffer> };
export type ListedObject = ObjectHead & { key: string };

export interface ObjectStore {
  get(key: string): Promise<StoredObject | null>;
  head(key: string): Promise<ObjectHead | null>;
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  /** Idempotent: deleting a missing key is not an error. */
  delete(key: string): Promise<void>;
  /** Every object whose key starts with `prefix` (all pages). */
  list(prefix: string): Promise<ListedObject[]>;
}

// ── Workers binding ──────────────────────────────────────────────────────────

type R2ObjectMeta = { key: string; size: number; etag?: string; uploaded?: Date; httpMetadata?: { contentType?: string } };
export type R2BindingLike = {
  get(key: string): Promise<(R2ObjectMeta & { arrayBuffer(): Promise<ArrayBuffer> }) | null>;
  head(key: string): Promise<R2ObjectMeta | null>;
  put(key: string, value: Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  delete(key: string): Promise<void>;
  list(options: { prefix?: string; cursor?: string; include?: "httpMetadata"[] }): Promise<{ objects: R2ObjectMeta[]; truncated: boolean; cursor?: string }>;
};

function headOf(o: R2ObjectMeta): ObjectHead {
  return { size: o.size, contentType: o.httpMetadata?.contentType ?? null, uploaded: o.uploaded ?? null, etag: o.etag ?? null };
}

export function bindingObjectStore(bucket: R2BindingLike): ObjectStore {
  return {
    async get(key) {
      const o = await bucket.get(key);
      if (!o) return null;
      const body = new Uint8Array(await o.arrayBuffer());
      return { ...headOf(o), size: body.length, body };
    },
    async head(key) {
      const o = await bucket.head(key);
      return o ? headOf(o) : null;
    },
    async put(key, body, contentType) {
      await bucket.put(key, body, { httpMetadata: { contentType } });
    },
    async delete(key) {
      await bucket.delete(key);
    },
    async list(prefix) {
      const out: ListedObject[] = [];
      let cursor: string | undefined;
      do {
        // include httpMetadata, or every listed file would report no mimetype.
        const res = await bucket.list({ prefix, cursor, include: ["httpMetadata"] });
        for (const o of res.objects) out.push({ key: o.key, ...headOf(o) });
        cursor = res.truncated ? res.cursor : undefined;
      } while (cursor);
      return out;
    },
  };
}

// ── Cloudflare R2 REST API ───────────────────────────────────────────────────

type RestListItem = { key: string; size: number; etag?: string; last_modified?: string; http_metadata?: { contentType?: string } };

export function restObjectStore(opts: { accountId: string; token: string; bucket: string; fetchImpl?: typeof fetch }): ObjectStore {
  const doFetch = opts.fetchImpl ?? fetch;
  const base = `https://api.cloudflare.com/client/v4/accounts/${opts.accountId}/r2/buckets/${encodeURIComponent(opts.bucket)}/objects`;
  const auth = { Authorization: `Bearer ${opts.token}` };
  const enc = (key: string) => key.split("/").map(encodeURIComponent).join("/");

  // The Cloudflare API answers the odd 429 / 5xx under a burst of requests.
  // Every call here is idempotent (GET, PUT of the same bytes, DELETE), so a
  // short retry turns a transient blip into a non-event instead of a failed op.
  async function call(url: string, init: RequestInit): Promise<Response> {
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await doFetch(url, init);
        if ((res.status === 429 || res.status >= 500) && attempt < 3) {
          await new Promise((r) => setTimeout(r, 300 * attempt));
          continue;
        }
        return res;
      } catch (err) {
        if (attempt >= 3) throw err;
        await new Promise((r) => setTimeout(r, 300 * attempt));
      }
    }
  }

  async function list(prefix: string): Promise<ListedObject[]> {
    const out: ListedObject[] = [];
    let cursor = "";
    for (;;) {
      const qs = new URLSearchParams({ per_page: "1000", prefix });
      if (cursor) qs.set("cursor", cursor);
      const res = await call(`${base}?${qs}`, { headers: auth });
      const json = (await res.json().catch(() => ({}))) as { success?: boolean; result?: RestListItem[]; result_info?: { cursor?: string } };
      if (!res.ok || !json.success) throw new Error(`R2 list failed: HTTP ${res.status}`);
      const page = json.result ?? [];
      for (const o of page) {
        out.push({
          key: o.key,
          size: o.size,
          contentType: o.http_metadata?.contentType ?? null,
          uploaded: o.last_modified ? new Date(o.last_modified) : null,
          etag: o.etag ?? null,
        });
      }
      cursor = json.result_info?.cursor ?? "";
      if (!cursor || page.length === 0) return out;
    }
  }

  return {
    async get(key) {
      const res = await call(`${base}/${enc(key)}`, { headers: auth });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`R2 get failed: HTTP ${res.status}`);
      const body = new Uint8Array(await res.arrayBuffer());
      const modified = res.headers.get("last-modified");
      return {
        body,
        size: body.length,
        contentType: res.headers.get("content-type"),
        uploaded: modified ? new Date(modified) : null,
        etag: (res.headers.get("etag") ?? "").replace(/"/g, "") || null,
      };
    },
    async head(key) {
      // The REST API has no HEAD for objects; an exact-key match in a listing
      // gives the same answer without downloading the bytes.
      const hit = (await list(key)).find((o) => o.key === key);
      return hit ? { size: hit.size, contentType: hit.contentType, uploaded: hit.uploaded, etag: hit.etag } : null;
    },
    async put(key, body, contentType) {
      const res = await call(`${base}/${enc(key)}`, { method: "PUT", headers: { ...auth, "Content-Type": contentType }, body: new Uint8Array(body) });
      if (!res.ok) throw new Error(`R2 put failed: HTTP ${res.status}`);
    },
    async delete(key) {
      const res = await call(`${base}/${enc(key)}`, { method: "DELETE", headers: auth });
      if (!res.ok && res.status !== 404) throw new Error(`R2 delete failed: HTTP ${res.status}`);
    },
    list,
  };
}

// ── Which one this runtime gets ──────────────────────────────────────────────

// Same detection as lib/r2.ts — see the comment there.
const ON_WORKERS = typeof navigator !== "undefined" && (navigator as { userAgent?: string }).userAgent === "Cloudflare-Workers";

let override: ObjectStore | undefined;

/** Tests inject a store (and reset with null). */
export function setObjectStore(store: ObjectStore | null): void {
  override = store ?? undefined;
}

/** The store for this runtime, or null when R2 is not reachable from here. */
export async function defaultObjectStore(): Promise<ObjectStore | null> {
  if (override) return override;
  if (ON_WORKERS) {
    try {
      const { getCloudflareContext } = await import("@opennextjs/cloudflare");
      const env = getCloudflareContext().env as Record<string, unknown> | undefined;
      return env?.R2 ? bindingObjectStore(env.R2 as R2BindingLike) : null;
    } catch {
      return null;
    }
  }
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (accountId && token) return restObjectStore({ accountId, token, bucket: R2_BUCKET });
  return null;
}
