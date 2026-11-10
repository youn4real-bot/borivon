import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimitDistributed } from "@/lib/rateLimit";
import { fxDb, nowIso, cleanDate } from "@/lib/facility/db";
import { VISA_STEP_IDS } from "@/lib/facility/visa";
import { journeyOwner, askedId } from "@/lib/facility/portalAccess";

/**
 * The visa guide's state for one nurse (fx_visa): the date it was handed in at TLScontact and the
 * ticked steps. Same access as the arrival plan (lib/facility/portalAccess).
 *   GET ?userId=   PUT {userId?, submitted}   PATCH {userId?, step, done}
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function read(userId: string) {
  const db = (await fxDb())!;
  const r = (await db.run(`SELECT * FROM fx_visa WHERE user_id = ?`, [userId])).results[0];
  let steps: Record<string, string> = {};
  try { const p = JSON.parse(String(r?.steps || "{}")); if (p && typeof p === "object") steps = p; } catch { steps = {}; }
  return { submitted: String(r?.submitted ?? ""), steps };
}

export async function GET(req: NextRequest) {
  const w = await journeyOwner(req, askedId(req.nextUrl.searchParams.get("userId")));
  if (w instanceof NextResponse) return w;
  return NextResponse.json(await read(w.userId), { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: NextRequest) {
  const rl = await enforceRateLimitDistributed(req, "visa-w", { limit: 120, windowMs: 3_600_000 });
  if (!rl.ok) return NextResponse.json({ error: "too_many" }, { status: 429 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const w = await journeyOwner(req, askedId(b.userId));
  if (w instanceof NextResponse) return w;
  const cur = await read(w.userId);
  const submitted = cleanDate(b.submitted);
  const db = (await fxDb())!;
  await db.run(
    `INSERT INTO fx_visa (user_id, submitted, steps, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET submitted = excluded.submitted, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    [w.userId, submitted, JSON.stringify(cur.steps), nowIso(), w.by],
  );
  return NextResponse.json({ submitted, steps: cur.steps }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(req: NextRequest) {
  const rl = await enforceRateLimitDistributed(req, "visa-w", { limit: 240, windowMs: 3_600_000 });
  if (!rl.ok) return NextResponse.json({ error: "too_many" }, { status: 429 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof b.step !== "string" || !VISA_STEP_IDS.has(b.step)) return NextResponse.json({ error: "bad_step" }, { status: 400 });
  const w = await journeyOwner(req, askedId(b.userId));
  if (w instanceof NextResponse) return w;
  const cur = await read(w.userId);
  const steps = { ...cur.steps };
  if (b.done === true) steps[b.step] = nowIso(); else delete steps[b.step];
  const db = (await fxDb())!;
  await db.run(
    `INSERT INTO fx_visa (user_id, steps, updated_at, updated_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET steps = excluded.steps, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    [w.userId, JSON.stringify(steps), nowIso(), w.by],
  );
  return NextResponse.json({ submitted: cur.submitted, steps }, { headers: { "Cache-Control": "no-store" } });
}
