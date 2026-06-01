import crypto from "crypto";
import { UUID_RE } from "@/lib/uuid";

/**
 * Signed tokens for the per-user calendar subscription feed.
 *
 * A user's feed URL is `…/api/portal/calendar/feed/<token>.ics` where
 * token = `<userId>.<sig>` and sig = HMAC(userId). The feed endpoint can't use
 * a Bearer header (calendar apps just GET the URL), so the token IS the auth:
 * only someone holding the server secret can mint a token for a given userId,
 * so a subscriber can only ever read their OWN events.
 *
 * The signing key is DERIVED from SUPABASE_SERVICE_ROLE_KEY (key separation via
 * a labelled HMAC) so there's no extra env var to configure. The token is
 * stable per user; treat the URL as a secret (same as any ICS subscription).
 */

function feedKey(): Buffer {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.CALENDAR_FEED_SECRET || "";
  // Derive a dedicated key so the raw service-role secret is never used directly.
  return crypto.createHmac("sha256", secret).update("borivon-calendar-feed-v1").digest();
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function sigFor(userId: string): string {
  return b64url(crypto.createHmac("sha256", feedKey()).update(userId).digest());
}

/** Mint a stable, signed feed token for a user. */
export function signFeedToken(userId: string): string {
  return `${userId}.${sigFor(userId)}`;
}

/** Verify a feed token (optionally with a trailing `.ics`) → userId or null. */
export function verifyFeedToken(raw: string): string | null {
  const token = (raw || "").replace(/\.ics$/i, "");
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const userId = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!UUID_RE.test(userId)) return null;
  const expected = sigFor(userId);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  return crypto.timingSafeEqual(a, b) ? userId : null;
}
