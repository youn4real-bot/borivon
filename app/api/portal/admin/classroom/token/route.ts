import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin-auth";
import { getServiceSupabase } from "@/lib/supabase";
import { livekitConfigured, livekitUrl, mintClassroomToken } from "@/lib/livekit";

/**
 * SUPREME-ADMIN-ONLY (testing phase): mint a LiveKit join token for a classroom
 * room + ensure a classroom_sessions row exists so telemetry can attach to it.
 * The LiveKit participant identity = the user's id, so every server webhook
 * event ties cleanly to a person.
 *
 * POST { room, name? } → { token, url, identity, sessionId }
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden — supreme admin only" }, { status: 403 });

  if (!livekitConfigured()) {
    return NextResponse.json({ error: "LiveKit not configured", needsSetup: true }, { status: 503 });
  }

  const body = await req.json().catch(() => ({})) as { room?: unknown; name?: unknown };
  const room = (typeof body.room === "string" && body.room.trim()) ? body.room.trim().slice(0, 80) : "borivon-class";
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "Admin";

  const db = getServiceSupabase();
  // Upsert the session row (one per room_name). Keep it "live".
  let sessionId: string | null = null;
  const { data: existing } = await db.from("classroom_sessions").select("id").eq("room_name", room).maybeSingle();
  if (existing) {
    sessionId = (existing as { id: string }).id;
  } else {
    const { data: created } = await db
      .from("classroom_sessions")
      .insert({ room_name: room, title: room, host_user_id: auth.userId, status: "live" })
      .select("id").maybeSingle();
    sessionId = (created as { id: string } | null)?.id ?? null;
  }

  const token = await mintClassroomToken({ room, identity: auth.userId, name, canPublish: true });
  return NextResponse.json({ token, url: livekitUrl(), identity: auth.userId, sessionId });
}
