import { NextRequest, NextResponse } from "next/server";
import { fxDb } from "@/lib/facility/db";
import { journeyOwner, askedId } from "@/lib/facility/portalAccess";
import { profileFacts } from "@/lib/facility/profile";

/**
 * Her profile card ("Profil", founder 2026-11-12 sample 1): role, city, German level, years of work and her
 * departments, read from her CV builder (candidate_profiles.cv_draft) + fx_lang, and her first working day
 * when entered (fx_arrival.start). Read-only. GET ?userId=  (a nurse: her own; an admin: the nurse's)
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const w = await journeyOwner(req, askedId(req.nextUrl.searchParams.get("userId")));
  if (w instanceof NextResponse) return w;
  const db = (await fxDb())!;
  const [prof, lang, arr] = await Promise.all([
    db.run(`SELECT cv_draft FROM candidate_profiles WHERE user_id = ?`, [w.userId]).then((r) => r.results[0] as { cv_draft?: unknown } | undefined),
    db.run(`SELECT level FROM fx_lang WHERE user_id = ?`, [w.userId]).then((r) => (r.results[0] as { level?: string } | undefined)?.level ?? ""),
    db.run(`SELECT start FROM fx_arrival WHERE user_id = ?`, [w.userId]).then((r) => (r.results[0] as { start?: string } | undefined)?.start ?? "").catch(() => ""),
  ]);
  let draft: unknown = prof?.cv_draft ?? null;
  if (typeof draft === "string") { try { draft = JSON.parse(draft); } catch { draft = null; } }
  const facts = profileFacts(draft as Parameters<typeof profileFacts>[0], lang);
  return NextResponse.json({ ...facts, start: /^\d{4}-\d{2}-\d{2}$/.test(arr) ? arr : "", hasCv: !!draft }, { headers: { "Cache-Control": "no-store" } });
}
