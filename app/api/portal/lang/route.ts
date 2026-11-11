import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimitDistributed } from "@/lib/rateLimit";
import { fxDb, nowIso } from "@/lib/facility/db";
import { journeyOwner, askedId } from "@/lib/facility/portalAccess";
import { rowLang, patchLang } from "@/lib/facility/track";

/**
 * Her German (fx_lang, lib/facility/track.ts). Same access as the visa guide (lib/facility/portalAccess).
 * Her facility / Borivon set everything; she sets her own exam date, provider and school.
 *   GET ?userId=   PUT {userId?, level?, modules?, exam_date?, provider?, school?, path?}
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function read(userId: string) {
  const db = (await fxDb())!;
  return rowLang((await db.run(`SELECT * FROM fx_lang WHERE user_id = ?`, [userId])).results[0] as Record<string, unknown> | undefined);
}

export async function GET(req: NextRequest) {
  const w = await journeyOwner(req, askedId(req.nextUrl.searchParams.get("userId")));
  if (w instanceof NextResponse) return w;
  return NextResponse.json(await read(w.userId), { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: NextRequest) {
  const rl = await enforceRateLimitDistributed(req, "lang-w", { limit: 240, windowMs: 3_600_000 });
  if (!rl.ok) return NextResponse.json({ error: "too_many" }, { status: 429 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const w = await journeyOwner(req, askedId(b.userId));
  if (w instanceof NextResponse) return w;
  const n = patchLang(await read(w.userId), b, w.admin);
  const db = (await fxDb())!;
  await db.run(
    `INSERT INTO fx_lang (user_id, level, modules, exam_date, provider, school, path, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET level = excluded.level, modules = excluded.modules, exam_date = excluded.exam_date, provider = excluded.provider,
       school = excluded.school, path = excluded.path, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    [w.userId, n.level, JSON.stringify(n.modules), n.exam_date, n.provider, n.school, n.path, nowIso(), w.by],
  );
  return NextResponse.json(n, { headers: { "Cache-Control": "no-store" } });
}
