/**
 * In-process token-bucket rate limiter.
 *
 * Purpose: slow down brute-force and abuse on sensitive endpoints (uploads,
 * messages, signature requests, anything that hits external APIs or storage).
 *
 * Trade-offs of "in-process":
 *   - Per-Lambda-instance state. Vercel may spin up multiple concurrent
 *     instances under load, so the effective limit per attacker is
 *     `LIMIT * concurrent_instances`. For a determined attacker that's not
 *     enough, but it cheaply blocks the 99% case (script kiddies, accidental
 *     loops, runaway clients).
 *   - State is lost on cold start. Acceptable.
 *
 * If we ever need a strict shared limit, swap the backing Map with
 * @upstash/ratelimit + Vercel KV. The API of `enforce()` won't change.
 *
 * Usage in a route:
 *
 *   import { enforceRateLimit } from "@/lib/rateLimit";
 *   const rl = enforceRateLimit(req, "upload", { limit: 30, windowMs: 60_000 });
 *   if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
 */

import type { NextRequest } from "next/server";

type Bucket = { count: number; resetAt: number };

// Map<key, Bucket>. Keys look like `<bucket>:<ip>`. The Map self-prunes
// lazily — entries are removed on access when their resetAt has passed.
const buckets = new Map<string, Bucket>();

// Lazy GC — every Nth call, drop expired entries to keep the map bounded.
let opsSinceGc = 0;
function maybeGc(now: number) {
  if (++opsSinceGc < 200) return;
  opsSinceGc = 0;
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key);
  }
}

/**
 * Extract a TRUSTED client identifier.
 *
 * SECURITY: never key off the leftmost `x-forwarded-for` entry — the caller
 * fully controls it and Vercel only *appends* the real hop, so an attacker
 * rotates a fake first IP every request and gets unlimited buckets,
 * defeating the limiter entirely.
 *
 * `x-vercel-forwarded-for` and `x-real-ip` are injected by Vercel's edge and
 * are NOT overridable by the client (the edge discards any inbound value and
 * sets the true client IP). Use those only. If neither is present (non-Vercel
 * runtime / direct hit), fall back to a single shared "unknown" bucket so
 * abuse is still throttled rather than unbounded.
 */
function clientId(req: NextRequest): string {
  const vercel = req.headers.get("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",")[0]!.trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  // Off-Vercel fallback: the RIGHTMOST x-forwarded-for entry is the hop
  // closest to our server (added by the trusted proxy in front), never the
  // client-controlled leftmost — so it can't be spoofed to rotate buckets,
  // and it avoids collapsing every client into one shared "unknown" bucket
  // (which would self-DoS all legit traffic). Still defense-in-depth only;
  // on Vercel we never reach here.
  const xfwd = req.headers.get("x-forwarded-for");
  if (xfwd) {
    const parts = xfwd.split(",").map(s => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1]!;
  }
  return "unknown";
}

export type RateLimitOptions = {
  /** Max requests inside the window. */
  limit: number;
  /** Window in milliseconds. */
  windowMs: number;
};

export type RateLimitResult =
  | { ok: true;  remaining: number; resetAt: number }
  | { ok: false; retryAfterSec: number; resetAt: number };

/**
 * Increments the bucket for (req-client × bucketName) and returns whether
 * the call is allowed.
 *
 * Pass `bucketName` to namespace different routes (e.g. "upload", "msg-send",
 * "sign") so a heavy use of one doesn't starve another.
 */
export function enforceRateLimit(
  req: NextRequest,
  bucketName: string,
  opts: RateLimitOptions,
): RateLimitResult {
  const now = Date.now();
  maybeGc(now);

  const key = `${bucketName}:${clientId(req)}`;
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    const resetAt = now + opts.windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { ok: true, remaining: opts.limit - 1, resetAt };
  }

  if (existing.count >= opts.limit) {
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
      resetAt: existing.resetAt,
    };
  }

  existing.count += 1;
  return { ok: true, remaining: opts.limit - existing.count, resetAt: existing.resetAt };
}

/**
 * Distributed (cross-instance) rate limit backed by Vercel KV / Upstash
 * Redis over its REST API — for the few endpoints where the cap must be a
 * HARD global guarantee, not `limit × live-Lambda-instances`.
 *
 * Why this exists: the in-process limiter above is per-instance, so a burst
 * spread across a scaled-out Vercel fleet beats the nominal cap (proven on
 * prod). The truly sensitive endpoints (account-existence oracle, invite
 * redemption / privilege escalation, org self-join) need a shared counter.
 *
 * Degradation contract — never breaks legit traffic:
 *   • No KV env configured       → falls back to the in-process limiter.
 *   • KV unreachable / errors    → falls back to the in-process limiter.
 * So this is safe to ship BEFORE the KV store is provisioned; it simply
 * upgrades itself the moment the env vars appear (Vercel KV integration
 * auto-injects KV_REST_API_URL / KV_REST_API_TOKEN; Upstash equivalents
 * also accepted). `enforce()`-style call sites only change sync → await.
 *
 * Fixed-window counter via an atomic Upstash pipeline:
 *   INCR key ; PEXPIRE key windowMs ; PTTL key
 * PEXPIRE is unconditional (no NX) so a TTL is ALWAYS set — a key can never
 * leak into a permanent bucket that would lock a user out forever.
 */
function kvCreds(): { url: string; token: string } | null {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
  if (url && token) return { url: url.replace(/\/+$/, ""), token };
  return null;
}

export async function enforceRateLimitDistributed(
  req: NextRequest,
  bucketName: string,
  opts: RateLimitOptions,
): Promise<RateLimitResult> {
  const creds = kvCreds();
  if (!creds) return enforceRateLimit(req, bucketName, opts); // not provisioned

  const key = `rl:${bucketName}:${clientId(req)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 800);
  try {
    const res = await fetch(`${creds.url}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        ["INCR", key],
        ["PEXPIRE", key, String(opts.windowMs)],
        ["PTTL", key],
      ]),
      cache: "no-store",
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return enforceRateLimit(req, bucketName, opts);

    const arr = (await res.json()) as Array<{ result?: number; error?: string }>;
    const count = typeof arr?.[0]?.result === "number" ? arr[0].result : null;
    if (count == null) return enforceRateLimit(req, bucketName, opts);

    let pttl = typeof arr?.[2]?.result === "number" ? arr[2].result : -1;
    if (pttl < 0) pttl = opts.windowMs;
    const resetAt = Date.now() + pttl;

    if (count > opts.limit) {
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil(pttl / 1000)), resetAt };
    }
    return { ok: true, remaining: Math.max(0, opts.limit - count), resetAt };
  } catch {
    clearTimeout(timer);
    return enforceRateLimit(req, bucketName, opts); // timeout / network / abort
  }
}
