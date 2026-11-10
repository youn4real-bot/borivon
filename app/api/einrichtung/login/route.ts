import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimitDistributed } from "@/lib/rateLimit";
import { sendFacilityEmail } from "@/lib/email";
import { fxDb, cleanEmail } from "@/lib/facility/db";
import { createLink, sameOrigin } from "@/lib/facility/auth";
import { loginMail } from "@/lib/facility/mail";
import { FX_LANGS, type Lang } from "@/lib/facility/steps";

/**
 * POST {email, lang} → a one-time login link by email. Always answers the same, so the form never
 * tells a stranger whether an email has an account.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const rl = await enforceRateLimitDistributed(req, "fx-login", { limit: 8, windowMs: 3_600_000 });
  if (!rl.ok) return NextResponse.json({ error: "too_many" }, { status: 429 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const email = cleanEmail(body.email);
  if (!email) return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  const lang: Lang = FX_LANGS.includes(body.lang as Lang) ? (body.lang as Lang) : "de";
  const db = await fxDb();
  if (!db) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  const { results } = await db.run(
    `SELECT u.id FROM fx_users u JOIN fx_facilities f ON f.id = u.facility_id WHERE u.email = ? AND f.status = 'active'`,
    [email],
  );
  if (results[0]) {
    const token = await createLink("login", email);
    const m = loginMail(lang, `https://borivon.com/einrichtung/anmelden?k=${encodeURIComponent(token)}`);
    await sendFacilityEmail({ to: email, ...m });
  }
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
