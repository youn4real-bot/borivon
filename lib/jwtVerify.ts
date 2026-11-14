/**
 * Local check of a Supabase access token — no network call per request.
 *
 * Every logged-in API call used to ask Supabase whether its token was good
 * (auth.getUser(jwt): 0.9–2.6 s from the Worker, measured live, vs 0.17 s for a
 * call without a token). The project signs access tokens with an asymmetric
 * ES256 key and publishes the PUBLIC half at
 * <SUPABASE_URL>/auth/v1/.well-known/jwks.json, so the same signature check runs
 * here with WebCrypto in well under a millisecond. (Supabase's own
 * auth.getClaims() does the same; this one also pins iss / aud / role and does
 * not refetch the key set for every unknown kid.)
 *
 * Three verdicts, never two:
 *   valid         a published key signed exactly these bytes and every claim
 *                 fits → the claims can be trusted.
 *   invalid       DEFINITIVE: a published key says the signature is wrong, or
 *                 the token is expired, for another issuer / audience, has no
 *                 subject, or is garbled → 401, no network.
 *   inconclusive  this code cannot decide: not an ES256 token (a legacy HS256
 *                 one, "none", a test stub), its kid is not published even
 *                 after one refetch, the key set is unreachable, WebCrypto
 *                 failed, an unexpected role → the caller asks Supabase, i.e.
 *                 exactly the path every request took before. Worst case =
 *                 yesterday's behaviour.
 *
 * The algorithm is OURS (ES256 only), never taken from the header, so
 * alg:"none" or HS256-signed-with-the-public-key never reach crypto.subtle.
 *
 * Claims are from MINT time: a deleted account's token stays valid until it
 * expires. lib/authVerify.ts closes that (D1 revoked list + a background
 * re-check) — use verifyAccessToken there, not this module, to authenticate.
 */
import { scheduleBackground } from "@/lib/d1/background";

export type SupabaseJwtClaims = {
  sub: string;
  exp: number;
  iat?: number;
  iss: string;
  aud: string | string[];
  role: string;
  email?: string;
  phone?: string;
  session_id?: string;
  is_anonymous?: boolean;
  aal?: string;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
  [claim: string]: unknown;
};

export type JwtVerdict =
  | { kind: "valid"; claims: SupabaseJwtClaims }
  | { kind: "invalid"; reason: string }
  | { kind: "inconclusive"; reason: string };

/** Clock leeway for exp / nbf, in seconds. */
export const CLOCK_LEEWAY_SEC = 30;
/** How long a fetched key set is trusted (Supabase's own client uses 10 min too). */
export const JWKS_TTL_MS = 10 * 60_000;
/** An unknown kid refetches the key set only if our copy is at least this old: random kids cannot hammer the endpoint. */
export const JWKS_REFETCH_MIN_MS = 30_000;
/** After a failed fetch, tokens go straight to Supabase for this long instead of retrying on every request. */
export const JWKS_FAIL_BACKOFF_MS = 5_000;
const JWKS_TIMEOUT_MS = 3_000;
const MAX_TOKEN_CHARS = 16_384;
const AUDIENCE = "authenticated";

const invalid = (reason: string): JwtVerdict => ({ kind: "invalid", reason });
const inconclusive = (reason: string): JwtVerdict => ({ kind: "inconclusive", reason });

