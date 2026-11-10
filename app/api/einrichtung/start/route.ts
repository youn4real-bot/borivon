import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { enforceRateLimitDistributed } from "@/lib/rateLimit";
import { verifyLeadToken } from "@/lib/roadmap/token";
import { parseDetails } from "@/lib/roadmap/leadState";
import { isFormV2, normalizeForm, facilityTypeOf } from "@/lib/roadmap/form";
import { clientIp } from "@/lib/roadmap/consent";
import { trackServer } from "@/lib/track/server";
import { keepAlive } from "@/lib/keepAlive";
import { sendAdminAlertEmail } from "@/lib/email";
import { fxDb, newId, nowIso, clean, cleanPlz, TERMS_VERSION } from "@/lib/facility/db";
import { createSession, sessionCookie, sameOrigin } from "@/lib/facility/auth";
import { sampleNurse } from "@/lib/facility/sample";

/**
 * The gift on the last page of the Fahrplan (founder 2026-11-10): the personal link opens
 * /einrichtung/start?id=&t= → this route.
 *   GET  → who it is for (prefill), and the click counted (event platform_open)
 *   POST → the workspace is created (terms + AVV accepted by two human clicks), signed in
 * Only a confirmed, not wiped Fahrplan lead can open it; one workspace per lead and per email.
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
  const form = isFormV2(d.form) ? normalizeForm(d.form as Record<string, unknown>) : null;
  const facility = String(d.facility ?? "");
  return {
    id, d, email,
    salutation: String(d.salutation ?? ""),
    lastName: String(d.lastName ?? ""),
    // v2 stores "Pflegeheim · Bayern" as facility: a description, not a name
    facilityName: facility.includes("·") ? "" : facility,
    kind: form ? facilityTypeOf(form) : "",
    src: String(((d as Record<string, unknown>).track as { src?: unknown } | undefined)?.src ?? ""),
  };
}

export async function GET(req: NextRequest) {
  const rl = await enforceRateLimitDistributed(req, "fx-start", { limit: 60, windowMs: 3_600_000 });
  if (!rl.ok) return NextResponse.json({ error: "too_many" }, { status: 429 });
  const sp = req.nextUrl.searchParams;
  const lead = await loadLead(sp.get("id") ?? "", sp.get("t") ?? "");
  if (!lead) return NextResponse.json({ error: "invalid_link" }, { status: 403 });
  const db = await fxDb();
  if (!db) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  const ex = await db.run(`SELECT id FROM fx_users WHERE email = ?`, [lead.email]);
  keepAlive(() => trackServer(req, { path: "/einrichtung/start", src: lead.src, lid: lead.id }, [{ type: "platform_open", lead_id: lead.id }]));
  return NextResponse.json(
    { email: lead.email, salutation: lead.salutation, lastName: lead.lastName, facility: lead.facilityName, kind: lead.kind, existing: ex.results.length > 0 },
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
  const name = clean(body.name, 120), plz = cleanPlz(body.plz), city = clean(body.city, 80), street = clean(body.street, 120);
  if (!name) return NextResponse.json({ error: "name_required" }, { status: 400 });
  if (!plz) return NextResponse.json({ error: "plz_required" }, { status: 400 });

  const db = await fxDb();
  if (!db) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  const ex = await db.run(`SELECT * FROM fx_users WHERE email = ?`, [lead.email]);
  if (ex.results[0]) return NextResponse.json({ error: "exists" }, { status: 409 });

  const now = nowIso(), fid = newId(), uid = newId();
  const kind = ["hospital", "care_home", "home_care"].includes(String(body.kind)) ? String(body.kind) : lead.kind;
  await db.run(
    `INSERT INTO fx_facilities (id, lead_id, name, kind, street, plz, city, terms_version, terms_at, terms_ip, avv_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
    [fid, lead.id, name, kind, street, plz, city, TERMS_VERSION, now, clientIp(req.headers), now, now],
  );
  try {
    await db.run(`INSERT INTO fx_users (id, facility_id, email, salutation, last_name, role, created_at) VALUES (?, ?, ?, ?, ?, 'owner', ?)`,
      [uid, fid, lead.email, lead.salutation, lead.lastName, now]);
  } catch {
    // a double click raced us: the email is taken now → undo the facility, report "exists"
    await db.run(`DELETE FROM fx_facilities WHERE id = ?`, [fid]);
    return NextResponse.json({ error: "exists" }, { status: 409 });
  }
  // an example nurse, so the workspace is not empty on the first look (marked "Beispiel", never counted)
  const s = sampleNurse(fid, plz, city);
  await db.run(
    `INSERT INTO fx_nurses (id, facility_id, first_name, last_name, country, arrival, start, plz, city, steps, share_token, sample, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [s.id, fid, s.first_name, s.last_name, s.country, s.arrival, s.start, s.plz, s.city, JSON.stringify(s.steps), s.share_token, now, now],
  );
  const token = await createSession(uid);
  keepAlive(async () => {
    await trackServer(req, { path: "/einrichtung/start", src: lead.src, lid: lead.id }, [{ type: "platform_signup", lead_id: lead.id }]);
    await sendAdminAlertEmail(`Plattform: neue Einrichtung (${name})`, `${name}, ${plz} ${city}\n${lead.email}\nhttps://borivon.com/portal/admin/traffic`);
  });
  return NextResponse.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie(token), "Cache-Control": "no-store" } });
}
