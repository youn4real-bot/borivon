import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/admin-auth";
import { getServiceSupabase } from "@/lib/supabase";
import { enforceRateLimit } from "@/lib/rateLimit";
import { UUID_RE } from "@/lib/uuid";

/**
 * Append one telemetry event to the classroom ledger — the participant logs
 * their OWN signals (self-scoped: user_id is always the caller). Client-side
 * capture; the LiveKit webhook adds server-verified copies separately.
 *
 * POST { sessionId?, roomName, kind, value?, displayName? }
 */
const KINDS = new Set([
  "joined", "left", "camera_on", "camera_off", "mic_on", "mic_off",
  "spoke", "exercise_action", "hand_raise",
]);

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // Telemetry can be frequent (speaking ticks) — generous but bounded.
  const rl = enforceRateLimit(req, "classroom-event", { limit: 240, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ ok: false }, { status: 429 });

  const body = await req.json().catch(() => ({})) as {
    sessionId?: unknown; roomName?: unknown; kind?: unknown; value?: unknown; displayName?: unknown;
  };
  const kind = typeof body.kind === "string" ? body.kind : "";
  const roomName = typeof body.roomName === "string" ? body.roomName.trim().slice(0, 80) : "";
  if (!KINDS.has(kind) || !roomName) return NextResponse.json({ ok: false, error: "bad event" }, { status: 400 });

  const sessionId = typeof body.sessionId === "string" && UUID_RE.test(body.sessionId) ? body.sessionId : null;
  const displayName = typeof body.displayName === "string" ? body.displayName.slice(0, 80) : null;
  const value = (body.value && typeof body.value === "object") ? body.value : {};

  const db = getServiceSupabase();
  const { error } = await db.from("classroom_events").insert({
    session_id: sessionId,
    room_name: roomName,
    user_id: auth.userId,
    display_name: displayName,
    kind,
    value,
    source: "client",
  });
  if (error) { console.error("[classroom/event] insert failed:", error.message); return NextResponse.json({ ok: false }, { status: 500 }); }
  return NextResponse.json({ ok: true });
}
