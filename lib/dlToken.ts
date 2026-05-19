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

/** Mint a signed token for `userId`, valid for `ttlSec` seconds. */
export function signDlToken(userId: string, ttlSec: number = DEFAULT_TTL_SEC): string {
  const key = secret();
  if (!key) throw new Error("dlToken: no signing secret configured");
  const exp = Math.floor(Date.now() / 1000) + Math.max(30, ttlSec);
  const payload = b64url(Buffer.from(JSON.stringify({ u: userId, e: exp })));
  const sig = b64url(crypto.createHmac("sha256", key).update(payload).digest());
  return `${payload}.${sig}`;
}

/** Verify a token. Returns { userId } or null (bad sig / expired / malformed). */
export function verifyDlToken(token: string | null | undefined): { userId: string } | null {
  const key = secret();
  if (!token || !key) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!payload || !sig) return null;

  const expected = b64url(crypto.createHmac("sha256", key).update(payload).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const obj = JSON.parse(b64urlDecode(payload).toString("utf8")) as { u?: unknown; e?: unknown };
    if (typeof obj.u !== "string" || !obj.u) return null;
    if (typeof obj.e !== "number") return null;
    if (Math.floor(Date.now() / 1000) > obj.e) return null;
    return { userId: obj.u };
  } catch {
    return null;
  }
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
