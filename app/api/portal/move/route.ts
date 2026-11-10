import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimitDistributed } from "@/lib/rateLimit";
import { fxDb, nowIso, clean, cleanDate } from "@/lib/facility/db";
import { MOVE_STEP_IDS } from "@/lib/facility/move";
import { journeyOwner, askedId } from "@/lib/facility/portalAccess";

/**
 * Wohnung + Anreise for one nurse (fx_move): the flight (from, to, date), who picks her up, ticked
 * steps. Same access as the arrival plan (lib/facility/portalAccess).
 *   GET ?userId=   PUT {userId?, flight_from, flight_to, flight_date, pickup_by}   PATCH {userId?, step, done}
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function read(userId: string) {
  const db = (await fxDb())!;
  const r = (await db.run(`SELECT * FROM fx_move WHERE user_id = ?`, [userId])).results[0];
  let steps: Record<string, string> = {};
  try { const p = JSON.parse(String(r?.steps || "{}")); if (p && typeof p === "object") steps = p; } catch { steps = {}; }
  return { flight_from: String(r?.flight_from ?? ""), flight_to: String(r?.flight_to ?? ""), flight_date: String(r?.flight_date ?? ""), pickup_by: String(r?.pickup_by ?? ""), steps };
}

export async function GET(req: NextRequest) {
  const w = await journeyOwner(req, askedId(req.nextUrl.searchParams.get("userId")));
  if (w instanceof NextResponse) return w;
  return NextResponse.json(await read(w.userId), { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: NextRequest) {
  const rl = await enforceRateLimitDistributed(req, "move-w", { limit: 120, windowMs: 3_600_000 });
  if (!rl.ok) return NextResponse.json({ error: "too_many" }, { status: 429 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const w = await journeyOwner(req, askedId(b.userId));
  if (w instanceof NextResponse) return w;
  const cur = await read(w.userId);
  const next = {
    flight_from: "flight_from" in b ? clean(b.flight_from, 60) : cur.flight_from,
    flight_to: "flight_to" in b ? clean(b.flight_to, 60) : cur.flight_to,
    flight_date: "flight_date" in b ? cleanDate(b.flight_date) : cur.flight_date,
    pickup_by: "pickup_by" in b ? clean(b.pickup_by, 80) : cur.pickup_by,
  };
  const db = (await fxDb())!;
  await db.run(
    `INSERT INTO fx_move (user_id, flight_from, flight_to, flight_date, pickup_by, steps, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET flight_from = excluded.flight_from, flight_to = excluded.flight_to, flight_date = excluded.flight_date, pickup_by = excluded.pickup_by, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    [w.userId, next.flight_from, next.flight_to, next.flight_date, next.pickup_by, JSON.stringify(cur.steps), nowIso(), w.by],
  );
  return NextResponse.json({ ...next, steps: cur.steps }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(req: NextRequest) {
  const rl = await enforceRateLimitDistributed(req, "move-w", { limit: 240, windowMs: 3_600_000 });
  if (!rl.ok) return NextResponse.json({ error: "too_many" }, { status: 429 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof b.step !== "string" || !MOVE_STEP_IDS.has(b.step)) return NextResponse.json({ error: "bad_step" }, { status: 400 });
  const w = await journeyOwner(req, askedId(b.userId));
  if (w instanceof NextResponse) return w;
  const cur = await read(w.userId);
  const steps = { ...cur.steps };
  if (b.done === true) steps[b.step] = nowIso(); else delete steps[b.step];
  const db = (await fxDb())!;
  await db.run(
    `INSERT INTO fx_move (user_id, steps, updated_at, updated_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET steps = excluded.steps, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    [w.userId, JSON.stringify(steps), nowIso(), w.by],
  );
  return NextResponse.json({ ...cur, steps }, { headers: { "Cache-Control": "no-store" } });
}
