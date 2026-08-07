import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase, getAnonVerifyClient } from "@/lib/supabase";
import { requireUser } from "@/lib/admin-auth";
import { tgSend, telegramConfigured } from "@/lib/telegram";
import { isAutomationEnabled } from "@/lib/automationSettings";

// Called client-side from /portal/auth/callback after a new user signs up.
// Requires the caller's verified JWT — both name and email come from the verified
// user object, NEVER from the request body (preventing arbitrary admin spam).
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // Pull display name + phone from verified user metadata; never trust the body
  let displayName = auth.email;
  let phone = "";
  try {
    const { data } = await getAnonVerifyClient().auth.getUser(auth.jwt);
    const fullName = data?.user?.user_metadata?.full_name;
    if (typeof fullName === "string" && fullName.trim()) displayName = fullName.trim().slice(0, 200);
    const rawPhone = data?.user?.user_metadata?.phone;
    if (typeof rawPhone === "string" && rawPhone.trim()) phone = rawPhone.trim().slice(0, 40);
  } catch { /* fall back to email */ }

  const db = getServiceSupabase();

  // Persist the registration phone onto the candidate's profile row. This is the
  // only safe path: candidate_profiles is service-role-only (RLS, no policy) and
  // at signup there's no client session that could write it. Upsert by user_id
  // sets ONLY phone — never clobbers names/photo the candidate fills in later.
  if (phone) {
    try {
      await db.from("candidate_profiles").upsert(
        { user_id: auth.userId, phone },
        { onConflict: "user_id", ignoreDuplicates: false },
      );
    } catch { /* best-effort — phone also lives in user_metadata as a backup */ }
  }

  // Idempotency: don't insert duplicate signup notifications for the same user
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

  // Instant Telegram ping to the founder (best-effort; gated by the signup_ping
  // automation switch). Never block the signup response on it.
  //
  // NOT gated on the quiet switch any more. Quiet means "stop REMINDING me" —
  // briefings, nudges, chases, the things the bot invents to say. A nurse
  // creating an account is not the bot's opinion, it is an arrival, and it is
  // the same category as a new lead. The mute has been on since 14 July and
  // swallowed every signup ping in that window; each one still landed in the
  // portal bell, but the founder only sees that when he happens to look, which
  // is exactly the problem the ping exists to solve. `signup_ping` remains the
  // switch for turning these off deliberately.
  try {
    const chatId = (process.env.TELEGRAM_CHAT_ID || "").trim();
    if (chatId && telegramConfigured() && (await isAutomationEnabled("signup_ping"))) {
      await tgSend(chatId, `🆕 New candidate signed up: ${displayName}${phone ? ` (${phone})` : ""} — ${auth.email}`);
    }
  } catch { /* never block signup on a ping failure */ }

  return NextResponse.json({ ok: true });
}
