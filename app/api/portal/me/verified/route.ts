import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { VERIFICATION_FILE_TYPES } from "@/lib/constants";

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
    const { data, error } = await db.auth.getUser(token);
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

  // 1) Manual override — admin can grant the blue tick directly.
  const { data: profile } = await db
    .from("candidate_profiles")
    .select("manually_verified")
    .eq("user_id", userId)
    .maybeSingle();
  if (profile && (profile as { manually_verified?: boolean }).manually_verified) {
    return NextResponse.json({ authenticated: true, verified: true, isAdmin: false });
  }

  // 2) Doc-based: passport approved + Lebenslauf approved
  const { data: docs } = await db
    .from("documents")
    .select("file_type,status")
    .eq("user_id", userId)
    .in("file_type", VERIFICATION_FILE_TYPES)
    .eq("status", "approved");

  const hasPassport = (docs ?? []).some(d => /pass/i.test(d.file_type));
  const hasCV       = (docs ?? []).some(d => /lebenslauf|cv/i.test(d.file_type));

  return NextResponse.json({
    authenticated: true,
    verified: hasPassport && hasCV,
    isAdmin: false,
  });
}
