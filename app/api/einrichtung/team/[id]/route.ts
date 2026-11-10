import { NextRequest, NextResponse } from "next/server";
import { fxDb } from "@/lib/facility/db";
import { requireFacility, sameOrigin } from "@/lib/facility/auth";

/** DELETE → the owner removes a colleague (their sessions end at once). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const auth = await requireFacility(req);
  if (!auth) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  if (auth.user.role !== "owner") return NextResponse.json({ error: "owner_only" }, { status: 403 });
  const { id } = await params;
  if (id === auth.user.id) return NextResponse.json({ error: "self" }, { status: 400 });
  const db = (await fxDb())!;
  const r = await db.run(`DELETE FROM fx_users WHERE id = ? AND facility_id = ? AND role = 'member'`, [id, auth.facility.id]);
  if (!r.meta.changes) return NextResponse.json({ error: "not_found" }, { status: 404 });
  await db.run(`DELETE FROM fx_sessions WHERE user_id = ?`, [id]);
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
