/**
 * The credential inside an R2 storage "signed URL".
 *
 * Supabase's createSignedUrl hands out a URL on supabase.co carrying a JWT that
 * only Supabase can check. Once files live in R2 that URL points at nothing, so
 * the adapter mints its own: an HMAC token in the SAME format and with the SAME
 * key as the download token (lib/dlToken.ts), bound to exactly one object and
 * one expiry. The signed-object route (app/api/storage/v1/object/sign/...)
 * serves the object only when the token names that bucket + path and has not
 * expired — a private bucket (sign-documents, slot-templates) is never
 * reachable without one.
 *
 * Replay across token kinds is closed by the claims, not by a second key: a
 * download token carries `u` and no `p`; this one carries `p: "storage"` and no
 * `u`. verifyDlToken rejects a storage token (no `u`) and checkStorageToken
 * rejects a download token (no `p`), so a leaked link to one signed PDF can
 * never be presented to a file route as "I am user X", nor the reverse.
 */
import { signScopedToken, verifyScopedToken } from "@/lib/dlToken";

const PURPOSE = "storage";

/** Token for one object, valid for `ttlSec` seconds (storage-js passes expiresIn). */
export function signStorageToken(bucket: string, path: string, ttlSec: number): string {
  return signScopedToken({ p: PURPOSE, o: `${bucket}/${path}` }, ttlSec);
}

/** "ok" only for a live token minted for exactly this bucket + path. */
export function checkStorageToken(
  token: string | null | undefined,
  bucket: string,
  path: string,
): "ok" | "invalid" | "expired" {
  const check = verifyScopedToken(token);
  if (!check.ok) return check.reason;
  const { p, o, u } = check.claims;
  if (p !== PURPOSE || u !== undefined || o !== `${bucket}/${path}`) return "invalid";
  return "ok";
}
