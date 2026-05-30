/**
 * ACADEMY — Daily.co integration (SERVER ONLY). Auto-attendance for live classes.
 *
 * INERT UNTIL CONFIGURED: every function no-ops / returns null when
 * DAILY_API_KEY is absent, so this ships safely before the founder creates a
 * Daily account. The moment DAILY_API_KEY (+ DAILY_WEBHOOK_SECRET for the
 * webhook) exist in the environment, live video + auto-attendance activate with
 * zero code change.
 *
 * Flow:
 *   start_session  → createRoom() → store url + room name on the session
 *   candidate joins → meetingToken() mints a token carrying their borivon
 *                     user_id, so Daily's webhook can attribute attendance
 *   participant.left webhook → verifyDailyWebhook() → write academy_attendance
 *
 * NEVER import in a client component (uses the secret API key).
 */
import crypto from "crypto";

const API = "https://api.daily.co/v1";
const KEY = process.env.DAILY_API_KEY ?? "";
const WEBHOOK_SECRET = process.env.DAILY_WEBHOOK_SECRET ?? "";

const SIX_HOURS = 6 * 60 * 60;

export function dailyEnabled(): boolean {
  return !!KEY;
}

async function dapi(path: string, init: RequestInit): Promise<Response | null> {
  if (!KEY) return null;
  try {
    return await fetch(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
  } catch {
    return null;
  }
}

/** Create a private, auto-expiring room for one class. Returns null if unconfigured. */
export async function createRoom(): Promise<{ url: string; name: string } | null> {
  const res = await dapi("/rooms", {
    method: "POST",
    body: JSON.stringify({
      privacy: "private",
      properties: {
        exp: Math.floor(Date.now() / 1000) + SIX_HOURS,
        enable_chat: true,
        enable_knocking: false,
        eject_at_room_exp: true,
      },
    }),
  });
  if (!res || !res.ok) return null;
  const j = await res.json().catch(() => null);
  return j?.url && j?.name ? { url: j.url, name: j.name } : null;
}

/**
 * Mint a meeting token that pins the candidate's borivon user_id onto their
 * Daily participant, so the participant.left webhook can attribute attendance.
 * Returns null if unconfigured (caller falls back to the plain room url).
 */
export async function meetingToken(roomName: string, opts: { userId: string; userName: string; isOwner?: boolean }): Promise<string | null> {
  const res = await dapi("/meeting-tokens", {
    method: "POST",
    body: JSON.stringify({
      properties: {
        room_name: roomName,
        user_id: opts.userId,
        user_name: opts.userName || "Student",
        is_owner: !!opts.isOwner,
        exp: Math.floor(Date.now() / 1000) + SIX_HOURS,
      },
    }),
  });
  if (!res || !res.ok) return null;
  const j = await res.json().catch(() => null);
  return j?.token ?? null;
}

/**
 * Verify a Daily webhook. Daily signs with HMAC-SHA256 over
 * `${timestamp}.${rawBody}` using the per-endpoint HMAC secret, base64-encoded.
 * Fail-closed: returns false if the secret is unset or anything mismatches.
 */
export function verifyDailyWebhook(rawBody: string, timestamp: string | null, signature: string | null): boolean {
  if (!WEBHOOK_SECRET || !timestamp || !signature) return false;
  try {
    const expected = crypto
      .createHmac("sha256", Buffer.from(WEBHOOK_SECRET, "base64"))
      .update(`${timestamp}.${rawBody}`)
      .digest("base64");
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function webhookConfigured(): boolean {
  return !!WEBHOOK_SECRET;
}
