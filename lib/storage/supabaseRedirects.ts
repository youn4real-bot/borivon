/**
 * Where the media routes send a browser after a ROLLBACK (STORAGE_BACKEND
 * "supabase"): the same object on Supabase Storage.
 *
 * URLs on our domain were stored in rows while R2 was active, so the routes
 * outlive the flip back. They must not keep answering from R2 then: Supabase is
 * the truth again, and a photo cleared or a post deleted after the rollback is
 * removed only there — serving R2's copy would keep it downloadable. The mirror
 * put every R2-period file into Supabase, so redirecting finds it.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SupabaseRedirects } from "@/lib/storage/r2StorageFetch";

export function supabaseRedirects(storage: SupabaseClient["storage"]): SupabaseRedirects {
  return {
    publicUrl: (bucket, path) => storage.from(bucket).getPublicUrl(path).data.publicUrl,
    async signedUrl(bucket, path, expiresIn, download) {
      const opts = download === null ? undefined : { download: download === "" ? true : download };
      const { data, error } = await storage.from(bucket).createSignedUrl(path, expiresIn, opts);
      return error || !data?.signedUrl ? null : data.signedUrl;
    },
  };
}
