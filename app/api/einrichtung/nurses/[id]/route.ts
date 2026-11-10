import { NextRequest, NextResponse } from "next/server";
import { fxDb, nowIso, rowNurse, clean, cleanPlz, cleanDate } from "@/lib/facility/db";
import { requireFacility, sameOrigin } from "@/lib/facility/auth";
import { STEP_IDS } from "@/lib/facility/steps";

/**
 * PATCH → change a nurse (any of the fields, or one step: {step, done}).
 * DELETE → remove her and her plan (her share link stops working at once).
 * Only within the signed-in facility.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function own(req: NextRequest, id: string) {
  const auth = await requireFacility(req);
  if (!auth) return null;
  const db = (await fxDb())!;
  const row = (await db.run(`SELECT * FROM fx_nurses WHERE id = ? AND facility_id = ?`, [id, auth.facility.id])).results[0];
  return row ? { db, nurse: rowNurse(row) } : null;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const x = await own(req, id);
  if (!x) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const n = x.nurse;
  if (typeof b.step === "string") {
    if (!STEP_IDS.has(b.step)) return NextResponse.json({ error: "bad_step" }, { status: 400 });
    const steps = { ...n.steps };
    if (b.done === true) steps[b.step] = nowIso(); else delete steps[b.step];
    n.steps = steps;
  }
  if ("first_name" in b) { const v = clean(b.first_name, 60); if (v) n.first_name = v; }
  if ("last_name" in b) n.last_name = clean(b.last_name, 60);
  if ("country" in b) n.country = clean(b.country, 60);
  if ("arrival" in b) n.arrival = cleanDate(b.arrival);
  if ("start" in b) n.start = cleanDate(b.start);
  if ("plz" in b) { const v = cleanPlz(b.plz); if (v) n.plz = v; }
  if ("city" in b) n.city = clean(b.city, 80);
  await x.db.run(
    `UPDATE fx_nurses SET first_name = ?, last_name = ?, country = ?, arrival = ?, start = ?, plz = ?, city = ?, steps = ?, updated_at = ? WHERE id = ?`,
    [n.first_name, n.last_name, n.country, n.arrival, n.start, n.plz, n.city, JSON.stringify(n.steps), nowIso(), id],
  );
  return NextResponse.json({ nurse: n }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const x = await own(req, id);
  if (!x) return NextResponse.json({ error: "not_found" }, { status: 404 });
  await x.db.run(`DELETE FROM fx_nurses WHERE id = ?`, [id]);
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
