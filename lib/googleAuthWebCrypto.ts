/**
 * Runtime-agnostic Google service-account auth via WebCrypto.
 *
 * WHY THIS EXISTS (Cloudflare migration, Stage 1 de-risk): the bot's Google access
 * (Gmail / Calendar / Drive) currently goes through googleapis' `google.auth.JWT` client
 * (lib/googleWorkspace.ts), whose token-signing chain (gtoken → jws) historically breaks on
 * the Cloudflare Workers runtime — the #1 unknown for moving the bot to Cloudflare. This
 * module mints a domain-wide-delegation access token WITHOUT that chain: it builds + RS256-
 * signs the JWT assertion with `crypto.subtle` (present on BOTH Node 18+ and Workers) and
 * exchanges it at Google's token endpoint with plain `fetch`. No googleapis, no node-only
 * signing libs — so it runs identically on Vercel (Node) and Cloudflare (workerd).
 *
 * SAFETY: this is a NEW, standalone module. Nothing imports it yet, so the live Vercel app
 * is byte-for-byte unaffected — it keeps using google.auth.JWT. The bot Worker will use this
 * once we deploy + verify it on Cloudflare (Stage 2). The pure JWT build+sign is split out
 * (`buildGoogleJwtAssertion`) so it's unit-tested deterministically without network or a real
 * key (the test signs with a generated keypair and verifies the signature) — proving the exact
 * WebCrypto signing that breaks on Workers actually works here.
 */

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const JWT_BEARER_GRANT = "urn:ietf:params:oauth:grant-type:jwt-bearer";

export type GoogleSaKey = { client_email: string; private_key: string };

/** base64url-encode raw bytes (no padding). */
function b64urlBytes(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
/** base64url-encode a UTF-8 string. */
function b64urlStr(str: string): string {
  return b64urlBytes(new TextEncoder().encode(str));
}

/** PEM (PKCS#8 "BEGIN PRIVATE KEY") → DER ArrayBuffer for crypto.subtle.importKey. */
function pemToPkcs8Der(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----/g, "")
    .replace(/-----END [A-Z ]*PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

/**
 * Build a SIGNED Google OAuth2 JWT assertion (RS256) for a service account, impersonating
 * `subject` via domain-wide delegation. Pure (no network) → unit-testable. Throws on a bad key.
 */
export async function buildGoogleJwtAssertion(opts: {
  key: GoogleSaKey;
  subject: string;
  scopes: string[];
  now?: number; // unix seconds; injectable for deterministic tests
}): Promise<string> {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: opts.key.client_email,
    sub: opts.subject, // the impersonated user (DWD)
    scope: opts.scopes.join(" "),
    aud: TOKEN_ENDPOINT,
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${b64urlStr(JSON.stringify(header))}.${b64urlStr(JSON.stringify(claims))}`;
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8Der(opts.key.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${b64urlBytes(new Uint8Array(sig))}`;
}

type CacheEntry = { accessToken: string; expiresAt: number };
const tokenCache = new Map<string, CacheEntry>();

type TokenResponse = { access_token?: string; expires_in?: number };

/**
 * POST the signed assertion to Google's token endpoint, retrying ONCE on a transient
 * (a network throw or a 5xx). A 4xx is a deterministic config error (unauthorized_client =
 * DWD not delegated, invalid_grant = clock/JWT) so we DON'T waste a retry on it — return
 * null immediately. This matters on Cloudflare: a cold worker isolate's very first token
 * fetch can blip, and without a retry the founder's first message of an idle period fails.
 */
async function exchangeToken(assertion: string): Promise<TokenResponse | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const last = attempt === 1;
    try {
      const res = await fetch(TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: JWT_BEARER_GRANT, assertion }),
      });
      if (res.ok) return (await res.json()) as TokenResponse;
      const bodyText = await res.text().catch(() => "");
      if (res.status < 500 || last) {
        console.error("[googleAuthWebCrypto] token exchange failed:", res.status, bodyText);
        return null; // 4xx (config) → no retry; or 5xx on the last attempt
      }
      console.error("[googleAuthWebCrypto] token exchange 5xx, retrying:", res.status);
    } catch (e) {
      if (last) {
        console.error("[googleAuthWebCrypto] token exchange error:", e instanceof Error ? e.message : e);
        return null;
      }
      // transient network throw on the first attempt → fall through and retry
    }
  }
  return null;
}

/**
 * Mint (and cache ~55 min) a Google access token for the service account, impersonating
 * `subject`. Returns null on any failure (fail-safe — callers degrade, never throw). Works
 * on Node and Workers. `now`/`skipCache` are test seams.
 */
export async function mintGoogleAccessToken(opts: {
  key: GoogleSaKey;
  subject: string;
  scopes: string[];
  now?: number;
  skipCache?: boolean;
}): Promise<string | null> {
  try {
    const nowS = opts.now ?? Math.floor(Date.now() / 1000);
    const cacheKey = `${opts.key.client_email}|${opts.subject}|${[...opts.scopes].sort().join(",")}`;
    if (!opts.skipCache) {
      const hit = tokenCache.get(cacheKey);
      if (hit && hit.expiresAt - 60 > nowS) return hit.accessToken; // 60s safety margin
    }
    const assertion = await buildGoogleJwtAssertion({ key: opts.key, subject: opts.subject, scopes: opts.scopes, now: opts.now });
    const json = await exchangeToken(assertion);
    if (!json || !json.access_token) return null;
    tokenCache.set(cacheKey, { accessToken: json.access_token, expiresAt: nowS + (json.expires_in ?? 3600) });
    return json.access_token;
  } catch (e) {
    console.error("[googleAuthWebCrypto] mint failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Drop a cached token (e.g. on a 401) so the next call re-mints. Mostly for tests. */
export function clearGoogleTokenCache(): void {
  tokenCache.clear();
}
