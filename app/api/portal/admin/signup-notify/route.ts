import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase, getAnonVerifyClient } from "@/lib/supabase";
import { requireUser } from "@/lib/admin-auth";

// Called client-side from /portal/auth/callback after a new user signs up.
// Requires the caller's verified JWT — both name and email come from the verified
// user object, NEVER from the request body (preventing arbitrary admin spam).
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // Pull display name from verified user metadata; never trust the body
  let displayName = auth.email;
  try {
    const { data } = await getAnonVerifyClient().auth.getUser(auth.jwt);
    const fullName = data?.user?.user_metadata?.full_name;
    if (typeof fullName === "string" && fullName.trim()) displayName = fullName.trim().slice(0, 200);
  } catch { /* fall back to email */ }

  // Idempotency: don't insert duplicate signup notifications for the same user
  const db = getServiceSupabase();
  const { data: existing } = await db
    .from("admin_notifications")
    .select("id")
    .eq("type", "signup")
    .eq("user_email", auth.email)
    .maybeSingle();
  if (existing) return NextResponse.json({ ok: true, already: true });

  await db.from("admin_notifications").insert({
    type:       "signup",
    user_name:  displayName,
    user_email: auth.email,
  });

  return NextResponse.json({ ok: true });
}
