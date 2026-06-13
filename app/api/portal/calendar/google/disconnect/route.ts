import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/admin-auth";
import { disconnect } from "@/lib/googleCalendar";
import { enforceUserRateLimit } from "@/lib/rateLimit";

// Forget this user's Google tokens (stops the instant push).
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const rl = await enforceUserRateLimit("gcal", `u:${auth.userId}`, { limit: 5, windowMs: 60000 });
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  await disconnect(auth.userId);
  return NextResponse.json({ ok: true });
}
