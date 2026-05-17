import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireUser } from "@/lib/admin-auth";

// Marks Community as seen for the calling user (permanent, cross-device).
// Called when the user opens the Community tab. The unread count then only
// reflects feed activity newer than this timestamp — so the badge never
// reappears after logout/login or on another device once it's been read.
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ ok: false }, { status: 401 });

  const db = getServiceSupabase();
  const { error } = await db
    .from("community_seen")
    .upsert({ user_id: auth.userId, seen_at: new Date().toISOString() }, { onConflict: "user_id" });

  if (error) {
    console.error("[feed/seen] upsert failed:", error.message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
