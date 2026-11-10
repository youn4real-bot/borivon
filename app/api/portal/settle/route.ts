import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimitDistributed } from "@/lib/rateLimit";
import { fxDb, nowIso } from "@/lib/facility/db";
import { SETTLE_IDS } from "@/lib/facility/settle";
import { journeyOwner, askedId } from "@/lib/facility/portalAccess";

/** The first six months for one nurse (fx_settle): ticked items. GET ?userId=   PATCH {userId?, step, done} */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function read(userId: string) {
  const db = (await fxDb())!;
  const r = (await db.run(`SELECT steps FROM fx_settle WHERE user_id = ?`, [userId])).results[0];
  let steps: Record<string, string> = {};
  try { const p = JSON.parse(String(r?.steps || "{}")); if (p && typeof p === "object") steps = p; } catch { steps = {}; }
  return { steps };
}

export async function GET(req: NextRequest) {
  const w = await journeyOwner(req, askedId(req.nextUrl.searchParams.get("userId")));
  if (w instanceof NextResponse) return w;
  return NextResponse.json(await read(w.userId), { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(req: NextRequest) {
  const rl = await enforceRateLimitDistributed(req, "settle-w", { limit: 240, windowMs: 3_600_000 });
  if (!rl.ok) return NextResponse.json({ error: "too_many" }, { status: 429 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof b.step !== "string" || !SETTLE_IDS.has(b.step)) return NextResponse.json({ error: "bad_step" }, { status: 400 });
  const w = await journeyOwner(req, askedId(b.userId));
  if (w instanceof NextResponse) return w;
  const { steps: cur } = await read(w.userId);
  const steps = { ...cur };
  if (b.done === true) steps[b.step] = nowIso(); else delete steps[b.step];
  const db = (await fxDb())!;
  await db.run(
    `INSERT INTO fx_settle (user_id, steps, updated_at, updated_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET steps = excluded.steps, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    [w.userId, JSON.stringify(steps), nowIso(), w.by],
  );
  return NextResponse.json({ steps }, { headers: { "Cache-Control": "no-store" } });
}
