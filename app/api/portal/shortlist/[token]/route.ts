/**
 * PUBLIC read-only shortlist view (no login) — the employer's window.
 *
 * Resolves a shortlist by its unguessable share_token, and ONLY when the admin
 * has flipped it to status='shared'. Returns SUMMARY cards only (name, photo,
 * profession, city, B2, experience, verification, doc-completeness) — never
 * email/phone, never passport bytes, never raw documents. A draft or unknown
 * token 404s identically, so a leaked draft link reveals nothing.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { getCandidateSummaries, toPublicSummary, type ShortlistCandidateSummary } from "@/lib/shortlist";
import { enforceRateLimitDistributed } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMPTY: ShortlistCandidateSummary = {
  userId: "", name: "—", email: "", photo: null, verified: false, nationality: null,
  city: null, profession: null, b2Stage: null, yearsExperience: null,
  docCount: 0, docsOk: 0, docsPending: 0, hasCvDraft: false,
};

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const rl = await enforceRateLimitDistributed(req, "shortlist-view", { limit: 60, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });

  const { token } = await ctx.params;
  // Fail fast on anything that isn't a plausible token — no DB hit on garbage.
  if (!/^[a-f0-9]{16,128}$/.test(token || "")) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const db = getServiceSupabase();
  const { data } = await db
    .from("employer_shortlists")
    .select("id, title, note, status, org_id")
    .eq("share_token", token)
    .maybeSingle();
  if (!data || (data as { status: string }).status !== "shared") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const sl = data as { id: string; title: string; note: string | null; org_id: string | null };

  let agency: string | null = null;
  if (sl.org_id) {
    const { data: org } = await db.from("organizations").select("name").eq("id", sl.org_id).maybeSingle();
    if (org) agency = (org as { name: string }).name;
  }

  const { data: mem } = await db
    .from("shortlist_candidates")
    .select("candidate_user_id, position, admin_note")
    .eq("shortlist_id", sl.id)
    .order("position", { ascending: true });
  const rows = (mem ?? []) as { candidate_user_id: string; position: number; admin_note: string | null }[];
  const summaries = await getCandidateSummaries(rows.map((r) => r.candidate_user_id));

  const candidates = rows.map((r) => ({
    adminNote: r.admin_note ?? "",
    ...toPublicSummary(summaries[r.candidate_user_id] ?? { ...EMPTY, userId: r.candidate_user_id }),
  }));

  return NextResponse.json({ title: sl.title, note: sl.note ?? "", agency, candidates });
}
