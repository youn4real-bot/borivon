import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimitDistributed } from "@/lib/rateLimit";
import { requireUser } from "@/lib/admin-auth";
import { cleanPlz, clean } from "@/lib/facility/db";
import { placesFor } from "@/lib/facility/places";

/**
 * GET ?plz=&city= → the nearest offices for the arrival plan (lib/facility/places.ts). For signed-in
 * portal users only; only the postcode is ever looked up outside. (The arrival plan comes back inside
 * the portal journey, founder 2026-11-10: "day 1 … month 6".)
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (!user.ok) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  const rl = await enforceRateLimitDistributed(req, "fx-places", { limit: 120, windowMs: 3_600_000 });
  if (!rl.ok) return NextResponse.json({ error: "too_many" }, { status: 429 });
  const plz = cleanPlz(req.nextUrl.searchParams.get("plz")), city = clean(req.nextUrl.searchParams.get("city"), 80);
  if (!plz) return NextResponse.json({ error: "plz_required" }, { status: 400 });
  const out = await placesFor(plz, city);
  if (!out) return NextResponse.json({ error: "not_found_plz" }, { status: 404 });
  return NextResponse.json(out, { headers: { "Cache-Control": "private, max-age=600" } });
}
