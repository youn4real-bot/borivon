import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole, canActOnCandidate } from "@/lib/admin-auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Allowed columns sub-admins / admins may write to candidate_pipeline.
// Anything outside this list is silently dropped (mass-assignment prevention).
const ALLOWED_PIPELINE_FIELDS = new Set<string>([
  "interview_link", "interview_date", "interview_status",
  "recognition_unlocked", "embassy_unlocked",
  "visa_granted", "visa_date",
  "flight_date", "flight_info",
  "docs_approved",
  // interview_type, interview_notes, integration_unlocked, start_unlocked
  // require migration pipeline_gespräch.sql — added back once DB is updated
]);

// GET — admin reads a candidate's pipeline by userId
export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId || !UUID_RE.test(userId)) return NextResponse.json({ error: "Missing userId" }, { status: 400 });

  if (!(await canActOnCandidate(auth.role, auth.email, userId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getServiceSupabase();
  const { data, error } = await db
    .from("candidate_pipeline")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[pipeline GET] failed:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  return NextResponse.json({ pipeline: data ?? null });
}

// PATCH — admin updates a candidate's pipeline
export async function PATCH(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({}));
  const { userId, ...rawFields } = body as Record<string, unknown>;
  if (typeof userId !== "string" || !UUID_RE.test(userId)) {
    return NextResponse.json({ error: "Missing userId" }, { status: 400 });
  }

  if (!(await canActOnCandidate(auth.role, auth.email, userId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Allowlist filter + sanitise: empty strings → null for date/timestamp cols
  // (Postgres rejects "" for date/timestamptz and returns a type error → 500).
  const DATE_FIELDS = new Set(["interview_date", "visa_date", "flight_date"]);
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rawFields)) {
    if (!ALLOWED_PIPELINE_FIELDS.has(k)) continue;
    fields[k] = (DATE_FIELDS.has(k) && v === "") ? null : v;
  }

  const db = getServiceSupabase();

  // Try UPDATE first; if no row exists yet, INSERT.
  // Avoids onConflict constraint dependency (schema-agnostic).
  const { data: updated, error: updateErr } = await db
    .from("candidate_pipeline")
    .update(fields)
    .eq("user_id", userId)
    .select("user_id");

  if (updateErr) {
    console.error("[pipeline PATCH] update failed:", updateErr);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  if (!updated || updated.length === 0) {
    // Row doesn't exist yet — insert it
    const { error: insertErr } = await db
      .from("candidate_pipeline")
      .insert({ user_id: userId, ...fields });
    if (insertErr) {
      console.error("[pipeline PATCH] insert failed:", insertErr);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
  }

  // Notify candidate when interview result is set
  // Map "passed" → "approved" and "failed" → "rejected" to match the bell's
  // supported action values ("approved" | "rejected" | "verified" | "placed").
  if (fields.interview_status === "passed" || fields.interview_status === "failed") {
    const notifAction = fields.interview_status === "passed" ? "approved" : "rejected";
    await db.from("notifications").insert({
      user_id: userId,
      doc_id: null,
      doc_name: "Interview",
      doc_type: "Interview",
      action: notifAction,
      feedback: null,
      read: false,
    }).select(); // ignore error if notifications table has constraints
  }

  return NextResponse.json({ success: true });
}
