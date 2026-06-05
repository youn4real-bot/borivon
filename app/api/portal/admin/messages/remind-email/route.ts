import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole, canActOnCandidate, ciEmail } from "@/lib/admin-auth";
import { enforceRateLimit } from "@/lib/rateLimit";
import { sendUnreadMessagesReminderEmail } from "@/lib/email";

/**
 * Manual "you have unread messages" email nudge for a candidate who isn't
 * reading/answering on the Borivon website.
 *
 * Deliberately conservative to protect email credits + sender reputation:
 *   - Admin-triggered ONLY (a button) — never automatic.
 *   - Borivon team only (org-side admins blocked, mirrors the messages route).
 *   - Only when the candidate is a NON-RESPONDER (the last message in the
 *     thread is from the admin side — they haven't read/replied).
 *   - Throttled to once per 72h per candidate (server-enforced).
 *   - No-ops (503) if RESEND_API_KEY isn't configured — never claims success.
 *
 * POST { threadUserId }
 */

const THROTTLE_HOURS = 72;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Org-side admins are NOT part of the shared Borivon Support inbox (same rule as
// the messages route). Fail closed on any unknown role.
async function isOrgSide(db: ReturnType<typeof getServiceSupabase>, role: string, email: string): Promise<boolean> {
  if (role === "admin") return false;
  const { data: subRows, error } = await db.from("sub_admins").select("is_agency_admin").ilike("email", ciEmail(email)).limit(1);
  if (error) return true;
  if (((subRows ?? [])[0] as { is_agency_admin?: boolean } | undefined)?.is_agency_admin === true) return true;
  const { data } = await db.from("organization_members").select("sub_admin_email").ilike("sub_admin_email", ciEmail(email)).limit(1);
  return !!(data ?? [])[0];
}

export async function POST(req: NextRequest) {
  const rl = enforceRateLimit(req, "msg-remind-email", { limit: 20, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: "Too many — slow down." }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });

  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db = getServiceSupabase();
  if (await isOrgSide(db, auth.role, auth.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const threadUserId = typeof body?.threadUserId === "string" ? body.threadUserId : "";
  if (!UUID_RE.test(threadUserId)) return NextResponse.json({ error: "Invalid threadUserId" }, { status: 400 });

  // LAW #25: sub-admins only their assigned/org candidates.
  if (auth.role !== "admin") {
    const allowed = await canActOnCandidate(auth.role, auth.email, threadUserId);
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Non-responder gate: the most recent message must be from the admin side
  // (the candidate hasn't read/replied). If they already answered, nothing to do.
  const { data: lastMsg } = await db
    .from("messages")
    .select("sender_role")
    .eq("thread_user_id", threadUserId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!lastMsg) return NextResponse.json({ error: "no_messages" }, { status: 400 });
  if ((lastMsg as { sender_role: string }).sender_role !== "admin") {
    return NextResponse.json({ error: "already_replied" }, { status: 400 });
  }

  // 72h throttle (+ resolve first name for the greeting).
  const { data: prof } = await db
    .from("candidate_profiles")
    .select("last_msg_email_at, first_name")
    .eq("user_id", threadUserId)
    .maybeSingle();
  const lastAt = (prof as { last_msg_email_at?: string | null } | null)?.last_msg_email_at ?? null;
  if (lastAt) {
    const elapsedH = (Date.now() - Date.parse(lastAt)) / 3_600_000;
    if (Number.isFinite(elapsedH) && elapsedH < THROTTLE_HOURS) {
      return NextResponse.json({ error: "throttled", retryAfterHours: Math.max(1, Math.ceil(THROTTLE_HOURS - elapsedH)) }, { status: 429 });
    }
  }

  // Candidate email — the auth schema isn't exposed via PostgREST, so go through
  // the admin API (NOT a from("users") query).
  const { data: u } = await db.auth.admin.getUserById(threadUserId);
  const email = u?.user?.email ?? null;
  if (!email) return NextResponse.json({ error: "no_email" }, { status: 400 });

  const firstName = (prof as { first_name?: string | null } | null)?.first_name ?? "";
  const sent = await sendUnreadMessagesReminderEmail(email, firstName ?? "");
  if (!sent) return NextResponse.json({ error: "email_not_configured" }, { status: 503 });

  // Stamp the throttle ONLY after a real send.
  await db.from("candidate_profiles").update({ last_msg_email_at: new Date().toISOString() }).eq("user_id", threadUserId);
  return NextResponse.json({ ok: true });
}
