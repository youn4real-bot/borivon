import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole, canActOnCandidate } from "@/lib/admin-auth";
import { UUID_RE } from "@/lib/uuid";
import { cleanPublicText } from "@/lib/sanitizeInput";
import { enforceRateLimit } from "@/lib/rateLimit";

/**
 * Follow-up nudge — drop an in-app reminder into a candidate's notification bell
 * when they've gone quiet / missed a step. Triggered by an admin from the
 * pipeline peek popup.
 *
 * Identity-masked (LAW): the candidate sees it as coming from "Borivon", never
 * the individual admin. In-app only for now — the email channel stays dormant
 * until RESEND_API_KEY is configured.
 *
 * De-duped: if an unread follow-up already exists for the candidate we refresh
 * it instead of stacking duplicate cards.
 *
 * POST { candidateId, message? }
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // Cap reminders per admin so the candidate bell can't be spammed.
  const rl = enforceRateLimit(req, "nudge", { limit: 40, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: "Too many reminders — slow down." }, { status: 429 });

  const body = await req.json().catch(() => ({}));
  const candidateId = typeof body?.candidateId === "string" ? body.candidateId : "";
  if (!UUID_RE.test(candidateId)) return NextResponse.json({ error: "candidateId required" }, { status: 400 });

  // LAW #25 — may this admin act on this candidate?
  const allowed = await canActOnCandidate(auth.role, auth.email, candidateId);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const message = cleanPublicText(body?.message, 200); // optional custom note

  const db = getServiceSupabase();

  // De-dupe: bump an existing UNREAD follow-up rather than stacking a new card.
  const { data: existing } = await db
    .from("notifications")
    .select("id")
    .eq("user_id", candidateId)
    .eq("action", "follow_up")
    .eq("read", false)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    const { error } = await db.from("notifications").update({
      feedback: message || null,
      created_at: new Date().toISOString(),
    }).eq("id", existing.id);
    if (error) {
      console.error("[nudge] update error:", error.message);
      return NextResponse.json({ error: "send_failed" }, { status: 500 });
    }
  } else {
    const { error } = await db.from("notifications").insert({
      user_id: candidateId,
      doc_id: null,
      doc_name: "Borivon",           // masked sender — never the individual admin
      doc_type: "follow_up",
      action: "follow_up",
      feedback: message || null,
      read: false,
    });
    if (error) {
      console.error("[nudge] insert error:", error.message);
      return NextResponse.json({ error: "send_failed" }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
