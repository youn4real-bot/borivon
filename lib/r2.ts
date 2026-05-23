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
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const ENDPOINT = process.env.R2_ENDPOINT;
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
export const R2_BUCKET = process.env.R2_BUCKET ?? "borivon-files";

/** True only when every R2 credential is present. Lets callers gracefully
 *  fall back to Drive during the migration window. */
export function r2Configured(): boolean {
  return !!(ENDPOINT && ACCESS_KEY_ID && SECRET_ACCESS_KEY);
}

let _client: S3Client | null = null;
function client(): S3Client {
  if (_client) return _client;
  if (!r2Configured()) {
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
  try {
    await client().send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  } catch (e) {
    if (!isNotFound(e)) throw e;
  }
}

/** Does an object exist? */
export async function r2Exists(key: string): Promise<boolean> {
  try {
    await client().send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return true;
  } catch (e) {
    if (isNotFound(e)) return false;
    throw e;
  }
}

/** HEAD an object — returns its byte size, or null if it doesn't exist.
 *  Used by the verification audit to size-match each file against Drive. */
export async function r2Head(key: string): Promise<{ size: number } | null> {
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
