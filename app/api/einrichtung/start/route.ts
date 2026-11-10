import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { ciEmail } from "@/lib/admin-auth";
import { enforceRateLimitDistributed } from "@/lib/rateLimit";
import { verifyLeadToken } from "@/lib/roadmap/token";
import { parseDetails } from "@/lib/roadmap/leadState";
import { clientIp } from "@/lib/roadmap/consent";
import { trackServer } from "@/lib/track/server";
import { keepAlive } from "@/lib/keepAlive";
import { sendAdminAlertEmail } from "@/lib/email";
import { fxDb, nowIso, clean, TERMS_VERSION, FREE_NURSES, FREE_USERS } from "@/lib/facility/db";
import { sameOrigin } from "@/lib/facility/auth";
import { candidateCode, memberCode } from "@/lib/facility/diy";

/**
 * The gift on the last page of the Fahrplan (founder 2026-11-10): the personal link opens
 * /einrichtung/start?id=&t= → this route.
 *   GET  → who it is for (prefill), and the click counted (event platform_open)
 *   POST → the facility's own space in the REAL portal: an organization (like Calmaroi), its first
 *          admin (an org-scoped sub-admin, LAW #25) with the password they chose, and the DIY
 *          settings (fx_orgs: Borivon stays out until they switch it on). Terms + AVV are accepted
 *          by two human clicks on the page.
 * Only a confirmed, not wiped Fahrplan lead can open it; one facility per lead.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadLead(id: string, t: string) {
  if (!(await verifyLeadToken("platform", id, t))) return null;
  const { data } = await getServiceSupabase().from("leads").select("id,email,details").eq("id", id).eq("kind", "roadmap").maybeSingle();
  if (!data) return null;
  const d = parseDetails((data as { details: unknown }).details);
  if (d.anonymizedAt || !d.consent?.confirmedAt) return null;
  const email = String((data as { email?: unknown }).email ?? "").trim().toLowerCase();
  if (!email) return null;
  const facility = String(d.facility ?? "");
  return {
    id, email,
    salutation: String(d.salutation ?? ""),
    lastName: String(d.lastName ?? ""),
    // v2 stores "Pflegeheim · Bayern" as facility: a description, not a name
    facilityName: facility.includes("·") ? "" : facility,
    src: String(((d as Record<string, unknown>).track as { src?: unknown } | undefined)?.src ?? ""),
  };
}

async function alreadyOpened(leadId: string): Promise<boolean> {
  const db = await fxDb();
  if (!db) return false;
  return (await db.run(`SELECT org_id FROM fx_orgs WHERE lead_id = ?`, [leadId])).results.length > 0;
}

export async function GET(req: NextRequest) {
  const rl = await enforceRateLimitDistributed(req, "fx-start", { limit: 60, windowMs: 3_600_000 });
  if (!rl.ok) return NextResponse.json({ error: "too_many" }, { status: 429 });
  const sp = req.nextUrl.searchParams;
  const lead = await loadLead(sp.get("id") ?? "", sp.get("t") ?? "");
  if (!lead) return NextResponse.json({ error: "invalid_link" }, { status: 403 });
  const existing = await alreadyOpened(lead.id);
  keepAlive(() => trackServer(req, { path: "/einrichtung/start", src: lead.src, lid: lead.id }, [{ type: "platform_open", lead_id: lead.id }]));
  return NextResponse.json(
    { email: lead.email, salutation: lead.salutation, lastName: lead.lastName, facility: lead.facilityName, existing },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const rl = await enforceRateLimitDistributed(req, "fx-start-post", { limit: 10, windowMs: 3_600_000 });
  if (!rl.ok) return NextResponse.json({ error: "too_many" }, { status: 429 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const lead = await loadLead(String(body.id ?? ""), String(body.t ?? ""));
  if (!lead) return NextResponse.json({ error: "invalid_link" }, { status: 403 });
  // both boxes: clicked by a human on the page (never pre-ticked)
  if (body.terms !== true || body.avv !== true) return NextResponse.json({ error: "terms_required" }, { status: 400 });
  const name = clean(body.name, 120);
  if (!name) return NextResponse.json({ error: "name_required" }, { status: 400 });
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 8 || password.length > 72) return NextResponse.json({ error: "password_short" }, { status: 400 });
  if (await alreadyOpened(lead.id)) return NextResponse.json({ error: "exists" }, { status: 409 });

  const fx = await fxDb();
  if (!fx) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  const db = getServiceSupabase();
  const fullName = [lead.salutation === "frau" ? "Frau" : lead.salutation === "herr" ? "Herr" : "", lead.lastName].filter(Boolean).join(" ") || name;

  // 1 · the login (Supabase, like every portal user). An existing account is never touched.
  const created = await db.auth.admin.createUser({
    email: lead.email, password, email_confirm: true,
    user_metadata: { full_name: fullName, facility_admin: true },
  });
  if (created.error || !created.data?.user) {
    const msg = created.error?.message ?? "";
    if (/already|registered|exists/i.test(msg)) return NextResponse.json({ error: "account_exists" }, { status: 409 });
    console.error("[einrichtung/start] createUser failed:", msg);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
  const userId = created.data.user.id;

  // 2 · the organization (codes unguessable: crypto)
  let org: { id: string } | null = null;
  for (let i = 0; i < 4 && !org; i++) {
    const { data, error } = await db.from("organizations")
      .insert({ name, notes: `DIY-Einrichtung (Fahrplan-Geschenk), Lead ${lead.id}`, invite_code: candidateCode(), member_invite_code: memberCode() })
      .select("id").single();
    if (!error && data) org = data as { id: string };
    else if (!/duplicate|unique|23505/i.test(error?.message ?? "")) { console.error("[einrichtung/start] org insert failed:", error?.message); break; }
  }
  if (!org) {
    await db.auth.admin.deleteUser(userId).catch(() => {});
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }

  // 3 · its first admin: org-scoped (sees only this facility's nurses, LAW #25), same rows the
  //     invite route writes for an org member (app/api/portal/invite/[code])
  await db.from("sub_admins").delete().ilike("email", ciEmail(lead.email));
  const sub = await db.from("sub_admins").insert({ email: lead.email, name: fullName, label: name, is_agency_admin: true });
  const mem = await db.from("organization_members").insert({ org_id: org.id, sub_admin_email: lead.email, role: "member" });
  await db.from("candidate_profiles").upsert({ user_id: userId, manually_verified: true }, { onConflict: "user_id" });
  if (sub.error || mem.error) {
    console.error("[einrichtung/start] admin rows failed:", sub.error?.message, mem.error?.message);
    await db.from("organization_members").delete().eq("org_id", org.id);
    await db.from("sub_admins").delete().ilike("email", ciEmail(lead.email));
    await db.from("organizations").delete().eq("id", org.id);
    await db.auth.admin.deleteUser(userId).catch(() => {});
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }

  // 4 · the DIY settings + the acceptance on record
  const now = nowIso();
  await fx.run(
    `INSERT INTO fx_orgs (org_id, lead_id, owner_email, borivon_access, nurse_limit, user_limit, terms_version, terms_at, terms_ip, avv_at, created_at) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
    [org.id, lead.id, lead.email, FREE_NURSES, FREE_USERS, TERMS_VERSION, now, clientIp(req.headers), now, now],
  );

  keepAlive(async () => {
    await trackServer(req, { path: "/einrichtung/start", src: lead.src, lid: lead.id }, [{ type: "platform_signup", lead_id: lead.id }]);
    await sendAdminAlertEmail(`Plattform: neue Einrichtung (${name})`, `${name}\n${lead.email}\nDIY im Portal, Borivon-Zugang aus.`);
  });
  // the page signs in with the password it just set (supabase.auth.signInWithPassword) → /portal/admin
  return NextResponse.json({ ok: true, email: lead.email }, { headers: { "Cache-Control": "no-store" } });
}
