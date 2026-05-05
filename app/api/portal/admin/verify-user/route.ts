import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";
import { sendVerifiedEmail } from "@/lib/email";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Manual verification override.
 *
 * Only the FULL admin can flip this — sub-admins and org members cannot.
 * Flipping `manually_verified` to TRUE makes the candidate appear verified
 * everywhere (public profile, dashboard badge, "Message Borivon" gate)
 * regardless of their document approval status.
 *
 * POST   /api/portal/admin/verify-user  body: { userId, verified: true|false }
 *   200 { success: true, manually_verified: boolean }
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  // Hard-block everyone except the supreme admin (ADMIN_EMAIL).
  // Sub-admins, org-admins — nobody else can ever grant or revoke the blue tick.
  const supremeEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  if (auth.role !== "admin" || auth.email !== supremeEmail) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body     = await req.json().catch(() => ({}));
  const userId   = typeof body?.userId   === "string"  ? body.userId.trim() : "";
  const verified = body?.verified === true;
  if (!UUID_RE.test(userId)) return NextResponse.json({ error: "Invalid user id" }, { status: 400 });

  const db = getServiceSupabase();

  // Upsert — there might not be a candidate_profiles row yet for this user
  // (e.g. user signed up but never started the passport flow). Create the
  // row so the override sticks.
  const { error } = await db
    .from("candidate_profiles")
    .upsert(
      { user_id: userId, manually_verified: verified },
      { onConflict: "user_id" },
    );

  if (error) {
    console.error("[verify-user] update failed:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  // When granting the blue tick manually, send a one-time "verified"
  // notification (skip if already sent, and skip when revoking).
  if (verified) {
    const { data: existing } = await db
      .from("notifications")
      .select("id")
      .eq("user_id", userId)
      .eq("action", "verified")
      .limit(1);

    if (!existing?.length) {
      await db.from("notifications").insert({
        user_id:  userId,
        doc_id:   null,
        doc_name: "Verifizierung",
        doc_type: "Passport",
        action:   "verified",
        feedback: null,
        read:     false,
      });

      // Fire verified email (fire-and-forget). Log failures so silent
      // breakages (auth lookup down, email service down) are visible in the
      // server logs rather than disappearing.
      db.auth.admin.getUserById(userId).then(({ data }) => {
        const email = data?.user?.email;
        if (!email) {
          console.warn("[verify-user] no email for user, skipping verified email", userId);
          return;
        }
        const firstName = (data?.user?.user_metadata?.full_name ?? "").split(" ")[0];
        sendVerifiedEmail(email, firstName);
      }).catch(err => console.error("[verify-user] verified email lookup failed:", err));
    }
  }

  return NextResponse.json({ success: true, manually_verified: verified });
}
