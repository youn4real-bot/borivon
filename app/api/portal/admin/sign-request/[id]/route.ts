import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole, canActOnCandidate } from "@/lib/admin-auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PATCH /api/portal/admin/sign-request/[id]
 * Body: { action: "accept" | "reject", feedback?: string }
 * Sets review_status on the sign_request and notifies the candidate.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: { action?: string; feedback?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { action, feedback } = body;
  if (action !== "accept" && action !== "reject") {
    return NextResponse.json({ error: "action must be 'accept' or 'reject'" }, { status: 400 });
  }
  if (action === "reject" && !feedback?.trim()) {
    return NextResponse.json({ error: "Feedback required for rejection" }, { status: 400 });
  }

  const db = getServiceSupabase();

  const { data: request } = await db
    .from("sign_requests")
    .select("id, candidate_user_id, document_name, status")
    .eq("id", id)
    .maybeSingle();

  if (!request) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const r = request as { id: string; candidate_user_id: string; document_name: string; status: string };

  if (r.status !== "signed") {
    return NextResponse.json({ error: "Can only review signed requests" }, { status: 409 });
  }

  if (!(await canActOnCandidate(auth.role, auth.email, r.candidate_user_id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error: updateErr } = await db
    .from("sign_requests")
    .update({
      review_status:   action === "accept" ? "accepted" : "rejected",
      review_feedback: action === "reject" ? feedback!.trim() : null,
    })
    .eq("id", id);

  if (updateErr) {
    console.error("[sign-request PATCH] update error:", updateErr);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  // Notify candidate — best-effort
  try {
    await db.from("notifications").insert({
      user_id:  r.candidate_user_id,
      doc_id:   id,
      doc_name: r.document_name,
      doc_type: r.document_name,
      action:   action === "accept" ? "approved" : "rejected",
      feedback: action === "reject" ? feedback!.trim() : null,
      read:     false,
    });
  } catch (e) {
    console.warn("[sign-request PATCH] notify failed (non-fatal):", e);
  }

  return NextResponse.json({ ok: true });
}
