import { NextRequest, NextResponse } from "next/server";
import { fxDb, newId, nowIso, randomToken, rowNurse, clean, cleanPlz, cleanDate, FREE_NURSES } from "@/lib/facility/db";
import { requireFacility, sameOrigin } from "@/lib/facility/auth";

/**
 * POST → add a nurse to the workspace. Minimal data on purpose (AVV Anlage 1): first + last name,
 * country, arrival, first working day, postcode + town of her flat. No passport, no health data.
 * The free scope counts real nurses only (the example does not count).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const auth = await requireFacility(req);
  if (!auth) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const first = clean(b.first_name, 60), last = clean(b.last_name, 60);
  if (!first) return NextResponse.json({ error: "name_required" }, { status: 400 });
  const plz = cleanPlz(b.plz) || auth.facility.plz;
  const city = clean(b.city, 80) || (plz === auth.facility.plz ? auth.facility.city : "");
  const db = (await fxDb())!;
  const n = Number((await db.run(`SELECT COUNT(*) AS n FROM fx_nurses WHERE facility_id = ? AND sample = 0`, [auth.facility.id])).results[0]?.n ?? 0);
  if (n >= FREE_NURSES) return NextResponse.json({ error: "limit", limit: FREE_NURSES }, { status: 403 });
  const now = nowIso(), id = newId();
  await db.run(
    `INSERT INTO fx_nurses (id, facility_id, first_name, last_name, country, arrival, start, plz, city, steps, share_token, sample, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, 0, ?, ?)`,
    [id, auth.facility.id, first, last, clean(b.country, 60), cleanDate(b.arrival), cleanDate(b.start), plz, city, randomToken(), now, now],
  );
  const row = (await db.run(`SELECT * FROM fx_nurses WHERE id = ?`, [id])).results[0];
  return NextResponse.json({ nurse: rowNurse(row) }, { headers: { "Cache-Control": "no-store" } });
}
