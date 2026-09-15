/**
 * The scoped URL-token format of lib/dlToken.ts, on Web Crypto.
 *
 *   base64url(JSON {...claims, e}) + "." + base64url(HMAC-SHA256(key, payload))
 *
 * Why a second implementation of the same bytes: lib/dlToken.ts signs with
 * Node's `crypto`, and the R2 storage adapter (lib/storage/*) is loaded by
 * lib/supabase.ts — which instrumentation.ts reaches through reportError →
 * telegram. A `crypto` import on that path failed the build with "Module not
 * found: Can't resolve 'crypto'" in the edge compilation. globalThis.crypto.subtle
 * exists in Node, Workers and edge alike, so this file imports nothing.
 *
 * The output is byte-identical to signScopedToken / verifyScopedToken in
 * lib/dlToken.ts for the same key, claims and second (tests/scopedToken.test.ts).
 * It has to be: a storage signed URL minted by one isolate is checked by
 * another, and the download-token routes keep verifying with the Node code —
 * one key, one format, one secret source.
 */

/**
 * The HMAC key. The service-role key is a long, high-entropy secret that never
 * leaves the server, so no new env is required; DL_TOKEN_SECRET overrides it.
 * lib/dlToken.ts reads its key from here too, so the two implementations can
 * never sign with different keys.
 */
export function scopedTokenSecret(): string {
  return (
    process.env.DL_TOKEN_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    ""
  );
}

export type ScopedTokenCheck =
  | { ok: true; claims: Record<string, unknown> }
  | { ok: false; reason: "invalid" | "expired" };

const utf8 = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  // Chunked: String.fromCharCode(...bytes) over a very long object path would overflow the call stack.
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecodeUtf8(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  // Not fatal, like Buffer#toString("utf8"): a bad sequence becomes U+FFFD either way.
  return new TextDecoder().decode(bytes);
}

// importKey per call is wasted work on a page of signed URLs. Keyed on the secret
// string, so a changed DL_TOKEN_SECRET (tests do this) never signs with a stale key.
let cachedKey: { secret: string; key: Promise<CryptoKey> } | null = null;

function hmacKey(secret: string): Promise<CryptoKey> {
  if (cachedKey?.secret !== secret) {
    cachedKey = { secret, key: crypto.subtle.importKey("raw", utf8.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]) };
  }
  return cachedKey.key;
}

async function signature(secret: string, payload: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), utf8.encode(payload))));
}

/**
 * Walks every character whatever the first mismatch — what timingSafeEqual gives
 * the Node version. Both sides are base64url, so a length difference is no secret.
 */
function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Sign `claims` for `ttlSec` seconds — the same string lib/dlToken.ts signScopedToken returns. */
export async function signScopedTokenWeb(claims: Record<string, string>, ttlSec: number): Promise<string> {
  const secret = scopedTokenSecret();
  if (!secret) throw new Error("dlToken: no signing secret configured");
  const exp = Math.floor(Date.now() / 1000) + Math.max(1, Math.floor(ttlSec));
  const payload = b64url(utf8.encode(JSON.stringify({ ...claims, e: exp })));
  return `${payload}.${await signature(secret, payload)}`;
}

/** Verify signature + expiry exactly as lib/dlToken.ts verifyScopedToken does. The caller checks the claims. */
export async function verifyScopedTokenWeb(token: string | null | undefined): Promise<ScopedTokenCheck> {
  const secret = scopedTokenSecret();
  if (!token || !secret) return { ok: false, reason: "invalid" };
  const dot = token.indexOf(".");
  if (dot <= 0) return { ok: false, reason: "invalid" };
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!payload || !sig) return { ok: false, reason: "invalid" };
  if (!sameString(sig, await signature(secret, payload))) return { ok: false, reason: "invalid" };

  try {
    const obj = JSON.parse(b64urlDecodeUtf8(payload)) as Record<string, unknown>;
    if (!obj || typeof obj !== "object" || typeof obj.e !== "number") return { ok: false, reason: "invalid" };
    if (Math.floor(Date.now() / 1000) > obj.e) return { ok: false, reason: "expired" };
    return { ok: true, claims: obj };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}
