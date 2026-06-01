import { NextRequest, NextResponse } from "next/server";
import { verifyFeedToken } from "@/lib/calendarFeed";
import { completeConnect } from "@/lib/googleCalendar";
import { getServiceSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const SITE = (process.env.NEXT_PUBLIC_BASE_URL || "https://www.borivon.com").replace(/\/+$/, "");

// Google redirects the browser here after consent (no Bearer header — the
// signed `state` is the auth). Exchange the code, store the tokens, bounce back.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const back = (q: string) => NextResponse.redirect(`${SITE}/portal/calendar?google=${q}`);

  if (url.searchParams.get("error")) return back("denied");
  const code = url.searchParams.get("code");
  const userId = verifyFeedToken(url.searchParams.get("state") ?? "");
  if (!userId || !code) return back("error");

  try {
    // The supreme admin gets EVERY event pushed (mirrors the page/feed).
    let seesAll = false;
    try {
      const { data: u } = await getServiceSupabase().auth.admin.getUserById(userId);
      const email = (u?.user?.email ?? "").trim().toLowerCase();
      seesAll = !!email && email === (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
    } catch { /* default: only tagged/public events */ }

    await completeConnect(userId, code, seesAll);
    return back("connected");
  } catch (e) {
    console.error("[gcal callback] connect failed:", (e as Error)?.message);
    return back("error");
  }
}
