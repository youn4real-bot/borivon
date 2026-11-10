import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, requireUser, canActOnCandidate } from "@/lib/admin-auth";
import { enforceRateLimitDistributed } from "@/lib/rateLimit";
import { fxDb, nowIso, clean, cleanPlz, cleanDate } from "@/lib/facility/db";
import { STEP_IDS } from "@/lib/facility/steps";

/**
 * The arrival plan inside the portal (founder 2026-11-10: "day 1 … month 6"; the platform page's
 * "Ankommen und Bleiben"). One row per nurse in fx_arrival: arrival + first day + where she lives,
 * and the steps ticked. The nurse reads and edits her own; an admin (supreme, the Borivon team, or her
 * DIY facility) only for a nurse canActOnCandidate allows — so the DIY rules of LAW #25 hold here too.
 *
 *   GET   ?userId=            → the plan ({} when none yet)
 *   PUT   {userId?, arrival, start, plz, city}
 *   PATCH {userId?, step, done}
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Who = { userId: string; by: string };

async function who(req: NextRequest, asked: string | null): Promise<Who | NextResponse> {
  const admin = await requireAdminRole(req);
  if (admin.ok && asked) {
    if (!(await canActOnCandidate(admin.role, admin.email, asked))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    return { userId: asked, by: admin.email };
  }
  const user = await requireUser(req);
  if (!user.ok) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  // a nurse only ever reaches her own plan, whatever id she sends
  return { userId: user.userId, by: user.email };
}

const UUID = /^[0-9a-f-]{36}$/i;
const asked = (v: unknown) => (typeof v === "string" && UUID.test(v) ? v : null);

async function read(userId: string) {
  const db = (await fxDb())!;
  const r = (await db.run(`SELECT * FROM fx_arrival WHERE user_id = ?`, [userId])).results[0];
  if (!r) return { arrival: "", start: "", plz: "", city: "", steps: {} as Record<string, string> };
  let steps: Record<string, string> = {};
  try { const p = JSON.parse(String(r.steps || "{}")); if (p && typeof p === "object") steps = p; } catch { steps = {}; }
  return { arrival: String(r.arrival ?? ""), start: String(r.start ?? ""), plz: String(r.plz ?? ""), city: String(r.city ?? ""), steps };
}

export async function GET(req: NextRequest) {
  const w = await who(req, asked(req.nextUrl.searchParams.get("userId")));
  if (w instanceof NextResponse) return w;
  return NextResponse.json(await read(w.userId), { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: NextRequest) {
  const rl = await enforceRateLimitDistributed(req, "arrival-w", { limit: 120, windowMs: 3_600_000 });
  if (!rl.ok) return NextResponse.json({ error: "too_many" }, { status: 429 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const w = await who(req, asked(b.userId));
  if (w instanceof NextResponse) return w;
  const cur = await read(w.userId);
  const next = {
    arrival: "arrival" in b ? cleanDate(b.arrival) : cur.arrival,
    start: "start" in b ? cleanDate(b.start) : cur.start,
    plz: "plz" in b ? cleanPlz(b.plz) : cur.plz,
    city: "city" in b ? clean(b.city, 80) : cur.city,
  };
  const db = (await fxDb())!;
  await db.run(
    `INSERT INTO fx_arrival (user_id, arrival, start, plz, city, steps, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET arrival = excluded.arrival, start = excluded.start, plz = excluded.plz, city = excluded.city, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    [w.userId, next.arrival, next.start, next.plz, next.city, JSON.stringify(cur.steps), nowIso(), w.by],
  );
  return NextResponse.json({ ...next, steps: cur.steps }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(req: NextRequest) {
  const rl = await enforceRateLimitDistributed(req, "arrival-w", { limit: 240, windowMs: 3_600_000 });
  if (!rl.ok) return NextResponse.json({ error: "too_many" }, { status: 429 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof b.step !== "string" || !STEP_IDS.has(b.step)) return NextResponse.json({ error: "bad_step" }, { status: 400 });
  const w = await who(req, asked(b.userId));
  if (w instanceof NextResponse) return w;
  const cur = await read(w.userId);
  const steps = { ...cur.steps };
  if (b.done === true) steps[b.step] = nowIso(); else delete steps[b.step];
  const db = (await fxDb())!;
  await db.run(
    `INSERT INTO fx_arrival (user_id, steps, updated_at, updated_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET steps = excluded.steps, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    [w.userId, JSON.stringify(steps), nowIso(), w.by],
  );
  return NextResponse.json({ steps }, { headers: { "Cache-Control": "no-store" } });
}
