import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { enforceRateLimitDistributed } from "@/lib/rateLimit";
import { verifyLeadToken } from "@/lib/roadmap/token";
import { parseDetails } from "@/lib/roadmap/leadState";
import { cleanCalc } from "@/lib/roadmap/calc";

/**
 * POST /api/roadmap/calc {id, t, values} — the calculator behind the button on
 * PDF page 4 (borivon.com/fahrplan/rechner) saves the numbers the lead set, so
 * the founder sees their real pay/places before the call (admin leads page).
 * Only with the signed personal link; numbers only, clamped.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const rl = await enforceRateLimitDistributed(req, "roadmap-calc", { limit: 60, windowMs: 3_600_000 });
  if (!rl.ok) return NextResponse.json({ error: "too_many" }, { status: 429 });
  if (Number(req.headers.get("content-length") ?? 0) > 2048) return NextResponse.json({ error: "too_large" }, { status: 413 });
  let body: { id?: unknown; t?: unknown; values?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_body" }, { status: 400 }); }
  const id = typeof body.id === "string" ? body.id : "";
  const t = typeof body.t === "string" ? body.t : "";
  if (!(await verifyLeadToken("calc", id, t))) return NextResponse.json({ error: "invalid_link" }, { status: 403 });

  const db = getServiceSupabase();
  const { data, error } = await db.from("leads").select("id,details").eq("id", id).eq("kind", "roadmap").maybeSingle();
  if (error || !data) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const d = parseDetails((data as { details: unknown }).details);
  if (d.anonymizedAt) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const next = { ...d, calc: { ...cleanCalc(body.values), at: new Date().toISOString() } };
  const { error: upErr } = await db.from("leads").update({ details: next }).eq("id", id);
  if (upErr) return NextResponse.json({ error: "save_failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
