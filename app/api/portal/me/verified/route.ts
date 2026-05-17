import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase, getAnonVerifyClient } from "@/lib/supabase";

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();

/**
 * Returns the caller's verification status. Used by the public profile
 * "Message Borivon" button to gate access:
 *   - verified candidates can message the admin directly
 *   - unverified candidates see "verify your profile first"
 *   - anyone with an existing thread can always reply (handled client-side by
 *     just opening the chat icon)
 *
 * 200 { authenticated, verified, isAdmin }
 * 401 if no/invalid token (treat as not authenticated client-side)
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return NextResponse.json({ authenticated: false, verified: false, isAdmin: false });
  }
  const db = getServiceSupabase();
  let userId = "";
  let userEmail = "";
  try {
    const { data, error } = await getAnonVerifyClient().auth.getUser(token);
    if (error || !data?.user) {
      return NextResponse.json({ authenticated: false, verified: false, isAdmin: false });
    }
    userId = data.user.id;
    userEmail = (data.user.email ?? "").toLowerCase();
  } catch {
    return NextResponse.json({ authenticated: false, verified: false, isAdmin: false });
  }

  const isAdmin = !!ADMIN_EMAIL && userEmail === ADMIN_EMAIL;
  if (isAdmin) {
    return NextResponse.json({ authenticated: true, verified: true, isAdmin: true });
  }

  // Verification is tied ONLY to (1) an explicit supreme-admin grant
  // (manually_verified) or (2) a paid premium subscription. Passport
  // approval no longer confers the gold tick.
  const { data: profile } = await db
    .from("candidate_profiles")
    .select("manually_verified, payment_tier")
    .eq("user_id", userId)
    .maybeSingle() as { data: { manually_verified?: boolean | null; payment_tier?: string | null } | null };

  const verified = !!profile?.manually_verified || profile?.payment_tier === "premium";

  return NextResponse.json({
    authenticated: true,
    verified,
    isAdmin: false,
  });
}
