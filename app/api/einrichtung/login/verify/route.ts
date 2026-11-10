import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimitDistributed } from "@/lib/rateLimit";
import { fxDb, newId, nowIso, FREE_USERS } from "@/lib/facility/db";
import { useLink, createSession, sessionCookie, sameOrigin } from "@/lib/facility/auth";

/**
 * POST {k} — the token from a login or invite mail, sent by the button on /einrichtung/anmelden.
 * A POST on purpose: mail scanners (Microsoft Safe Links etc.) open every link in a mail with GET,
 * which would burn a one-time link before the person ever clicks it.
 * Used once; then a session cookie. An invite adds the person to the team (if there is room).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail("forbidden", 403);
  const rl = await enforceRateLimitDistributed(req, "fx-verify", { limit: 30, windowMs: 3_600_000 });
  if (!rl.ok) return fail("too_many", 429);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const link = await useLink(typeof body.k === "string" ? body.k : "");
  if (!link) return fail("link");
  const db = await fxDb();
  if (!db) return fail("unavailable", 503);

  let user = (await db.run(`SELECT id, facility_id FROM fx_users WHERE email = ?`, [link.email])).results[0];
  if (link.kind === "invite") {
    if (user && String(user.facility_id) !== link.facilityId) return fail("other"); // already in another workspace
    if (!user) {
      const n = Number((await db.run(`SELECT COUNT(*) AS n FROM fx_users WHERE facility_id = ?`, [link.facilityId])).results[0]?.n ?? 0);
      if (n >= FREE_USERS) return fail("full");
      const id = newId();
      await db.run(`INSERT INTO fx_users (id, facility_id, email, role, created_at) VALUES (?, ?, ?, 'member', ?)`, [id, link.facilityId, link.email, nowIso()]);
      user = { id, facility_id: link.facilityId };
    }
  }
  if (!user) return fail("link");
  const token = await createSession(String(user.id));
  return NextResponse.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie(token), "Cache-Control": "no-store" } });
}
