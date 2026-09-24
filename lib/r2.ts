/**
 * lib/r2.ts — Cloudflare R2 object storage, through the NATIVE Worker binding.
 *
 * Single source of truth for file storage, replacing the inline Google Drive
 * clients scattered across the upload / file / merge-pdf / sign-request /
 * passport routes. R2 charges $0 for downloads (egress) and has no per-call
 * rate-limit walls, unlike the Drive API.
 *
 * Files are addressed by an object KEY (a path-like string, e.g.
 * "candidates/<userId>/<filename>") which we store on documents.r2_key — the
 * same role drive_file_id played. Serving falls back to Drive while old files
 * are still being migrated (r2_key null → fetch from Drive).
 *
 * THE @aws-sdk S3 CLIENT IS GONE, and this is the note that explains it.
 * Every function here used to try the native binding first and fall back to an
 * S3 client for "Vercel". That fallback could not run in ANY environment that
 * still exists:
 *   • On Workers the binding branch is always taken first.
 *   • Anywhere else the client needs R2_ENDPOINT / R2_ACCESS_KEY_ID /
 *     R2_SECRET_ACCESS_KEY, and none of the three is set — not in .env.local,
 *     not in wrangler.jsonc. `next dev` already threw "R2 not configured" on
 *     the first call.
 * Unreachable, but not free: @aws-sdk/client-s3 + @smithy/* + the presigner
 * compiled 946 KB into the single Cloudflare Worker script (the SigV4 chain,
 * fast-xml-parser, bowser), and workerd parses all of it on every cold isolate
 * before it can answer the first request — a cost the nurses pay on every tap.
 *
 * WHAT THIS CHANGES IN PRACTICE: if the R2 binding were ever missing or renamed
 * in wrangler.jsonc, these calls now throw a named error instead of silently
 * trying an S3 client that would have failed anyway. Loud beats silent — this
 * is the path lib/driveMirror.ts reads every candidate document through on its
 * way into the agency Drive folder, and a mirror that half-works is worse than
 * one that says what is wrong.
 *
 * Server-only. Needs the "R2" binding from wrangler.jsonc ("r2_buckets").
 */

// Cloudflare Workers (workerd) identify themselves this way. Kept as a runtime
// check rather than a build flag because the same bundle also runs under
// `next dev`, where there is no binding and every call must fail loudly.
const ON_WORKERS = typeof navigator !== "undefined" && (navigator as { userAgent?: string }).userAgent === "Cloudflare-Workers";

// Minimal structural type for the workerd R2Bucket surface we use (avoids a hard dep on
// @cloudflare/workers-types). Mirrors the native binding API.
type R2ObjLike = { arrayBuffer(): Promise<ArrayBuffer>; httpMetadata?: { contentType?: string }; size: number; key: string; uploaded?: Date };
type R2BindingLike = {
  get(key: string): Promise<R2ObjLike | null>;
  put(key: string, value: ArrayBuffer | ArrayBufferView | string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  delete(key: string): Promise<void>;
  head(key: string): Promise<{ size: number } | null>;
  list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{ objects: { key: string; size: number; uploaded?: Date }[]; truncated: boolean; cursor?: string }>;
};

/** The native R2 binding on Workers, else null. The import is lazy so that
 *  @opennextjs/cloudflare is never reached outside a Worker. */
async function r2Bucket(): Promise<R2BindingLike | null> {
  if (!ON_WORKERS) return null;
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const env = getCloudflareContext().env as Record<string, unknown> | undefined;
    return (env && env.R2 ? (env.R2 as R2BindingLike) : null);
  } catch {
    return null;
  }
}

/** The binding, or a message that names the one thing to check. Every operation
 *  below goes through this, so a missing binding reads the same everywhere
 *  instead of surfacing as six different TypeErrors. */
async function requireBucket(): Promise<R2BindingLike> {
  const b = await r2Bucket();
  if (!b) {
    throw new Error(
      "R2 unavailable: no native R2 binding. On Cloudflare check the \"R2\" entry under r2_buckets in wrangler.jsonc; outside Workers (e.g. `next dev`) there is no R2 at all — use `npm run cf:preview`, which runs the Worker with a local binding.",
    );
  }
  return b;
}

/** True when R2 storage is reachable. On Workers we assume the wrangler binding
 *  is wired — the actual operation throws clearly if it is not, and
 *  /api/health?deep=1 proves it for real by listing a prefix. */
export function r2Configured(): boolean {
  return ON_WORKERS;
}

/** Object key for a candidate's file — mirrors the per-candidate folder
 *  layout Drive used: candidates/<userId>/<sanitised filename>. */
export function candidateKey(userId: string, fileName: string): string {
  const safe = (fileName || "document").replace(/[^\w.\-]+/g, "_").replace(/_+/g, "_");
  return `candidates/${userId}/${safe}`;
}

/** Upload bytes to R2. */
export async function r2Put(
  key: string,
  body: Buffer | Uint8Array,
  contentType?: string,
): Promise<void> {
  const b = await requireBucket();
  const bytes = body instanceof Uint8Array ? body : new Uint8Array(body);
  await b.put(key, bytes, contentType ? { httpMetadata: { contentType } } : undefined);
}

/** Download an object: bytes + its stored content-type. Null if not found. */
export async function r2GetObject(
  key: string,
): Promise<{ body: Buffer; contentType: string | null } | null> {
  const b = await requireBucket();
  const obj = await b.get(key);
  if (!obj) return null;
  return { body: Buffer.from(new Uint8Array(await obj.arrayBuffer())), contentType: obj.httpMetadata?.contentType ?? null };
}

/** Delete an object. Idempotent — no error if it's already gone. */
export async function r2Delete(key: string): Promise<void> {
  const b = await requireBucket();
  await b.delete(key); // R2 binding delete is idempotent (no error if absent)
}

/** Does an object exist? */
export async function r2Exists(key: string): Promise<boolean> {
  const b = await requireBucket();
  return (await b.head(key)) !== null;
}

/** List every object under a key prefix (paginated). Returns key + size +
 *  lastModified. Used by the r2_key recovery and by the chat-upload attach
 *  feature (most-recent-first). */
export async function r2List(prefix: string): Promise<{ key: string; size: number; lastModified?: Date }[]> {
  const out: { key: string; size: number; lastModified?: Date }[] = [];
  const b = await requireBucket();
  let cursor: string | undefined;
  do {
    const res = await b.list({ prefix, cursor });
    for (const o of res.objects) out.push({ key: o.key, size: o.size, lastModified: o.uploaded });
    cursor = res.truncated ? res.cursor : undefined;
  } while (cursor);
  return out;
}

/** HEAD an object — returns its byte size, or null if it doesn't exist.
 *  Used by the verification audit to size-match each file against Drive. */
export async function r2Head(key: string): Promise<{ size: number } | null> {
  const b = await requireBucket();
  const h = await b.head(key);
  return h ? { size: h.size } : null;
}
