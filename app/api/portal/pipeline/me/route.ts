import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase, getAnonVerifyClient } from "@/lib/supabase";
import { enforceUserRateLimit } from "@/lib/rateLimit";

/**
 * A candidate reading her OWN pipeline row — which stages the admin has opened.
 *
 * THE BUG THIS ROUTE EXISTS TO PREVENT: every failure here used to answer
 * `{ pipeline: null }`, byte-for-byte what a candidate with no pipeline row
 * gets. An expired JWT (401) was therefore indistinguishable from "you have no
 * pipeline yet", and the dashboard — which did not look at the status either —
 * read that as "no stage is unlocked" and showed a candidate whose Visum stage
 * the founder had explicitly unlocked the "Upgrade to Premium" box instead.
 * LAW #31/#32: the lock is the supreme admin's discretion alone, and a dropped
 * read silently re-locking a stage he opened is that discretion being
 * overridden by a network hiccup.
 *
 * So `pipeline` appears in the body ONLY when we actually read the row. Every
 * failure carries `error` and no `pipeline` key at all, and the client treats a
 * body with no `pipeline` key as "I could not find out" (lib/pipelineLoad.ts).
 */
export async function GET(req: NextRequest) {
  // ── Auth: verify JWT ──────────────────────────────────────────────────────
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const jwt = authHeader.slice(7);
  const { data: { user }, error: authErr } = await getAnonVerifyClient().auth.getUser(jwt);
  if (authErr || !user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const rl = await enforceUserRateLimit("me-read", `u:${user.id}`, { limit: 60, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });

  // Use verified user.id — ignore any uid param from client
  const db = getServiceSupabase();
  // interview_notes is intentionally excluded — internal admin use only
  const { data, error } = await db
    .from("candidate_pipeline")
    .select("interview_link, interview_date, interview_status, interview_type, recognition_unlocked, embassy_unlocked, visa_granted, visa_date, flight_date, flight_info, docs_approved, integration_unlocked, start_unlocked")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[pipeline/me GET] db error:", error);
    return NextResponse.json({ error: "pipeline_read_failed" }, { status: 500 });
  }

  // The ONLY body that carries a `pipeline` key. `null` here means the row
  // genuinely does not exist yet — a fact, not a failure.
  return NextResponse.json({ pipeline: data ?? null });
}
