import { NextRequest, NextResponse } from "next/server";
import { fxDb, clean, cleanPlz } from "@/lib/facility/db";
import { requireFacility, sameOrigin } from "@/lib/facility/auth";

/**
 * PATCH {name, street, plz, city} → the facility's own details.
 * DELETE {confirm: "LÖSCHEN"} → the owner deletes the whole workspace (nurses, team, sessions) at once.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const auth = await requireFacility(req);
  if (!auth) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const f = auth.facility;
  const name = clean(b.name, 120) || f.name;
  const plz = "plz" in b ? cleanPlz(b.plz) || f.plz : f.plz;
  const city = "city" in b ? clean(b.city, 80) : f.city;
  const street = "street" in b ? clean(b.street, 120) : f.street;
  const db = (await fxDb())!;
  await db.run(`UPDATE fx_facilities SET name = ?, street = ?, plz = ?, city = ? WHERE id = ?`, [name, street, plz, city, f.id]);
  return NextResponse.json({ facility: { ...f, name, street, plz, city } }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const auth = await requireFacility(req);
  if (!auth) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  if (auth.user.role !== "owner") return NextResponse.json({ error: "owner_only" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (b.confirm !== true) return NextResponse.json({ error: "confirm_required" }, { status: 400 });
  const db = (await fxDb())!;
  const fid = auth.facility.id;
  await db.run(`DELETE FROM fx_sessions WHERE user_id IN (SELECT id FROM fx_users WHERE facility_id = ?)`, [fid]);
  await db.run(`DELETE FROM fx_links WHERE facility_id = ? OR email IN (SELECT email FROM fx_users WHERE facility_id = ?)`, [fid, fid]);
  await db.run(`DELETE FROM fx_nurses WHERE facility_id = ?`, [fid]);
  await db.run(`DELETE FROM fx_users WHERE facility_id = ?`, [fid]);
  await db.run(`DELETE FROM fx_facilities WHERE id = ?`, [fid]);
  return NextResponse.json({ ok: true }, { headers: { "Set-Cookie": "bv_fx=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax", "Cache-Control": "no-store" } });
}
