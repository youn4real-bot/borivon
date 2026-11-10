import { NextRequest, NextResponse } from "next/server";
import { endSession, clearCookie, sameOrigin } from "@/lib/facility/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await endSession(req).catch(() => {});
  return NextResponse.json({ ok: true }, { headers: { "Set-Cookie": clearCookie(), "Cache-Control": "no-store" } });
}
