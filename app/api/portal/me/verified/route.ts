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
    .select("manually_verified, passport_status")
    .eq("user_id", userId)
    .maybeSingle() as { data: { manually_verified?: boolean | null; passport_status?: string | null } | null };
  if (profile?.manually_verified) {
    return NextResponse.json({ authenticated: true, verified: true, isAdmin: false });
  }

  // 2) Doc-based: passport file approved + passport data (passport_status) approved
  const { data: docs } = await db
    .from("documents")
    .select("file_type,status")
    .eq("user_id", userId)
    .ilike("file_type", "%pass%")
    .eq("status", "approved");

  const hasPassportDoc = (docs ?? []).length > 0;
  const hasPassportData = profile?.passport_status === "approved";

  return NextResponse.json({
    authenticated: true,
    verified: hasPassportDoc && hasPassportData,
    isAdmin: false,
  });
}
