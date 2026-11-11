import { NextRequest, NextResponse } from "next/server";
import { fxDb } from "@/lib/facility/db";
import { STEPS } from "@/lib/facility/steps";
import { VISA_STEPS } from "@/lib/facility/visa";
import { MOVE_STEPS } from "@/lib/facility/move";
import { SETTLE } from "@/lib/facility/settle";
import { wegNow, type WegKey } from "@/lib/facility/weg";
import { journeyOwner, askedId } from "@/lib/facility/portalAccess";
import { docPhasesFor } from "@/lib/facility/docPhases";

/** How far one nurse is on each station of the way (the dashboard card). GET ?userId= */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IDS: Record<WegKey, string[]> = {
  visa: VISA_STEPS.map((s) => s.id),
  move: MOVE_STEPS.map((s) => s.id),
  weeks: STEPS.map((s) => s.id),
  six: SETTLE.flatMap((b) => b.items.map((i) => i.id)),
};
const TABLE: Record<WegKey, string> = { visa: "fx_visa", move: "fx_move", weeks: "fx_arrival", six: "fx_settle" };

export async function GET(req: NextRequest) {
  const w = await journeyOwner(req, askedId(req.nextUrl.searchParams.get("userId")));
  if (w instanceof NextResponse) return w;
  const db = (await fxDb())!;
  const prog = {} as Record<WegKey, [number, number]>;
  await Promise.all((Object.keys(IDS) as WegKey[]).map(async (k) => {
    const r = (await db.run(`SELECT steps FROM ${TABLE[k]} WHERE user_id = ?`, [w.userId])).results[0];
    let steps: Record<string, unknown> = {};
    try { const p = JSON.parse(String(r?.steps || "{}")); if (p && typeof p === "object") steps = p; } catch { steps = {}; }
    prog[k] = [IDS[k].filter((id) => steps[id]).length, IDS[k].length];
  }));
  // the document phases before the way to Germany (papers, Anerkennung, embassy papers): null when unknown
  const docs = await docPhasesFor(w.userId);
  return NextResponse.json({ prog, now: wegNow(prog), docs }, { headers: { "Cache-Control": "no-store" } });
}
