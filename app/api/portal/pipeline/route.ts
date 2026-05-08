import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole, canActOnCandidate } from "@/lib/admin-auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Allowed columns sub-admins / admins may write to candidate_pipeline.
// Anything outside this list is silently dropped (mass-assignment prevention).
const ALLOWED_PIPELINE_FIELDS = new Set<string>([
  "interview_link", "interview_date", "interview_status",
  "interview_type", "interview_notes",
  "recognition_unlocked", "embassy_unlocked",
  "visa_granted", "visa_date",
  "flight_date", "flight_info",
  "docs_approved",
  "integration_unlocked", "start_unlocked",
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

  // interview_notes is internal admin-only — strip from sub-admin (org) responses
  const pipeline = data ? { ...data } : null;
  if (pipeline && auth.role !== "admin") {
    delete (pipeline as Record<string, unknown>).interview_notes;
  }
  return NextResponse.json({ pipeline });
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

  // interview_notes is internal admin-only — sub-admins cannot write it
  const allowedFields = auth.role === "admin"
    ? ALLOWED_PIPELINE_FIELDS
    : new Set([...ALLOWED_PIPELINE_FIELDS].filter(f => f !== "interview_notes"));

  // Allowlist filter + sanitise: empty strings → null for date/timestamp cols
  // (Postgres rejects "" for date/timestamptz and returns a type error → 500).
  const DATE_FIELDS = new Set(["interview_date", "visa_date", "flight_date"]);
  const VALID_INTERVIEW_STATUS = new Set(["pending", "passed", "failed"]);
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rawFields)) {
    if (!allowedFields.has(k)) continue;
    if (k === "interview_status" && typeof v === "string" && !VALID_INTERVIEW_STATUS.has(v)) continue;
    fields[k] = (DATE_FIELDS.has(k) && v === "") ? null : v;
  }

  const db = getServiceSupabase();

  // Read prior interview_status so we can suppress duplicate notifications
  // when the same value is re-saved (admin clicks the same button twice).
  let prevInterviewStatus: string | null = null;
  if (fields.interview_status === "passed" || fields.interview_status === "failed") {
    const { data: prev } = await db
      .from("candidate_pipeline")
      .select("interview_status")
      .eq("user_id", userId)
      .maybeSingle();
    prevInterviewStatus = (prev as { interview_status?: string | null } | null)?.interview_status ?? null;
  }

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

  // Notify candidate when interview result transitions into passed/failed.
  // Suppress when the value didn't actually change — admin re-clicks the same
  // button shouldn't spam the candidate.
  if (
    (fields.interview_status === "passed" || fields.interview_status === "failed") &&
    fields.interview_status !== prevInterviewStatus
  ) {
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
