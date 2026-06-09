import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/admin-auth";
import { getServiceSupabase } from "@/lib/supabase";
import { livekitConfigured, livekitUrl, mintClassroomToken } from "@/lib/livekit";

/**
 * Candidate-facing classroom join. Three gates, all server-side:
 *   1) authenticated (requireUser)
 *   2) ACTIVE GDPR consent (classroom_consent row, not revoked) — 403 needsConsent
 *   3) the room is a session that is BOTH status='live' AND open_to_candidates
 *      — 403 notOpen (an admin-only or ended class can never be joined here)
 * identity = the candidate's user_id, so all telemetry ties to the person.
 *
 * POST { room } → { token, url, sessionId } | { needsConsent } | { notOpen }
 */
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (!livekitConfigured()) return NextResponse.json({ error: "LiveKit not configured", needsSetup: true }, { status: 503 });

  const body = await req.json().catch(() => ({})) as { room?: unknown };
  const room = typeof body.room === "string" ? body.room.trim().slice(0, 80) : "";
  if (!room) return NextResponse.json({ error: "room required" }, { status: 400 });

  const db = getServiceSupabase();

  // Gate 2: PRIVATE-TEST allowlist — only flagged candidates may join while the
  // classroom is in testing. (One fetch also gives us the display name.)
  const { data: prof } = await db.from("candidate_profiles").select("first_name, last_name, classroom_tester").eq("user_id", auth.userId).maybeSingle();
  const p = prof as { first_name: string | null; last_name: string | null; classroom_tester: boolean | null } | null;
  if (p?.classroom_tester !== true) return NextResponse.json({ error: "Not a tester", notTester: true }, { status: 403 });

  // Gate 3: active consent.
  const { data: consentRow } = await db.from("classroom_consent").select("revoked_at").eq("user_id", auth.userId).maybeSingle();
  const consented = !!consentRow && !(consentRow as { revoked_at: string | null }).revoked_at;
  if (!consented) return NextResponse.json({ error: "Consent required", needsConsent: true }, { status: 403 });

  // Gate 4: the room must be a live class explicitly opened to candidates.
  const { data: sess } = await db
    .from("classroom_sessions")
    .select("id, status, open_to_candidates")
    .eq("room_name", room)
    .maybeSingle();
  const s = sess as { id: string; status: string | null; open_to_candidates: boolean | null } | null;
  if (!s || s.status !== "live" || s.open_to_candidates !== true) {
    return NextResponse.json({ error: "Class not open", notOpen: true }, { status: 403 });
  }

  // Candidate display name (canonical → email local part fallback).
  const name = [p?.first_name, p?.last_name].filter(Boolean).join(" ").trim() || auth.email.split("@")[0] || "Teilnehmer";

  const token = await mintClassroomToken({ room, identity: auth.userId, name, canPublish: true });
  return NextResponse.json({ token, url: livekitUrl(), sessionId: s.id });
}
