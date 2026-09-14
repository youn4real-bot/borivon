/**
 * GET /api/storage/v1/object/public/<bucket>/<path>
 *
 * What getPublicUrl() points at once files are served from R2 (see
 * lib/storage/withR2Storage.ts). Only the two buckets Supabase marks public —
 * profile-photos and feed-photos — are answered; any other bucket gets
 * Supabase's own "Bucket not found" refusal, so a contract in sign-documents
 * can never be fetched by guessing its path.
 *
 * 404s unless STORAGE_BACKEND=r2 (or STORAGE_MEDIA_ROUTES=on during a
 * rollback), so merging this changes nothing on the live site.
 */
import { r2MediaRoutesEnabled } from "@/lib/storage/withR2Storage";
import { serveMediaRequest } from "@/lib/storage/r2StorageFetch";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!r2MediaRoutesEnabled()) return new Response("Not found", { status: 404 });
  return serveMediaRequest(req, "public");
}

export async function HEAD(req: Request): Promise<Response> {
  return GET(req);
}
