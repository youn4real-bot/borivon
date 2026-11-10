import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole, ciEmail } from "@/lib/admin-auth";
import { diyOrg, diyUsage, setBorivonAccess } from "@/lib/facility/diy";
import { sendAdminAlertEmail } from "@/lib/email";
import { keepAlive } from "@/lib/keepAlive";

/**
 * The DIY facility's own panel at the top of /portal/admin (founder 2026-11-10).
 *   GET  → its invite links (nurses, team), usage within the free scope, the Borivon switch
 *   POST {borivonAccess} → "Mit Borivon arbeiten" on/off (on: Borivon's team sees + helps)
 * Only for an admin of a DIY facility (org member whose org has an fx_orgs row).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function myFacility(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok || auth.role !== "sub_admin") return null;
  const db = getServiceSupabase();
  const { data } = await db.from("organization_members").select("org_id").ilike("sub_admin_email", ciEmail(auth.email)).limit(5);
  for (const row of (data ?? []) as { org_id: string }[]) {
    const diy = await diyOrg(row.org_id);
    if (diy) return { auth, diy };
  }
  return null;
}

export async function GET(req: NextRequest) {
  const x = await myFacility(req);
  if (!x) return NextResponse.json({ diy: false }, { headers: { "Cache-Control": "no-store" } });
  const db = getServiceSupabase();
  const { data: org } = await db.from("organizations").select("id, name, invite_code, member_invite_code").eq("id", x.diy.org_id).maybeSingle();
  if (!org) return NextResponse.json({ diy: false }, { headers: { "Cache-Control": "no-store" } });
  const o = org as { id: string; name: string; invite_code: string; member_invite_code: string | null };
  const usage = await diyUsage(o.id);
  return NextResponse.json({
    diy: true,
    name: o.name,
    nurseLink: `https://borivon.com/join/${encodeURIComponent(o.invite_code)}`,
    teamLink: o.member_invite_code ? `https://borivon.com/join/${encodeURIComponent(o.member_invite_code)}` : null,
    borivonAccess: x.diy.borivon_access,
    usage,
    limits: { nurses: x.diy.nurse_limit, users: x.diy.user_limit },
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const x = await myFacility(req);
  if (!x) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof b.borivonAccess !== "boolean") return NextResponse.json({ error: "bad_request" }, { status: 400 });
  await setBorivonAccess(x.diy.org_id, b.borivonAccess);
  if (b.borivonAccess) {
    keepAlive(() => sendAdminAlertEmail("Plattform: eine Einrichtung möchte mit Borivon arbeiten", `${x.auth.email} hat „Mit Borivon arbeiten“ eingeschaltet.`));
  }
  return NextResponse.json({ ok: true, borivonAccess: b.borivonAccess }, { headers: { "Cache-Control": "no-store" } });
}
