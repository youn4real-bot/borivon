import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimitDistributed } from "@/lib/rateLimit";
import { fxDb, nowIso } from "@/lib/facility/db";
import { journeyOwner, askedId } from "@/lib/facility/portalAccess";

/**
 * Her first salary ("Gehalt", founder 2026-11-12 sample 3): three things that make it arrive on time
 * (bank account, Steuer-ID, Krankenkasse) she ticks herself, and the payday her admins enter. No amounts:
 * nothing about her pay is guessed.
 *   GET ?userId=                     → { payday, ticks }
 *   PUT { userId?, payday? }         → admins ("YYYY-MM-DD", "" clears)
 *   PUT { userId?, ticks: {...} }    → she (or an admin)
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
const KEYS = ["bank", "taxid", "health"] as const;
const parse = (v: unknown): Record<string, boolean> => {
  try { const p = JSON.parse(String(v || "{}")); return p && typeof p === "object" ? p as Record<string, boolean> : {}; } catch { return {}; }
};
type Row = { payday?: string; ticks?: string } | undefined;

const shape = (row: Row) => {
  const t = parse(row?.ticks);
  return {
    payday: /^\d{4}-\d{2}-\d{2}$/.test(row?.payday ?? "") ? row!.payday! : "",
    ticks: Object.fromEntries(KEYS.map((k) => [k, !!t[k]])) as Record<(typeof KEYS)[number], boolean>,
  };
};

export async function GET(req: NextRequest) {
  const w = await journeyOwner(req, askedId(req.nextUrl.searchParams.get("userId")));
  if (w instanceof NextResponse) return w;
  const db = (await fxDb())!;
  const row = (await db.run(`SELECT payday, ticks FROM fx_salary WHERE user_id = ?`, [w.userId])).results[0] as Row;
  return NextResponse.json({ ...shape(row), admin: w.admin }, { headers: NO_STORE });
}

export async function PUT(req: NextRequest) {
  const rl = await enforceRateLimitDistributed(req, "salary-w", { limit: 240, windowMs: 3_600_000 });
  if (!rl.ok) return NextResponse.json({ error: "too_many" }, { status: 429 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const w = await journeyOwner(req, askedId(b.userId));
  if (w instanceof NextResponse) return w;
  const db = (await fxDb())!;
  const cur = (await db.run(`SELECT payday, ticks FROM fx_salary WHERE user_id = ?`, [w.userId])).results[0] as Row;
  let payday = cur?.payday ?? "";
  const ticks = parse(cur?.ticks);
  if ("payday" in b) {
    if (!w.admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const v = String(b.payday ?? "");
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return NextResponse.json({ error: "bad_payday" }, { status: 400 });
    payday = v;
  }
  if (b.ticks && typeof b.ticks === "object") for (const k of KEYS) if (k in (b.ticks as Record<string, unknown>)) ticks[k] = !!(b.ticks as Record<string, unknown>)[k];
  const t = JSON.stringify(Object.fromEntries(KEYS.map((k) => [k, !!ticks[k]])));
  await db.run(
    `INSERT INTO fx_salary (user_id, payday, ticks, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET payday = excluded.payday, ticks = excluded.ticks, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    [w.userId, payday, t, nowIso(), w.by],
  );
  return NextResponse.json({ ...shape({ payday, ticks: t }), admin: w.admin }, { headers: NO_STORE });
}
