import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase, getAnonVerifyClient } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  // ── Auth: verify JWT ──────────────────────────────────────────────────────
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ pipeline: null }, { status: 401 });
  }
  const jwt = authHeader.slice(7);
  const { data: { user }, error: authErr } = await getAnonVerifyClient().auth.getUser(jwt);
  if (authErr || !user) {
    return NextResponse.json({ pipeline: null }, { status: 401 });
  }

  // Use verified user.id — ignore any uid param from client
  const db = getServiceSupabase();
  // interview_notes is intentionally excluded — internal admin use only
  const { data } = await db
    .from("candidate_pipeline")
    .select("interview_link, interview_date, interview_status, interview_type, recognition_unlocked, embassy_unlocked, visa_granted, visa_date, flight_date, flight_info, docs_approved, integration_unlocked, start_unlocked")
    .eq("user_id", user.id)
    .maybeSingle();

  return NextResponse.json({ pipeline: data ?? null });
}
