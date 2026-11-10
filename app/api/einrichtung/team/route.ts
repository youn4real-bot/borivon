import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimitDistributed } from "@/lib/rateLimit";
import { sendFacilityEmail } from "@/lib/email";
import { fxDb, cleanEmail, FREE_USERS } from "@/lib/facility/db";
import { requireFacility, createLink, sameOrigin } from "@/lib/facility/auth";
import { inviteMail } from "@/lib/facility/mail";
import { FX_LANGS, type Lang } from "@/lib/facility/steps";

/** POST {email, lang} → invite a colleague (owner only). The link works 7 days. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const auth = await requireFacility(req);
  if (!auth) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  if (auth.user.role !== "owner") return NextResponse.json({ error: "owner_only" }, { status: 403 });
  const rl = await enforceRateLimitDistributed(req, "fx-invite", { limit: 10, windowMs: 86_400_000 });
  if (!rl.ok) return NextResponse.json({ error: "too_many" }, { status: 429 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const email = cleanEmail(b.email);
  if (!email) return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  const lang: Lang = FX_LANGS.includes(b.lang as Lang) ? (b.lang as Lang) : "de";
  const db = (await fxDb())!;
  const n = Number((await db.run(`SELECT COUNT(*) AS n FROM fx_users WHERE facility_id = ?`, [auth.facility.id])).results[0]?.n ?? 0);
  if (n >= FREE_USERS) return NextResponse.json({ error: "limit", limit: FREE_USERS }, { status: 403 });
  const taken = (await db.run(`SELECT facility_id FROM fx_users WHERE email = ?`, [email])).results[0];
  if (taken) return NextResponse.json({ error: String(taken.facility_id) === auth.facility.id ? "already" : "other" }, { status: 409 });
  const token = await createLink("invite", email, auth.facility.id);
  const who = [auth.user.salutation === "frau" ? "Frau" : auth.user.salutation === "herr" ? "Herr" : "", auth.user.last_name].filter(Boolean).join(" ") || auth.user.email;
  const m = inviteMail(lang, `https://borivon.com/einrichtung/anmelden?k=${encodeURIComponent(token)}`, who, auth.facility.name);
  const ok = await sendFacilityEmail({ to: email, ...m });
  return NextResponse.json(ok ? { ok: true } : { error: "send_failed" }, { status: ok ? 200 : 502, headers: { "Cache-Control": "no-store" } });
}
