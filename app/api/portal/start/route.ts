import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimitDistributed } from "@/lib/rateLimit";
import { fxDb, nowIso } from "@/lib/facility/db";
import { journeyOwner, askedId } from "@/lib/facility/portalAccess";

/**
 * Her first working day ("Arbeitsstart", founder 2026-11-12 sample 1): one big countdown, the Einrichtung,
 * the day, hour and ward, a "Wegbeschreibung" to the Einrichtung's address, and three "what to bring" ticks.
 *   GET ?userId=                       → { date, time, ward, place, address, bring }
 *   PUT { userId?, time?, ward? }      → admins (the date itself is fx_arrival.start, set on her board)
 *   PUT { userId?, bring: {...} }      → she (or an admin) ticks what she has packed
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
const BRING = ["passport", "contract", "shoes"] as const;
const parse = (v: unknown): Record<string, boolean> => {
  try { const p = JSON.parse(String(v || "{}")); return p && typeof p === "object" ? p as Record<string, boolean> : {}; } catch { return {}; }
};

async function read(userId: string) {
  const db = (await fxDb())!;
  const [row, arr, emp] = await Promise.all([
    db.run(`SELECT time, ward, bring FROM fx_start WHERE user_id = ?`, [userId]).then((r) => r.results[0] as { time?: string; ward?: string; bring?: string } | undefined),
    db.run(`SELECT start FROM fx_arrival WHERE user_id = ?`, [userId]).then((r) => (r.results[0] as { start?: string } | undefined)?.start ?? ""),
    db.run(`SELECT e.name AS name, e.address_lines AS addr FROM candidate_profiles p JOIN employers e ON e.id = p.employer_id WHERE p.user_id = ?`, [userId])
      .then((r) => r.results[0] as { name?: string; addr?: string } | undefined).catch(() => undefined),
  ]);
  let address = "";
  try { const a = JSON.parse(String(emp?.addr ?? "[]")); if (Array.isArray(a)) address = a.map((x) => String(x ?? "").trim()).filter(Boolean).join(", "); } catch { address = ""; }
  const b = parse(row?.bring);
  return {
    date: /^\d{4}-\d{2}-\d{2}$/.test(arr) ? arr : "",
    time: /^\d{2}:\d{2}$/.test(row?.time ?? "") ? row!.time! : "",
    ward: row?.ward ?? "",
    place: emp?.name ?? "",
    address,
    bring: Object.fromEntries(BRING.map((k) => [k, !!b[k]])) as Record<(typeof BRING)[number], boolean>,
  };
}

export async function GET(req: NextRequest) {
  const w = await journeyOwner(req, askedId(req.nextUrl.searchParams.get("userId")));
  if (w instanceof NextResponse) return w;
  return NextResponse.json({ ...(await read(w.userId)), admin: w.admin }, { headers: NO_STORE });
}

export async function PUT(req: NextRequest) {
  const rl = await enforceRateLimitDistributed(req, "start-w", { limit: 240, windowMs: 3_600_000 });
  if (!rl.ok) return NextResponse.json({ error: "too_many" }, { status: 429 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const w = await journeyOwner(req, askedId(b.userId));
  if (w instanceof NextResponse) return w;
  const db = (await fxDb())!;
  const cur = (await db.run(`SELECT time, ward, bring FROM fx_start WHERE user_id = ?`, [w.userId])).results[0] as { time?: string; ward?: string; bring?: string } | undefined;
  let time = cur?.time ?? "", ward = cur?.ward ?? "";
  const bring = parse(cur?.bring);
  if ("time" in b || "ward" in b) {
    if (!w.admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    if ("time" in b) { const v = String(b.time ?? ""); if (v && !/^\d{2}:\d{2}$/.test(v)) return NextResponse.json({ error: "bad_time" }, { status: 400 }); time = v; }
    if ("ward" in b) ward = String(b.ward ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  }
  if (b.bring && typeof b.bring === "object") for (const k of BRING) if (k in (b.bring as Record<string, unknown>)) bring[k] = !!(b.bring as Record<string, unknown>)[k];
  await db.run(
    `INSERT INTO fx_start (user_id, time, ward, bring, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET time = excluded.time, ward = excluded.ward, bring = excluded.bring, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    [w.userId, time, ward, JSON.stringify(Object.fromEntries(BRING.map((k) => [k, !!bring[k]]))), nowIso(), w.by],
  );
  return NextResponse.json({ ...(await read(w.userId)), admin: w.admin }, { headers: NO_STORE });
}
