import { NextRequest, NextResponse } from "next/server";
import { verifyFeedToken } from "@/lib/calendarFeed";
import { completeGmailConnect } from "@/lib/gmailSignature";
import { enforceRateLimitDistributed } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// Google redirects the browser here after the founder grants read-only access to
// their Gmail signature. No Bearer header (it's a browser navigation) — the
// signed `state` (the admin's userId) IS the auth, exactly like the calendar flow.
export async function GET(req: NextRequest) {
  const rl = await enforceRateLimitDistributed(req, "gmailsig-cb", { limit: 30, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });

  const url = new URL(req.url);
  const page = (msg: string) =>
    new NextResponse(
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
        `<body style="font-family:-apple-system,'Segoe UI',sans-serif;padding:48px 24px;text-align:center;color:#1a1a1a">` +
        `<h2 style="font-size:20px">${msg}</h2><p style="color:#666">You can close this tab and go back to Telegram.</p></body>`,
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );

  if (url.searchParams.get("error")) return page("❌ Connection cancelled.");
  const code = url.searchParams.get("code");
  const userId = verifyFeedToken(url.searchParams.get("state") ?? "");
  if (!userId || !code) return page("❌ Invalid or expired link — connect again from Telegram.");

  try {
    const r = await completeGmailConnect(userId, code);
    return page(
      r.hasSignature
        ? "✅ Gmail signature connected — the bot will now use your real signature."
        : "✅ Connected, but no signature was found in your Gmail settings. Add one in Gmail, then send \"refresh my gmail signature\" to the bot.",
    );
  } catch (e) {
    console.error("[gmailSig callback] connect failed:", (e as Error)?.message);
    return page("❌ Couldn't connect — please try again from Telegram.");
  }
}
