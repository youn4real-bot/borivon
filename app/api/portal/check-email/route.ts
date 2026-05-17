import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { enforceRateLimitDistributed } from "@/lib/rateLimit";

// POST { email } → { exists: boolean }
// Used by the signup form to block re-registration for existing accounts.
// Uses service role so it can query auth.users without RLS.
export async function POST(req: NextRequest) {
  // This is an unauthenticated account-existence pre-check for the signup
  // form. It can't be made a non-oracle (Supabase's own signUp already
  // rejects duplicates and leaks the same fact), but the two real risks are
  // closed here:
  //   1. Brute-force / enumeration → hard per-IP throttle. The limiter now
  //      keys off a Vercel-trusted IP (see lib/rateLimit.ts) so this 6/min
  //      is actually unspoofable, not bypassable by rotating X-Forwarded-For.
  //   2. DoS amplification → the old `while(true)` scanned the ENTIRE
  //      auth.users table on every miss (unbounded work per request). Cap
  //      the scan: a miss past the cap just returns "available" and Supabase
  //      signUp rejects the dup anyway — UX degrades, no security loss.
  const rl = await enforceRateLimitDistributed(req, "check-email", { limit: 6, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { exists: false },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  const body = await req.json().catch(() => ({}));
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email) return NextResponse.json({ exists: false });

  const db = getServiceSupabase();
  const PER_PAGE = 50;
  const MAX_PAGES = 40; // bound the work at 2000 users / request
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error) return NextResponse.json({ exists: false });
    const users = data?.users ?? [];
    if (users.some(u => (u.email ?? "").toLowerCase() === email)) {
      return NextResponse.json({ exists: true });
    }
    if (users.length < PER_PAGE) break;
  }
  return NextResponse.json({ exists: false });
}
