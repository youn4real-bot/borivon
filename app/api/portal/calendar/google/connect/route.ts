import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/admin-auth";
import { googleOAuthConfigured, buildAuthUrl } from "@/lib/googleCalendar";
import { signFeedToken } from "@/lib/calendarFeed";

// Start the Google connect flow: returns the consent URL for the client to
// navigate to. `state` is a signed userId so the callback can trust it.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!googleOAuthConfigured()) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  return NextResponse.json({ url: buildAuthUrl(signFeedToken(auth.userId)) });
}
