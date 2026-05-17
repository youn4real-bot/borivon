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
    needsSign?: boolean;  // candidate has a sig zone to act on
    needsFill?: boolean;  // candidate has at least one free-fill field
  };

  if (!body.slotId || !UUID_RE.test(body.slotId))
    return NextResponse.json({ error: "Missing slotId" }, { status: 400 });
  if (!body.candidateUserId || !UUID_RE.test(body.candidateUserId))
    return NextResponse.json({ error: "Missing candidateUserId" }, { status: 400 });

  if (!(await canActOnCandidate(auth.role, auth.email, body.candidateUserId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getServiceSupabase();
  // Resolve label server-side from phase_slots so a missing / UUID-shaped
  // client-supplied slotLabel doesn't leak a raw UUID into the candidate bell.
  let label = (body.slotLabel ?? "").trim();
  if (!label || UUID_RE.test(label)) {
    const { data: slotRow } = await db
      .from("phase_slots").select("label").eq("id", body.slotId).maybeSingle();
    const slotLabel = (slotRow as { label?: string | null } | null)?.label;
    if (slotLabel) label = slotLabel.trim();
  }
  if (!label) label = "Dokument";

  // Look up candidate's display name for the admin-side bell message.
  const { data: cp } = await db
    .from("candidate_profiles")
    .select("first_name, last_name")
    .eq("user_id", body.candidateUserId)
    .maybeSingle();
  const cpRow = cp as { first_name?: string | null; last_name?: string | null } | null;
  const candidateName = [cpRow?.first_name, cpRow?.last_name].filter(Boolean).join(" ") || "Candidate";

  // 1) Candidate bell — LAW #21 + LAW #22 + LAW #34: "Admin sends a B/V
  // request to candidate" with a deep-link target. doc_type variants tell the
  // bell what to show and how to route:
  //   "slot_setup_sign_fill" → both sign and fill needed
  //   "slot_setup_sign"      → sign only
  //   "slot_setup_fill"      → fill only
  //   "slot_setup"           → fallback / generic
  // All "slot_setup*" variants route via ?slot=<id>.
  const docType =
    body.needsSign && body.needsFill ? "slot_setup_sign_fill" :
    body.needsSign                   ? "slot_setup_sign"      :
    body.needsFill                   ? "slot_setup_fill"      :
                                       "slot_setup";
  // Dedupe: one PDF = one notification card. If an unread sign_request for
  // this slot already exists in the candidate's bell, refresh it in place
  // (bump created_at, update doc_type for sign/fill/both transitions, keep
  // read=false). Stops one slot from splitting into multiple cards when admin
  // re-opens the wizard or toggles sign/fill on re-submit.
  const { data: existing } = await db
    .from("notifications")
    .select("id")
    .eq("user_id", body.candidateUserId)
    .eq("doc_id",  body.slotId)
    .eq("action",  "sign_request")
    .eq("read",    false)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing?.id) {
    await db.from("notifications").update({
      doc_name:   label,
      doc_type:   docType,
      created_at: new Date().toISOString(),
    }).eq("id", existing.id);
  } else {
    await db.from("notifications").insert({
      user_id:  body.candidateUserId,
      doc_id:   body.slotId,
      doc_name: label,
      doc_type: docType,
      action:   "sign_request",
      feedback: null,
      read:     false,
    });
  }

  // NOTE: per user directive admins do not notify each other. Removed
  // admin_notifications insert here — only candidate-originated events
  // generate admin bell entries.

  return NextResponse.json({ ok: true });
}
