import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireUser } from "@/lib/admin-auth";
import { cleanPublicText } from "@/lib/sanitizeInput";
import { enforceRateLimit } from "@/lib/rateLimit";

/**
 * Candidate self-reports — a candidate logs their own latest step (passed /
 * didn't pass B2, passed / didn't pass / scheduled an interview, or a free
 * note). Self-service so the team doesn't have to chase and key everything in.
 *
 * The candidate is identified from their own JWT (requireUser) — they can only
 * ever log for themselves. A "didn't pass B2" also flips b2_failed = true so the
 * retake halo shows immediately on the admin board.
 *
 * POST { kind, outcome, note? }   GET → caller's recent reports
 */

const KINDS = new Set(["b2", "interview", "other"]);
const OUTCOMES = new Set(["passed", "failed", "scheduled", "note"]);

export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (!user.ok) return NextResponse.json({ error: user.error }, { status: user.status });

  const rl = enforceRateLimit(req, "self-report", { limit: 20, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: "Too many updates — slow down." }, { status: 429 });

  const body = await req.json().catch(() => ({}));
  const kind = typeof body?.kind === "string" ? body.kind : "";
  const outcome = typeof body?.outcome === "string" ? body.outcome : "";
  if (!KINDS.has(kind) || !OUTCOMES.has(outcome)) {
    return NextResponse.json({ error: "invalid kind/outcome" }, { status: 400 });
  }
  const note = cleanPublicText(body?.note, 280);

  const db = getServiceSupabase();
  const { error } = await db.from("candidate_self_reports").insert({
    candidate_user_id: user.userId, kind, outcome, note: note || null,
  });
  if (error) {
    console.error("[self-report] insert error:", error.message);
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }

  // "Didn't pass B2" → flip the persistent failed flag (safe, candidate-ownable).
  if (kind === "b2" && outcome === "failed") {
    await db.from("candidate_profiles").update({ b2_failed: true }).eq("user_id", user.userId);
  }

  return NextResponse.json({ ok: true });
}

export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (!user.ok) return NextResponse.json({ error: user.error }, { status: user.status });

  const db = getServiceSupabase();
  const { data, error } = await db
    .from("candidate_self_reports")
    .select("id, kind, outcome, note, created_at")
    .eq("candidate_user_id", user.userId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) {
    console.error("[self-report] list error:", error.message);
    return NextResponse.json({ reports: [] });
  }
  return NextResponse.json({ reports: data ?? [] });
}
