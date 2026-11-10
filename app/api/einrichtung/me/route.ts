import { NextRequest, NextResponse } from "next/server";
import { fxDb, rowNurse, rowUser, FREE_NURSES, FREE_USERS } from "@/lib/facility/db";
import { requireFacility } from "@/lib/facility/auth";

/** GET → the signed-in workspace: facility, me, team, nurses. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireFacility(req);
  if (!auth) return NextResponse.json({ error: "signed_out" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const db = (await fxDb())!;
  const [team, nurses] = await Promise.all([
    db.run(`SELECT * FROM fx_users WHERE facility_id = ? ORDER BY created_at`, [auth.facility.id]),
    db.run(`SELECT * FROM fx_nurses WHERE facility_id = ? ORDER BY sample ASC, arrival ASC, created_at ASC`, [auth.facility.id]),
  ]);
  return NextResponse.json({
    facility: auth.facility,
    me: { id: auth.user.id, email: auth.user.email, role: auth.user.role, salutation: auth.user.salutation, last_name: auth.user.last_name },
    team: team.results.map(rowUser).map((u) => ({ id: u.id, email: u.email, role: u.role, last_login_at: u.last_login_at })),
    nurses: nurses.results.map(rowNurse),
    // the app says these only when one is reached (Nutzungsbedingungen § 3)
    limits: { nurses: FREE_NURSES, users: FREE_USERS },
  }, { headers: { "Cache-Control": "no-store" } });
}
