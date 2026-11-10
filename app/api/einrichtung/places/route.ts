import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimitDistributed } from "@/lib/rateLimit";
import { fxDb, cleanPlz, clean } from "@/lib/facility/db";
import { requireFacility } from "@/lib/facility/auth";
import { placesFor } from "@/lib/facility/places";
import { DEMO_PLZ } from "@/components/fx/demo";

/**
 * GET ?plz=&city= (signed-in facility) or ?s=<share token> (the nurse's own link) → the nearest
 * places for the arrival plan. Only the postcode is ever looked up outside (lib/facility/places.ts).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const rl = await enforceRateLimitDistributed(req, "fx-places", { limit: 120, windowMs: 3_600_000 });
  if (!rl.ok) return NextResponse.json({ error: "too_many" }, { status: 429 });
  const sp = req.nextUrl.searchParams;
  let plz = "", city = "";
  const share = sp.get("s") ?? "";
  if (share) {
    if (share.length < 30 || share.length > 60) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const db = await fxDb();
    const r = db ? (await db.run(`SELECT plz, city FROM fx_nurses WHERE share_token = ?`, [share])).results[0] : undefined;
    if (!r) return NextResponse.json({ error: "not_found" }, { status: 404 });
    plz = String(r.plz); city = String(r.city);
  } else {
    plz = cleanPlz(sp.get("plz")); city = clean(sp.get("city"), 80);
    // the example workspace may look up its own postcode without a login; anything else needs one
    const demoOk = sp.get("demo") === "1" && DEMO_PLZ.includes(plz);
    if (!demoOk && !(await requireFacility(req))) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  }
  if (!plz) return NextResponse.json({ error: "plz_required" }, { status: 400 });
  const out = await placesFor(plz, city);
  if (!out) return NextResponse.json({ error: "not_found_plz" }, { status: 404 });
  return NextResponse.json(out, { headers: { "Cache-Control": "private, max-age=600" } });
}
