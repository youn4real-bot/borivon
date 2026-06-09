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
 * POST { room, name?, openToCandidates?, invitedUserIds? } →
 *   { token, url, identity, sessionId, invited }
 * invitedUserIds: candidates the admin assigned to this class — each is recorded
 * as an invite (so they're allowed to join) and gets a bell notification that
 * deep-links straight into the live room.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden — supreme admin only" }, { status: 403 });

  if (!livekitConfigured()) {
    return NextResponse.json({ error: "LiveKit not configured", needsSetup: true }, { status: 503 });
  }

  const body = await req.json().catch(() => ({})) as { room?: unknown; name?: unknown; openToCandidates?: unknown; invitedUserIds?: unknown };
  const room = (typeof body.room === "string" && body.room.trim()) ? body.room.trim().slice(0, 80) : "borivon-class";
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "Admin";
  const invitedUserIds = Array.isArray(body.invitedUserIds)
    ? Array.from(new Set(body.invitedUserIds.filter((x): x is string => typeof x === "string" && UUID_RE.test(x)))).slice(0, 200)
    : [];
  // Assigning candidates implies the class is open to them.
  const openToCandidates = body.openToCandidates === true || invitedUserIds.length > 0;

  const db = getServiceSupabase();
  // Upsert the session row (one per room_name). Keep it "live" + carry the
  // admin's open-to-candidates choice so the candidate join gate can honor it.
  let sessionId: string | null = null;
  const { data: existing } = await db.from("classroom_sessions").select("id").eq("room_name", room).maybeSingle();
  if (existing) {
    sessionId = (existing as { id: string }).id;
    await db.from("classroom_sessions").update({ status: "live", open_to_candidates: openToCandidates }).eq("id", sessionId);
  } else {
    const { data: created } = await db
      .from("classroom_sessions")
      .insert({ room_name: room, title: room, host_user_id: auth.userId, status: "live", open_to_candidates: openToCandidates })
      .select("id").maybeSingle();
    sessionId = (created as { id: string } | null)?.id ?? null;
  }

  // Record invites + fire a "live class is starting" notification per candidate.
  // Notification action="live_class", doc_id=room → bell deep-links to
  // /portal/classroom?room=<room> → auto-joins. Best-effort (never block start).
  if (sessionId && invitedUserIds.length) {
    try {
      await db.from("classroom_invites").upsert(
        invitedUserIds.map((uid) => ({ session_id: sessionId, user_id: uid })),
        { onConflict: "session_id,user_id" },
      );
      await db.from("notifications").insert(
        invitedUserIds.map((uid) => ({
          user_id: uid,
          doc_id: room,
          doc_name: room,
          doc_type: "live_class",
          action: "live_class",
          feedback: null,
          read: false,
        })),
      );
    } catch (e) {
      console.error("[classroom/token] invite/notify failed (non-fatal):", e instanceof Error ? e.message : e);
    }
  }

  const token = await mintClassroomToken({ room, identity: auth.userId, name, canPublish: true });
  return NextResponse.json({ token, url: livekitUrl(), identity: auth.userId, sessionId, invited: invitedUserIds.length });
}
