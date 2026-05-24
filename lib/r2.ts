/**
 * lib/r2.ts — Cloudflare R2 object storage (S3-compatible).
 *
 * Single source of truth for file storage. Files are addressed by an object
 * KEY (a path-like string, e.g. "candidates/<userId>/<filename>") stored on
 * documents.r2_key.
 *
 * This build uses **aws4fetch** (a ~4 KB SigV4 signer over fetch) instead of
 * the multi-megabyte @aws-sdk/client-s3, so the whole app fits inside the
 * Cloudflare Workers bundle-size limit. The public surface (function names +
 * signatures) is identical to the AWS-SDK version, so no caller changes.
 *
 * Server-only. Reads creds from R2_ENDPOINT / R2_ACCESS_KEY_ID /
 * R2_SECRET_ACCESS_KEY / R2_BUCKET.
 */
import { AwsClient } from "aws4fetch";

const ENDPOINT = (process.env.R2_ENDPOINT ?? "").trim().replace(/\/+$/, "");
const ACCESS_KEY_ID = (process.env.R2_ACCESS_KEY_ID ?? "").trim();
const SECRET_ACCESS_KEY = (process.env.R2_SECRET_ACCESS_KEY ?? "").trim();
export const R2_BUCKET = (process.env.R2_BUCKET ?? "borivon-files").trim();

/** True only when every R2 credential is present. */
export function r2Configured(): boolean {
  return !!(ENDPOINT && ACCESS_KEY_ID && SECRET_ACCESS_KEY);
}

let _aws: AwsClient | null = null;
function aws(): AwsClient {
  if (_aws) return _aws;
  if (!r2Configured()) {
    throw new Error("R2 not configured (missing R2_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY)");
  }
  _aws = new AwsClient({
    accessKeyId: ACCESS_KEY_ID,
    secretAccessKey: SECRET_ACCESS_KEY,
    region: "auto", // R2 ignores region; "auto" is the convention
    service: "s3",
  });
  return _aws;
}

/** Full URL of an object. Each key segment is URI-encoded; slashes kept. */
function objUrl(key: string): string {
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  return `${ENDPOINT}/${R2_BUCKET}/${encoded}`;
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
  const res = await aws().fetch(objUrl(key), {
    method: "PUT",
    body: body as BodyInit,
    headers: contentType ? { "content-type": contentType } : undefined,
  });
  if (!res.ok) throw new Error(`R2 put failed (${res.status}) for ${key}`);
}

/** Download an object: bytes + its stored content-type. Null if not found. */
export async function r2GetObject(
  key: string,
): Promise<{ body: Buffer; contentType: string | null } | null> {
  const res = await aws().fetch(objUrl(key), { method: "GET" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`R2 get failed (${res.status}) for ${key}`);
  const ab = await res.arrayBuffer();
  return { body: Buffer.from(ab), contentType: res.headers.get("content-type") };
}

/** Delete an object. Idempotent — no error if it's already gone. */
export async function r2Delete(key: string): Promise<void> {
  const res = await aws().fetch(objUrl(key), { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error(`R2 delete failed (${res.status}) for ${key}`);
}

/** Does an object exist? */
export async function r2Exists(key: string): Promise<boolean> {
  const res = await aws().fetch(objUrl(key), { method: "HEAD" });
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`R2 head failed (${res.status}) for ${key}`);
  return true;
}

/** HEAD an object — returns its byte size, or null if it doesn't exist. */
export async function r2Head(key: string): Promise<{ size: number } | null> {
  const res = await aws().fetch(objUrl(key), { method: "HEAD" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`R2 head failed (${res.status}) for ${key}`);
  const len = res.headers.get("content-length");
  return { size: len ? parseInt(len, 10) : 0 };
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
  const url = new URL(objUrl(key));
  url.searchParams.set("X-Amz-Expires", String(expiresIn));
  if (contentType) url.searchParams.set("response-content-type", contentType);
  if (downloadName) {
    url.searchParams.set(
      "response-content-disposition",
      `attachment; filename="${downloadName.replace(/[\r\n"]/g, "")}"`,
    );
  }
  const signed = await aws().sign(url.toString(), {
    method: "GET",
    aws: { signQuery: true },
  });
  return signed.url;
}

/** Temporary upload URL — the browser PUTs the file straight to R2. */
export async function r2SignedPutUrl(
  key: string,
  contentType: string,
  expiresIn = 300,
): Promise<string> {
  const url = new URL(objUrl(key));
  url.searchParams.set("X-Amz-Expires", String(expiresIn));
  const signed = await aws().sign(url.toString(), {
    method: "PUT",
    aws: { signQuery: true },
    headers: { "content-type": contentType },
  });
  return signed.url;
}
