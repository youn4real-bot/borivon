import { NextRequest, NextResponse } from "next/server";
import { fxDb } from "@/lib/facility/db";
import { STEPS } from "@/lib/facility/steps";
import { VISA_STEPS } from "@/lib/facility/visa";
import { MOVE_STEPS } from "@/lib/facility/move";
import { SETTLE } from "@/lib/facility/settle";
import { wegNow, type WegKey } from "@/lib/facility/weg";
import { journeyOwner, askedId } from "@/lib/facility/portalAccess";
import { docPhasesFor } from "@/lib/facility/docPhases";
import type { WayInput } from "@/lib/facility/way";

/**
 * One nurse's whole way (components/fx/Way.tsx): the document phases, her B2 stage, the ticked steps of
 * the visa guide, flat + journey, first weeks and six months, and the dates someone entered (visa handed
 * in, flight, first working day). The client builds the stations with lib/facility/way.ts. GET ?userId=
 */
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
  const steps = {} as Record<WegKey, Record<string, string>>;
  const rows = {} as Record<WegKey, Record<string, unknown> | undefined>;
  await Promise.all((Object.keys(IDS) as WegKey[]).map(async (k) => {
    const r = (await db.run(`SELECT * FROM ${TABLE[k]} WHERE user_id = ?`, [w.userId])).results[0] as Record<string, unknown> | undefined;
    rows[k] = r;
    let s: Record<string, unknown> = {};
    try { const p = JSON.parse(String(r?.steps || "{}")); if (p && typeof p === "object") s = p; } catch { s = {}; }
    // only known step ids, as strings (the time it was ticked)
    steps[k] = Object.fromEntries(IDS[k].filter((id) => s[id]).map((id) => [id, String(s[id])]));
    prog[k] = [Object.keys(steps[k]).length, IDS[k].length];
  }));
  // the document phases before the way to Germany (papers, Anerkennung, embassy papers): null when unknown
  const docs = await docPhasesFor(w.userId);
  const input: Omit<WayInput, "today"> = {
    docs: docs ? { papers: docs.papers, bearbeitung: docs.bearbeitung, visum: docs.visum, pending: docs.pending } : null,
    b2: docs?.b2 ?? null,
    steps: { visa: steps.visa, move: steps.move, weeks: steps.weeks, six: steps.six },
    dates: {
      submitted: String(rows.visa?.submitted ?? ""),
      flight: String(rows.move?.flight_date ?? ""),
      start: String(rows.weeks?.start ?? ""),
    },
  };
  return NextResponse.json(
    { prog, now: wegNow(prog), docs, input, photo: docs?.photo ?? null, today: new Date().toISOString().slice(0, 10) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
