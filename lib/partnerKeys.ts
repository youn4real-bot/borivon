/**
 * Partner API keys — the credential an outside agency's system uses to pull the
 * candidates the founder has explicitly shared with them.
 *
 * Pure functions only: no database, no request. Everything here can be reasoned
 * about and tested on its own, because getting any of it slightly wrong is how
 * a partner ends up holding a key to more than they should.
 *
 * SHAPE OF A KEY:  bv_live_<43 url-safe base64 chars>   (256 bits of entropy)
 *
 * The prefix is there so a leaked key is recognisable ON SIGHT in a log, a
 * pasted email or a support ticket — the same reason Stripe and GitHub do it.
 * "live" leaves room for a "bv_test_" tier later without changing the parser.
 */

export const KEY_PREFIX = "bv_live_";

/** How much of the key is stored in clear, purely so two keys can be told apart. */
const VISIBLE_CHARS = 8;

/**
 * Mint a key. Uses WebCrypto, which exists on Workers and on Node 18+ — the
 * same reason the Google auth path uses it rather than node:crypto.
 *
 * 32 bytes = 256 bits. Base64url so it survives a copy-paste into any config
 * file, a URL, or a chat message without escaping.
 */
export function generatePartnerKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${KEY_PREFIX}${b64}`;
}

/**
 * SHA-256 of the key, hex. This is what the database stores — the key itself
 * never is, so a leaked backup cannot be used to call the API.
 *
 * No salt on purpose: a salt exists to slow down guessing a LOW-entropy secret
 * (a password). This is 256 random bits, which cannot be brute-forced at any
 * cost, and an unsalted hash is what lets the lookup be a single indexed query
 * instead of a scan of every key row.
 */
export async function hashPartnerKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The short, safe-to-display fragment shown in the admin list. */
export function keyPrefixOf(key: string): string {
  return key.slice(0, KEY_PREFIX.length + VISIBLE_CHARS);
}

/**
 * Pull the key out of an incoming request's headers.
 *
 * Accepts BOTH `Authorization: Bearer <key>` and `X-API-Key: <key>`, because we
 * do not know what the partner's provider is yet and their AI will reach for
 * whichever it assumes. Supporting both costs nothing and avoids a support
 * round-trip over a header name.
 */
export function extractPartnerKey(headers: {
  get(name: string): string | null;
}): string | null {
  const auth = (headers.get("authorization") ?? "").trim();
  if (/^bearer\s+/i.test(auth)) {
    const v = auth.replace(/^bearer\s+/i, "").trim();
    if (v) return v;
  }
  const x = (headers.get("x-api-key") ?? "").trim();
  return x || null;
}

/**
 * Does this even look like one of our keys?
 *
 * A cheap shape check BEFORE hashing and hitting the database, so a flood of
 * junk (a scanner spraying "admin", a truncated paste) costs nothing. It is not
 * a security control — the hash lookup is — it is a cost control.
 */
export function looksLikePartnerKey(key: string | null | undefined): boolean {
  const k = String(key ?? "");
  if (!k.startsWith(KEY_PREFIX)) return false;
  const body = k.slice(KEY_PREFIX.length);
  // 32 bytes of base64url is always 43 chars.
  return body.length === 43 && /^[A-Za-z0-9_-]+$/.test(body);
}
