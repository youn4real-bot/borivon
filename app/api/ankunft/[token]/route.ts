import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimitDistributed } from "@/lib/rateLimit";
import { fxDb, nowIso, rowNurse } from "@/lib/facility/db";
import { STEP_IDS } from "@/lib/facility/steps";

/**
 * The nurse's own link (borivon.com/ankunft/<token>), shared by her facility. No login: the long
 * random token is the key, and the facility can delete it any time.
 * GET → her plan (first name, town, dates, steps, facility name). PATCH {step, done} → she ticks a step.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function load(token: string) {
  if (token.length < 30 || token.length > 60) return null;
  const db = await fxDb();
  if (!db) return null;
  const r = (await db.run(`SELECT n.*, f.name AS f_name, f.status AS f_status FROM fx_nurses n JOIN fx_facilities f ON f.id = n.facility_id WHERE n.share_token = ?`, [token])).results[0];
  if (!r || String(r.f_status) !== "active") return null;
  return { db, nurse: rowNurse(r), facility: String(r.f_name) };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const rl = await enforceRateLimitDistributed(req, "fx-ankunft", { limit: 240, windowMs: 3_600_000 });
  if (!rl.ok) return NextResponse.json({ error: "too_many" }, { status: 429 });
  const x = await load((await params).token);
  if (!x) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const n = x.nurse;
  return NextResponse.json(
    { first_name: n.first_name, sample: n.sample, arrival: n.arrival, start: n.start, plz: n.plz, city: n.city, steps: n.steps, facility: x.facility },
    { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } },
  );
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const rl = await enforceRateLimitDistributed(req, "fx-ankunft-w", { limit: 120, windowMs: 3_600_000 });
  if (!rl.ok) return NextResponse.json({ error: "too_many" }, { status: 429 });
  const x = await load((await params).token);
  if (!x) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof b.step !== "string" || !STEP_IDS.has(b.step)) return NextResponse.json({ error: "bad_step" }, { status: 400 });
  const steps = { ...x.nurse.steps };
  if (b.done === true) steps[b.step] = nowIso(); else delete steps[b.step];
  await x.db.run(`UPDATE fx_nurses SET steps = ?, updated_at = ? WHERE id = ?`, [JSON.stringify(steps), nowIso(), x.nurse.id]);
  return NextResponse.json({ steps }, { headers: { "Cache-Control": "no-store" } });
}
