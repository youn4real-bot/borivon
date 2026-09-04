/**
 * One-time upload-link tokens. Mirrors lib/partnerKeys.ts: a 256-bit random
 * token in the URL, stored ONLY as its sha256 hash at rest (a 256-bit preimage
 * can't be brute-forced, so an unsalted hash is safe and lets lookup be a single
 * indexed query). WebCrypto — works on both Node 18+ and Cloudflare Workers.
 *
 * The raw token is handed to the admin ONCE (for the WhatsApp link) and never
 * persisted in clear; the DB holds only hashUploadToken(token).
 */

const TOKEN_BYTES = 32; // 256 bits

/** 32 random bytes → base64url, no prefix. ~43 chars. */
export function generateUploadToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** sha256 hex of the token — the ONLY thing stored. */
export async function hashUploadToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Cheap shape gate BEFORE any hashing / DB hit, so junk floods cost nothing. */
export function looksLikeUploadToken(token: string | null | undefined): boolean {
  return typeof token === "string" && /^[A-Za-z0-9_-]{40,64}$/.test(token);
}
