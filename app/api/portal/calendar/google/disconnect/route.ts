import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/admin-auth";
import { disconnect } from "@/lib/googleCalendar";

// Forget this user's Google tokens (stops the instant push).
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  await disconnect(auth.userId);
  return NextResponse.json({ ok: true });
}
