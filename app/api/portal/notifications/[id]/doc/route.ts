import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase, getAnonVerifyClient } from "@/lib/supabase";

/**
 * Resolve the document a candidate notification points at.
 * Mirrors /api/portal/admin/notifications/[id]/doc but scoped to the
 * authenticated candidate — no cross-user leakage possible.
 *
 *   GET /api/portal/notifications/<id>/doc
 *     200 { doc: Doc }     — match found
 *     404 { error: "..." } — notification or doc not found
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error: authErr } = await getAnonVerifyClient().auth.getUser(token);
  const db = getServiceSupabase();
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;

  // 1. Load the notification — scoped to this user so no cross-user access
  const { data: notif } = await db
    .from("notifications")
    .select("id, doc_id, doc_type, doc_name, created_at")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!notif) return NextResponse.json({ error: "Notification not found" }, { status: 404 });

  // 2. Direct doc_id — fastest path
  if (notif.doc_id) {
    const { data: doc } = await db
      .from("documents")
      .select("id, user_id, file_name, file_type, uploaded_at, status, feedback, drive_file_id")
      .eq("id", notif.doc_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (doc) return NextResponse.json({ doc });
  }

  // 3. Exact file_type match
  if (notif.doc_type) {
    const { data } = await db
      .from("documents")
      .select("id, user_id, file_name, file_type, uploaded_at, status, feedback, drive_file_id")
      .eq("user_id", user.id)
      .eq("file_type", notif.doc_type)
      .order("uploaded_at", { ascending: false })
      .limit(1);
    if (data?.length) return NextResponse.json({ doc: data[0] });
  }

  // 4. Filename match
  if (notif.doc_name) {
    const { data } = await db
      .from("documents")
      .select("id, user_id, file_name, file_type, uploaded_at, status, feedback, drive_file_id")
      .eq("user_id", user.id)
      .eq("file_name", notif.doc_name)
      .order("uploaded_at", { ascending: false })
      .limit(1);
    if (data?.length) return NextResponse.json({ doc: data[0] });
  }

  // 5. Closest-by-time fallback — within ±1h of the notification
  const { data: nearby } = await db
    .from("documents")
    .select("id, user_id, file_name, file_type, uploaded_at, status, feedback, drive_file_id")
    .eq("user_id", user.id)
    .gte("uploaded_at", new Date(new Date(notif.created_at).getTime() - 3_600_000).toISOString())
    .lte("uploaded_at", new Date(new Date(notif.created_at).getTime() + 3_600_000).toISOString())
    .order("uploaded_at", { ascending: false })
    .limit(1);
  if (nearby?.length) return NextResponse.json({ doc: nearby[0] });

  return NextResponse.json({ error: "No document found for this notification" }, { status: 404 });
}
