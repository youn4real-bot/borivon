/**
 * GET /api/storage/v1/object/sign/<bucket>/<path>?token=…
 *
 * What createSignedUrl() hands out once files are served from R2 (candidate
 * sign-request previews, signed contracts, the assistant's document links).
 * The token is an HMAC bound to this exact bucket + path with an expiry
 * (lib/storage/storageToken.ts); without a live one for this object the answer
 * is Supabase's own InvalidJWT refusal. This is the only way a private-bucket
 * object leaves the server.
 *
 * 404s unless STORAGE_BACKEND=r2 (or STORAGE_MEDIA_ROUTES=on during a
 * rollback), so merging this changes nothing on the live site.
 */
import { r2MediaRoutesEnabled } from "@/lib/storage/withR2Storage";
import { serveMediaRequest } from "@/lib/storage/r2StorageFetch";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!r2MediaRoutesEnabled()) return new Response("Not found", { status: 404 });
  return serveMediaRequest(req, "sign");
}

export async function HEAD(req: Request): Promise<Response> {
  return GET(req);
}
