/**
 * Short-lived, single-purpose DOWNLOAD token.
 *
 * Why this exists: iOS Safari cannot attach an Authorization header to a
 * top-level navigation / <iframe src> / anchor-download, so the file routes
 * used to accept the raw Supabase JWT in `?access_token=`. That JWT is a
 * ~1h full-API bearer credential — putting it in a URL leaks it into Vercel
 * access logs, the Referer header, and browser history → full account
 * takeover for the whole validity window.
 *
 * This token instead:
 *   • is minted from the verified header JWT (see /api/portal/dl-token),
 *   • carries ONLY the user id (no role, no API authority),
 *   • is HMAC-SHA256 signed with a server-only secret,
 *   • expires in ~3 minutes,
 *   • is accepted ONLY by the handful of file/PDF GET routes.
 * A leaked one is useless after 3 min and can never call /messages, /me,
 * admin routes, etc. — it only re-proves "this is user X" to a file route,
 * which still runs its own ownership / canActOnCandidate check.
 */

import crypto from "crypto";
import type { NextRequest } from "next/server";

// Server-only HMAC key. The service-role key is a long, high-entropy secret
// that already never leaves the server — reuse it so no new env is required.
// (DL_TOKEN_SECRET overrides if the operator prefers a dedicated key.)
function secret(): string {
  return (
    process.env.DL_TOKEN_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    ""
  );
}

const DEFAULT_TTL_SEC = 180;
export const DL_TOKEN_PARAM = "dlt";

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/**
 * Sign an arbitrary claim set with the same key and format as the download
 * token: base64url(JSON {...claims, e}) + "." + base64url(HMAC-SHA256).
 *
 * Other short-lived URL credentials (the R2 storage signed URLs in
 * lib/storage/storageToken.ts) reuse this instead of inventing a second
 * scheme. Each kind MUST carry claims the others lack — a download token has
 * `u` and no `p`; a storage token has `p` and no `u` — so one kind can never be
 * replayed as another, even though they share a key.
 */
export function signScopedToken(claims: Record<string, string>, ttlSec: number): string {
  const key = secret();
  if (!key) throw new Error("dlToken: no signing secret configured");
  const exp = Math.floor(Date.now() / 1000) + Math.max(1, Math.floor(ttlSec));
  const payload = b64url(Buffer.from(JSON.stringify({ ...claims, e: exp })));
  const sig = b64url(crypto.createHmac("sha256", key).update(payload).digest());
  return `${payload}.${sig}`;
}

export type ScopedTokenCheck =
  | { ok: true; claims: Record<string, unknown> }
  | { ok: false; reason: "invalid" | "expired" };

/** Verify signature + expiry of a token made by signScopedToken. The caller checks the claims. */
export function verifyScopedToken(token: string | null | undefined): ScopedTokenCheck {
  const key = secret();
  if (!token || !key) return { ok: false, reason: "invalid" };
  const dot = token.indexOf(".");
  if (dot <= 0) return { ok: false, reason: "invalid" };
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!payload || !sig) return { ok: false, reason: "invalid" };

  const expected = b64url(crypto.createHmac("sha256", key).update(payload).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: "invalid" };

  try {
    const obj = JSON.parse(b64urlDecode(payload).toString("utf8")) as Record<string, unknown>;
    if (!obj || typeof obj !== "object" || typeof obj.e !== "number") return { ok: false, reason: "invalid" };
    if (Math.floor(Date.now() / 1000) > obj.e) return { ok: false, reason: "expired" };
    return { ok: true, claims: obj };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

/** Mint a signed token for `userId`, valid for `ttlSec` seconds. */
export function signDlToken(userId: string, ttlSec: number = DEFAULT_TTL_SEC): string {
  return signScopedToken({ u: userId }, Math.max(30, ttlSec));
}

/** Verify a token. Returns { userId } or null (bad sig / expired / malformed). */
export function verifyDlToken(token: string | null | undefined): { userId: string } | null {
  const check = verifyScopedToken(token);
  if (!check.ok) return null;
  const u = check.claims.u;
  if (typeof u !== "string" || !u) return null;
  return { userId: u };
}

/**
 * Read + verify the download token from the request query (`?dlt=`).
 * Returns the userId or null. Pure (no DB) — for routes that only need to
 * key off the token-holder's OWN id (their own file / their own stash).
 */
export function dlTokenUserId(req: NextRequest): string | null {
  const t = req.nextUrl.searchParams.get(DL_TOKEN_PARAM);
  return verifyDlToken(t)?.userId ?? null;
}
