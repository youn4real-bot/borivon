import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole, canActOnCandidate } from "@/lib/admin-auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/portal/admin/phase-slots/notify
 *
 * Fired after the admin Submits the slot placement wizard (LAW #34). Creates
 * the per-LAW-#21 notifications so the candidate (and other admins) know the
 * slot is ready to act on:
 *
 *   - candidate → bell ("you have a document to sign/fill")
 *   - all assigned admins → admin bell ("X sent Y a slot")
 *
 * Body: { slotId, candidateUserId, slotLabel }
 * Auth: any admin/sub-admin who can act on candidateUserId.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({})) as {
    slotId?: string;
    candidateUserId?: string;
    slotLabel?: string;
  };

  if (!body.slotId || !UUID_RE.test(body.slotId))
    return NextResponse.json({ error: "Missing slotId" }, { status: 400 });
  if (!body.candidateUserId || !UUID_RE.test(body.candidateUserId))
    return NextResponse.json({ error: "Missing candidateUserId" }, { status: 400 });

  if (!(await canActOnCandidate(auth.role, auth.email, body.candidateUserId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getServiceSupabase();
  const label = (body.slotLabel ?? "Document").trim() || "Document";

  // Look up candidate's display name for the admin-side bell message.
  const { data: cp } = await db
    .from("candidate_profiles")
    .select("first_name, last_name")
    .eq("user_id", body.candidateUserId)
    .maybeSingle();
  const cpRow = cp as { first_name?: string | null; last_name?: string | null } | null;
  const candidateName = [cpRow?.first_name, cpRow?.last_name].filter(Boolean).join(" ") || "Candidate";

  // 1) Candidate bell — LAW #21 + LAW #22: "Admin sends a B/V request to
  // candidate" with a deep-link target. doc_type="slot_setup" tells the bell
  // to route via ?slot=<id> (vs legacy "sign_request" which uses ?sign=<id>).
  await db.from("notifications").insert({
    user_id:  body.candidateUserId,
    doc_id:   body.slotId,
    doc_name: label,
    doc_type: "slot_setup",
    action:   "sign_request",
    feedback: null,
    read:     false,
  });

  // 2) Admin bell — LAW #21: "Any admin sends a B/V request → all assigned admins"
  await db.from("admin_notifications").insert({
    type:       "doc-uploaded",
    user_name:  candidateName,
    user_email: "",
    doc_type:   "sign_request",
    doc_name:   label,
  });

  return NextResponse.json({ ok: true });
}
