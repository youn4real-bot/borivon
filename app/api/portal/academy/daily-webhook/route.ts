/**
 * ACADEMY — Daily webhook → auto-attendance.
 *
 * On participant.left, Daily tells us which candidate (user_id, pinned via the
 * meeting token) was in which room (external_ref) for how long. We turn that into
 * an academy_attendance row (source='auto') + the matching ledger points.
 *
 * Integrity:
 *  - Signature is HMAC-verified (verifyDailyWebhook); fail-closed.
 *  - A teacher's MANUAL mark (source='admin') is never overwritten by auto.
 *  - Attendance + points are idempotent on (session, candidate), so rejoins /
 *    redeliveries never double-pay.
 *
 * Inert until DAILY_WEBHOOK_SECRET is set (returns 200 no-op so Daily's test
 * ping still succeeds, but nothing is written).
 */
import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { verifyDailyWebhook, webhookConfigured } from "@/lib/daily";
import { serverBroadcast } from "@/lib/serverBroadcast";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LATE_GRACE_SEC = 10 * 60; // joined >10 min after start → "late"
const POINTS: Record<string, number> = { present: 10, late: 4, absent: 0, excused: 0 };

export async function POST(req: NextRequest) {
  const raw = await req.text();
  // Inert if not configured — acknowledge so Daily's setup test passes.
  if (!webhookConfigured()) return NextResponse.json({ ok: true, inert: true });

  const ts = req.headers.get("x-webhook-timestamp");
  const sig = req.headers.get("x-webhook-signature");
  if (!verifyDailyWebhook(raw, ts, sig)) return NextResponse.json({ error: "Bad signature" }, { status: 401 });

  let evt: { type?: string; payload?: Record<string, unknown> } = {};
  try { evt = JSON.parse(raw); } catch { return NextResponse.json({ ok: true }); }
  if (evt.type !== "participant.left") return NextResponse.json({ ok: true }); // only care about leave events

  const p = evt.payload ?? {};
  const room = String(p.room ?? "");
  const candidateId = String(p.user_id ?? "");
  const joinedAt = Number(p.joined_at ?? 0);          // unix seconds
  const durationSec = Number(p.duration ?? 0);
  if (!room || !UUID.test(candidateId)) return NextResponse.json({ ok: true }); // can't attribute → ignore

  const db = getServiceSupabase();
  const { data: sess } = await db
    .from("academy_class_sessions")
    .select("id, cohort_id, starts_at")
    .eq("external_ref", room)
    .maybeSingle();
  if (!sess) return NextResponse.json({ ok: true });
  const s = sess as { id: string; cohort_id: string; starts_at: string };

  // never override a teacher's manual mark
  const { data: existing } = await db
    .from("academy_attendance")
    .select("source, minutes_present")
    .eq("session_id", s.id)
    .eq("candidate_user_id", candidateId)
    .maybeSingle();
  if (existing && (existing as { source: string }).source === "admin") {
    return NextResponse.json({ ok: true, skipped: "manual" });
  }

  const startSec = Math.floor(new Date(s.starts_at).getTime() / 1000);
  const status = joinedAt > 0 && joinedAt > startSec + LATE_GRACE_SEC ? "late" : "present";
  const minutes = Math.max(Math.round(durationSec / 60), (existing as { minutes_present: number } | null)?.minutes_present ?? 0);

  await db.from("academy_attendance").upsert(
    {
      session_id: s.id, candidate_user_id: candidateId, status, source: "auto",
      joined_at: joinedAt ? new Date(joinedAt * 1000).toISOString() : null,
      left_at: joinedAt && durationSec ? new Date((joinedAt + durationSec) * 1000).toISOString() : null,
      minutes_present: minutes, recorded_at: new Date().toISOString(),
    },
    { onConflict: "session_id,candidate_user_id", ignoreDuplicates: false },
  );

  // ledger points — idempotent per (candidate, session)
  await db.from("academy_point_events").upsert(
    {
      candidate_user_id: candidateId, cohort_id: s.cohort_id, type: "attendance", points: POINTS[status] ?? 0,
      source_kind: "session", source_id: s.id, meta: { status, source: "auto" }, created_by: "daily",
    },
    { onConflict: "candidate_user_id,type,source_kind,source_id", ignoreDuplicates: false },
  );

  serverBroadcast(`academy:${candidateId}`, "points", { reason: "attendance_auto" }).catch(() => {});
  return NextResponse.json({ ok: true });
}
