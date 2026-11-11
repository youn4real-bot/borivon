import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimitDistributed } from "@/lib/rateLimit";
import { fxDb, nowIso } from "@/lib/facility/db";
import { journeyOwner, askedId } from "@/lib/facility/portalAccess";
import { rowMarks, patchMarks } from "@/lib/facility/track";

/**
 * Her milestones (fx_marks, lib/facility/track.ts): contract signed, Kenntnisprüfung date + result,
 * Berufsurkunde. She can read them; only her facility / Borivon set them.
 *   GET ?userId=   PUT {userId, contract?, kp_date?, kp_result?, urkunde?}
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function read(userId: string) {
  const db = (await fxDb())!;
  return rowMarks((await db.run(`SELECT * FROM fx_marks WHERE user_id = ?`, [userId])).results[0] as Record<string, unknown> | undefined);
}

export async function GET(req: NextRequest) {
  const w = await journeyOwner(req, askedId(req.nextUrl.searchParams.get("userId")));
  if (w instanceof NextResponse) return w;
  return NextResponse.json(await read(w.userId), { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: NextRequest) {
  const rl = await enforceRateLimitDistributed(req, "marks-w", { limit: 240, windowMs: 3_600_000 });
  if (!rl.ok) return NextResponse.json({ error: "too_many" }, { status: 429 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const w = await journeyOwner(req, askedId(b.userId));
  if (w instanceof NextResponse) return w;
  if (!w.admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const n = patchMarks(await read(w.userId), b);
  const db = (await fxDb())!;
  await db.run(
    `INSERT INTO fx_marks (user_id, contract, kp_date, kp_result, urkunde, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET contract = excluded.contract, kp_date = excluded.kp_date, kp_result = excluded.kp_result,
       urkunde = excluded.urkunde, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    [w.userId, n.contract, n.kp_date, n.kp_result, n.urkunde, nowIso(), w.by],
  );
  return NextResponse.json(n, { headers: { "Cache-Control": "no-store" } });
}
