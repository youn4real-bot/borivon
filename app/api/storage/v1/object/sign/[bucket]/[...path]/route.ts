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
 * STORAGE_BACKEND "r2": served from R2. "supabase" (rollback): the token is
 * still checked, then the browser is sent to a one-minute Supabase signed URL
 * for the same object. Unset: 404, so merging this changes nothing on the live site.
 */
import { r2MediaRoutesEnabled, r2StorageEnabled } from "@/lib/storage/withR2Storage";
import { serveMediaRequest } from "@/lib/storage/r2StorageFetch";
import { supabaseRedirects } from "@/lib/storage/supabaseRedirects";
import { getServiceSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!r2MediaRoutesEnabled()) return new Response("Not found", { status: 404 });
  if (r2StorageEnabled()) return serveMediaRequest(req, "sign");
  return serveMediaRequest(req, "sign", { rollback: supabaseRedirects(getServiceSupabase().storage) });
}

export async function HEAD(req: Request): Promise<Response> {
  return GET(req);
}
