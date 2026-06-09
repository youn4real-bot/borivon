import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { livekitConfigured, getWebhookReceiver } from "@/lib/livekit";

/**
 * LiveKit server webhook → server-VERIFIED telemetry (the source of truth for
 * attendance; the client logs can be tampered with, these can't). Configure this
 * URL in your LiveKit project's webhook settings:
 *   https://www.borivon.com/api/portal/admin/classroom/webhook
 *
 * No user auth — authenticity is proven by the signed Authorization header
 * (WebhookReceiver verifies it against the API key/secret). MUST read the RAW
 * body for the signature to validate.
 */
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!livekitConfigured()) return NextResponse.json({ ok: true }); // dormant

  const raw = await req.text();
  const authHeader = req.headers.get("authorization") ?? undefined;

  let event: { event?: string; room?: { name?: string }; participant?: { identity?: string; name?: string } };
  try {
    event = await getWebhookReceiver().receive(raw, authHeader) as typeof event;
  } catch (e) {
    console.error("[classroom/webhook] verify failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const roomName = event.room?.name ?? "";
  if (!roomName) return NextResponse.json({ ok: true });

  const db = getServiceSupabase();
  const { data: sess } = await db.from("classroom_sessions").select("id").eq("room_name", roomName).maybeSingle();
  const sessionId = (sess as { id: string } | null)?.id ?? null;

  const map: Record<string, string> = {
    participant_joined: "joined",
    participant_left: "left",
  };
  const kind = map[event.event ?? ""];

  if (kind && event.participant?.identity) {
    await db.from("classroom_events").insert({
      session_id: sessionId,
      room_name: roomName,
      user_id: event.participant.identity,
      display_name: event.participant.name ?? null,
      kind,
      value: {},
      source: "webhook",
    });
  } else if (event.event === "room_finished" && sessionId) {
    await db.from("classroom_sessions").update({ status: "ended", ended_at: new Date().toISOString() }).eq("id", sessionId);
  }

  return NextResponse.json({ ok: true });
}