function supabaseBase(): string {
  return (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
}

/* ── base64url / JSON ──────────────────────────────────────────────────────── */

const B64URL = /^[A-Za-z0-9_-]+$/;

function b64urlBytes(s: string): Uint8Array<ArrayBuffer> | null {
  if (!B64URL.test(s) || s.length % 4 === 1) return null;
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function jsonPart(s: string): Record<string, unknown> | null {
  const bytes = b64urlBytes(s);
  if (!bytes) return null;
  try {
    const v: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/* ── the key set (module scope = one copy per isolate) ─────────────────────── */

type KeySet = { url: string; keys: Map<string, CryptoKey>; at: number };
let keySet: KeySet | null = null;
let loading: Promise<KeySet | null> | null = null;
let failedAt = 0;

/** Only P-256 signing keys, imported once per fetch. Anything else is skipped, never trusted. */
async function importKeys(raw: unknown): Promise<Map<string, CryptoKey>> {
  const out = new Map<string, CryptoKey>();
  if (!Array.isArray(raw)) return out;
  for (const item of raw.slice(0, 16)) {
    if (!item || typeof item !== "object") continue;
    const j = item as Record<string, unknown>;
    if (j.kty !== "EC" || j.crv !== "P-256" || typeof j.kid !== "string" || !j.kid) continue;
    if (typeof j.x !== "string" || typeof j.y !== "string") continue;
    if (j.alg !== undefined && j.alg !== "ES256") continue;
    if (j.use !== undefined && j.use !== "sig") continue;
    if (j.key_ops !== undefined && !(Array.isArray(j.key_ops) && j.key_ops.includes("verify"))) continue;
    try {
      const key = await crypto.subtle.importKey(
        "jwk",
        { kty: "EC", crv: "P-256", x: j.x, y: j.y },
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"],
      );
      out.set(j.kid, key);
    } catch {
      /* a key WebCrypto refuses is simply not usable */
    }
  }
  return out;
}

async function fetchKeySet(url: string): Promise<KeySet | null> {
  try {
    const timeout = typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(JWKS_TIMEOUT_MS) : undefined;
    const res = await fetch(url, { headers: { accept: "application/json" }, signal: timeout });
    if (!res.ok) {
      console.warn(`[jwtVerify] JWKS fetch answered ${res.status}; tokens go to Supabase meanwhile`);
      return null;
    }
    const body = (await res.json()) as { keys?: unknown } | null;
    return { url, keys: await importKeys(body?.keys), at: Date.now() };
  } catch (e) {
    console.warn("[jwtVerify] JWKS fetch failed; tokens go to Supabase meanwhile:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

/**
 * Concurrent callers share ONE fetch. A failed fetch keeps the previous copy. Never rejects.
 * The fetch is also handed to waitUntil: on Workers it belongs to the request that started it,
 * and if that client hung up mid-fetch the other requests awaiting it would never be answered.
 */
function loadKeySet(url: string): Promise<KeySet | null> {
  if (loading) return loading;
  const p = fetchKeySet(url).then((set) => {
    if (set) { keySet = set; failedAt = 0; } else failedAt = Date.now();
    return set;
  });
  loading = p;
  void p.finally(() => { if (loading === p) loading = null; });
  scheduleBackground(async () => { await p; });
  return p;
}

type KeyLookup = { key: CryptoKey } | { miss: "jwks_unreachable" | "unknown_kid" };

async function keyFor(kid: string, url: string): Promise<KeyLookup> {
  const now = Date.now();
  const cached = keySet && keySet.url === url ? keySet : null;
  if (cached && now - cached.at < JWKS_TTL_MS) {
    const key = cached.keys.get(kid);
    if (key) return { key };
    // Not in a fresh copy: maybe published since (key rotation) → one refetch, but
    // never more often than JWKS_REFETCH_MIN_MS — a just-fetched copy is current.
    if (now - cached.at < JWKS_REFETCH_MIN_MS) return { miss: "unknown_kid" };
  }
  if (failedAt && now - failedAt < JWKS_FAIL_BACKOFF_MS) return { miss: "jwks_unreachable" };
  const set = await loadKeySet(url);
  if (!set || set.url !== url) return { miss: "jwks_unreachable" };
  const key = set.keys.get(kid);
  return key ? { key } : { miss: "unknown_kid" };
}

/* ── the check ─────────────────────────────────────────────────────────────── */

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function checkClaims(c: Record<string, unknown>, issuer: string, nowSec: number): JwtVerdict {
  if (!isNum(c.exp)) return invalid("no_exp");
  if (nowSec > c.exp + CLOCK_LEEWAY_SEC) return invalid("expired");
  if (c.nbf !== undefined && (!isNum(c.nbf) || nowSec + CLOCK_LEEWAY_SEC < c.nbf)) return invalid("not_yet_valid");
  if (c.iat !== undefined && !isNum(c.iat)) return invalid("bad_iat");
  if (c.iss !== issuer) return invalid("issuer");
  const aud = c.aud;
  if (!(aud === AUDIENCE || (Array.isArray(aud) && aud.includes(AUDIENCE)))) return invalid("audience");
  if (typeof c.sub !== "string" || !c.sub.trim()) return invalid("no_sub");
  // Every logged-in user's token says "authenticated". Anything else is not ours to
  // judge locally: Supabase decides, exactly as before.
  if (c.role !== "authenticated") return inconclusive("role");
  return { kind: "valid", claims: c as SupabaseJwtClaims };
}

/** Verify a Supabase access token locally. Never throws. */
export async function verifySupabaseJwt(token: string): Promise<JwtVerdict> {
  try {
    const base = supabaseBase();
    if (!base) return inconclusive("no_supabase_url");
    if (typeof token !== "string" || token.length > MAX_TOKEN_CHARS) return inconclusive("not_a_jwt");
    const parts = token.split(".");
    if (parts.length !== 3) return inconclusive("not_a_jwt");
    const [h, p, s] = parts;
    const header = jsonPart(h);
    if (!header) return inconclusive("not_a_jwt");
    if (header.alg !== "ES256") return inconclusive("alg_not_es256");
    if (header.crit !== undefined) return inconclusive("crit"); // extensions we do not implement
    if (typeof header.kid !== "string" || !header.kid) return inconclusive("no_kid");

    const found = await keyFor(header.kid, `${base}/auth/v1/.well-known/jwks.json`);
    if ("miss" in found) return inconclusive(found.miss);

    // From here a PUBLISHED key decides: whatever is wrong is definitive.
    const sig = b64urlBytes(s);
    if (!sig || sig.length !== 64) return invalid("malformed_signature"); // ES256 in a JWS = raw r||s, 32 + 32 bytes
    let good: boolean;
    try {
      good = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, found.key, sig, new TextEncoder().encode(`${h}.${p}`));
    } catch {
      return inconclusive("webcrypto_error");
    }
    if (!good) return invalid("bad_signature");
    const claims = jsonPart(p);
    if (!claims) return invalid("malformed_payload");
    return checkClaims(claims, `${base}/auth/v1`, Math.floor(Date.now() / 1000));
  } catch {
    return inconclusive("verifier_error");
  }
}

/** Tests: forget the cached key set. */
export function resetJwksCacheForTests(): void {
  keySet = null;
  loading = null;
  failedAt = 0;
}
