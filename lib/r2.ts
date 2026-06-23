/**
 * lib/r2.ts — Cloudflare R2 object storage (S3-compatible).
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
 * Server-only. Reads creds from R2_ENDPOINT / R2_ACCESS_KEY_ID /
 * R2_SECRET_ACCESS_KEY / R2_BUCKET.
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const ENDPOINT = process.env.R2_ENDPOINT;
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
export const R2_BUCKET = process.env.R2_BUCKET ?? "borivon-files";

// On Cloudflare Workers (workerd) we use the NATIVE R2 BINDING (env.R2) instead of the
// S3 client — no S3 endpoint/keys needed, and the @aws-sdk SigV4 path is heavier. The
// binding is declared in wrangler.jsonc ("r2_buckets": [{ binding:"R2", bucket_name:
// "borivon-files" }]) and reached via OpenNext's getCloudflareContext().env.R2. On Vercel
// (Node) this is false and we keep the proven S3 path byte-for-byte.
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

/** The native R2 binding on Workers, else null (Vercel uses the S3 client). Lazy dynamic
 *  import keeps @opennextjs/cloudflare out of the Vercel/Node path entirely. */
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

/** True when the S3 credentials are present (the Vercel/Node path). */
function s3Configured(): boolean {
  return !!(ENDPOINT && ACCESS_KEY_ID && SECRET_ACCESS_KEY);
}

/** True when R2 storage is reachable — via the native binding on Workers, or S3 creds on
 *  Vercel. Lets callers decide R2-vs-Drive. (On Workers we assume the wrangler binding is
 *  wired; the actual op throws clearly if it isn't.) */
export function r2Configured(): boolean {
  return ON_WORKERS || s3Configured();
}

let _client: S3Client | null = null;
function client(): S3Client {
  if (_client) return _client;
  if (!s3Configured()) {
    throw new Error("R2 not configured (missing R2_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY)");
  }
  _client = new S3Client({
    region: "auto", // R2 ignores region; "auto" is the convention
    endpoint: ENDPOINT,
    credentials: { accessKeyId: ACCESS_KEY_ID!, secretAccessKey: SECRET_ACCESS_KEY! },
  });
  return _client;
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
  const b = await r2Bucket();
  if (b) {
    const bytes = body instanceof Uint8Array ? body : new Uint8Array(body);
    await b.put(key, bytes, contentType ? { httpMetadata: { contentType } } : undefined);
    return;
  }
  await client().send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: body,
    ...(contentType ? { ContentType: contentType } : {}),
  }));
}

/** Download an object: bytes + its stored content-type. Null if not found. */
export async function r2GetObject(
  key: string,
): Promise<{ body: Buffer; contentType: string | null } | null> {
  const b = await r2Bucket();
  if (b) {
    const obj = await b.get(key);
    if (!obj) return null;
    return { body: Buffer.from(new Uint8Array(await obj.arrayBuffer())), contentType: obj.httpMetadata?.contentType ?? null };
  }
  try {
    const res = await client().send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    if (!res.Body) return null;
    const bytes = await res.Body.transformToByteArray();
    return { body: Buffer.from(bytes), contentType: res.ContentType ?? null };
  } catch (e: unknown) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

/** Delete an object. Idempotent — no error if it's already gone. */
export async function r2Delete(key: string): Promise<void> {
  const b = await r2Bucket();
  if (b) {
    await b.delete(key); // R2 binding delete is idempotent (no error if absent)
    return;
  }
  try {
    await client().send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  } catch (e) {
    if (!isNotFound(e)) throw e;
  }
}

/** Does an object exist? */
export async function r2Exists(key: string): Promise<boolean> {
  const b = await r2Bucket();
  if (b) return (await b.head(key)) !== null;
  try {
    await client().send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return true;
  } catch (e) {
    if (isNotFound(e)) return false;
    throw e;
  }
}

/** List every object under a key prefix (paginated). Returns key + size +
 *  lastModified. Used by the r2_key recovery and by the chat-upload attach
 *  feature (most-recent-first). */
export async function r2List(prefix: string): Promise<{ key: string; size: number; lastModified?: Date }[]> {
  const out: { key: string; size: number; lastModified?: Date }[] = [];
  const b = await r2Bucket();
  if (b) {
    let cursor: string | undefined;
    do {
      const res = await b.list({ prefix, cursor });
      for (const o of res.objects) out.push({ key: o.key, size: o.size, lastModified: o.uploaded });
      cursor = res.truncated ? res.cursor : undefined;
    } while (cursor);
    return out;
  }
  let token: string | undefined;
  do {
    const res = await client().send(new ListObjectsV2Command({
      Bucket: R2_BUCKET, Prefix: prefix, ContinuationToken: token,
    }));
    for (const o of res.Contents ?? []) out.push({ key: o.Key ?? "", size: o.Size ?? 0, lastModified: o.LastModified });
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out;
}

/** HEAD an object — returns its byte size, or null if it doesn't exist.
 *  Used by the verification audit to size-match each file against Drive. */
export async function r2Head(key: string): Promise<{ size: number } | null> {
  const b = await r2Bucket();
  if (b) {
    const h = await b.head(key);
    return h ? { size: h.size } : null;
  }
  try {
    const res = await client().send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return { size: res.ContentLength ?? 0 };
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

/**
 * Temporary download URL ("gate pass") — the browser fetches the file
 * STRAIGHT from R2, so the bytes never pass through the app server (no
 * Vercel/Workers bandwidth, free R2 egress). `downloadName` forces a save-as.
 */
export async function r2SignedGetUrl(
  key: string,
  opts: { expiresIn?: number; downloadName?: string; contentType?: string } = {},
): Promise<string> {
  const { expiresIn = 300, downloadName, contentType } = opts;
  return getSignedUrl(client(), new GetObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    ...(contentType ? { ResponseContentType: contentType } : {}),
    ...(downloadName
      ? { ResponseContentDisposition: `attachment; filename="${downloadName.replace(/[\r\n"]/g, "")}"` }
      : {}),
  }), { expiresIn });
}

/** Temporary upload URL — the browser PUTs the file straight to R2. */
export async function r2SignedPutUrl(
  key: string,
  contentType: string,
  expiresIn = 300,
): Promise<string> {
  return getSignedUrl(client(), new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    ContentType: contentType,
  }), { expiresIn });
}

function isNotFound(e: unknown): boolean {
  const x = e as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return (
    x?.name === "NoSuchKey" ||
    x?.name === "NotFound" ||
    x?.Code === "NoSuchKey" ||
    x?.$metadata?.httpStatusCode === 404
  );
}
