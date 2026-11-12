import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimitDistributed } from "@/lib/rateLimit";
import { fxDb, nowIso } from "@/lib/facility/db";
import { journeyOwner, askedId } from "@/lib/facility/portalAccess";
import { FILE_KEY_ALL_LABELS } from "@/lib/fileKeys";

/**
 * Her next job interview ("Gespräche", founder 2026-11-12 sample 3): one big countdown, the Einrichtung,
 * the video link, three little prep ticks, and how many talks / yeses so far.
 *   GET ?userId=                          → { at, link, place, prep, cv, held, yes }
 *   PUT { userId?, at?, link?, place? }   → admins set the talk (local German time "YYYY-MM-DDTHH:MM", "" clears)
 *   PUT { userId?, prep: { cam?, q? } }   → she (or an admin) ticks her prep
 * The Einrichtung defaults to her employer; held / yes come from candidate_pipeline (interview1/2).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const PREP_KEYS = ["cam", "q"] as const;
const CV_LABELS = [...(FILE_KEY_ALL_LABELS["cv_de"] ?? new Set<string>(["Lebenslauf"]))];

type Row = { at?: string; link?: string; place?: string; prep?: string } | undefined;
const parsePrep = (v: unknown): Record<string, boolean> => {
  try { const p = JSON.parse(String(v || "{}")); return p && typeof p === "object" ? p as Record<string, boolean> : {}; } catch { return {}; }
};

async function read(userId: string) {
  const db = (await fxDb())!;
  const [row, emp, pipe, cv] = await Promise.all([
    db.run(`SELECT at, link, place, prep FROM fx_talk WHERE user_id = ?`, [userId]).then((r) => r.results[0] as Row),
    db.run(`SELECT e.name AS name FROM candidate_profiles p JOIN employers e ON e.id = p.employer_id WHERE p.user_id = ?`, [userId])
      .then((r) => (r.results[0] as { name?: string } | undefined)?.name ?? "").catch(() => ""),
    db.run(`SELECT interview1_status s1, interview2_status s2, interview1_held h1, interview2_held h2 FROM candidate_pipeline WHERE user_id = ?`, [userId])
      .then((r) => r.results[0] as { s1?: string | null; s2?: string | null; h1?: number; h2?: number } | undefined).catch(() => undefined),
    db.run(`SELECT id FROM documents WHERE user_id = ? AND file_type IN (${CV_LABELS.map(() => "?").join(",")}) AND superseded_at IS NULL LIMIT 1`, [userId, ...CV_LABELS])
      .then((r) => r.results.length > 0).catch(() => false),
  ]);
  const passed = [pipe?.s1, pipe?.s2].filter((s) => s === "passed").length;
  const held = Math.max(Number(pipe?.h1 ?? 0) + Number(pipe?.h2 ?? 0), passed);
  const prep = parsePrep(row?.prep);
  return {
    at: AT.test(row?.at ?? "") ? row!.at! : "",
    link: row?.link ?? "",
    place: row?.place || emp || "",
    prep: { cam: !!prep.cam, q: !!prep.q },
    cv,
    held,
    yes: passed,
  };
}

export async function GET(req: NextRequest) {
  const w = await journeyOwner(req, askedId(req.nextUrl.searchParams.get("userId")));
  if (w instanceof NextResponse) return w;
  return NextResponse.json({ ...(await read(w.userId)), admin: w.admin }, { headers: NO_STORE });
}

export async function PUT(req: NextRequest) {
  const rl = await enforceRateLimitDistributed(req, "talk-w", { limit: 240, windowMs: 3_600_000 });
  if (!rl.ok) return NextResponse.json({ error: "too_many" }, { status: 429 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const w = await journeyOwner(req, askedId(b.userId));
  if (w instanceof NextResponse) return w;
  const db = (await fxDb())!;
  const cur = (await db.run(`SELECT at, link, place, prep FROM fx_talk WHERE user_id = ?`, [w.userId])).results[0] as Row;
  let at = cur?.at ?? "", link = cur?.link ?? "", place = cur?.place ?? "";
  const prep = parsePrep(cur?.prep);
  // the talk itself: admins only
  if ("at" in b || "link" in b || "place" in b) {
    if (!w.admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    if ("at" in b) { const v = String(b.at ?? ""); if (v && !AT.test(v)) return NextResponse.json({ error: "bad_at" }, { status: 400 }); at = v; }
    if ("link" in b) { const v = String(b.link ?? "").trim().slice(0, 500); if (v && !/^https:\/\//i.test(v)) return NextResponse.json({ error: "bad_link" }, { status: 400 }); link = v; }
    if ("place" in b) place = String(b.place ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  }
  // her prep ticks: she or her admins
  if (b.prep && typeof b.prep === "object") {
    for (const k of PREP_KEYS) if (k in (b.prep as Record<string, unknown>)) prep[k] = !!(b.prep as Record<string, unknown>)[k];
  }
  await db.run(
    `INSERT INTO fx_talk (user_id, at, link, place, prep, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET at = excluded.at, link = excluded.link, place = excluded.place, prep = excluded.prep,
       updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    [w.userId, at, link, place, JSON.stringify({ cam: !!prep.cam, q: !!prep.q }), nowIso(), w.by],
  );
  return NextResponse.json({ ...(await read(w.userId)), admin: w.admin }, { headers: NO_STORE });
}
