import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase, getAuthSchemaClient } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";

/**
 * Resolve the document a notification points at.
 *
 * Why server-side: the admin's main GET endpoint deduplicates docs (latest
 * per file-type slot, older versions in docHistory), so client-side matching
 * was missing real uploads. This route does the lookup directly against the
 * `documents` table — no dedup, no string-matching guesswork.
 *
 *   GET /api/portal/admin/notifications/<id>/doc
 *     200 { doc: Doc }     — match found
 *     404 { error: "..." } — notification or doc not found
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const db = getServiceSupabase();

  // 1. Load the notification
  const { data: notif, error: nErr } = await db
    .from("admin_notifications")
    .select("id, type, user_email, doc_type, doc_name, created_at")
    .eq("id", id)
    .maybeSingle();
  if (nErr || !notif) return NextResponse.json({ error: "Notification not found" }, { status: 404 });
  if (notif.type !== "upload") return NextResponse.json({ error: "Not an upload notification" }, { status: 400 });

  // 2. Resolve user_id from email. We try direct schema query first (fast,
  //    reliable). Fall back to listUsers pagination if that fails.
  const adminClient = getServiceSupabase();

  const targetEmail = (notif.user_email ?? "").trim().toLowerCase();
  let userId = "";

  // Old notifications were inserted with user_email="" (bug, fixed in
  // upload/route.ts). For those, fall back to looking up the doc directly
  // by filename — `doc_name` is reliable and the documents table tells us
  // who owns it.
  if (!targetEmail && notif.doc_name) {
    const { data: byName } = await db
      .from("documents")
      .select("id, user_id, file_name, file_type, uploaded_at, status, feedback, drive_file_id")
      .eq("file_name", notif.doc_name)
      .order("uploaded_at", { ascending: false })
      .limit(1);
    if (byName && byName.length > 0) {
      console.log("[notif/doc] resolved via doc_name fallback (no email)");
      return NextResponse.json({ doc: byName[0] });
    }
  }

  if (!targetEmail) {
    console.warn("[notif/doc] notification has no email and doc_name lookup missed", { id: notif.id, doc_name: notif.doc_name });
    return NextResponse.json({ error: "Notification has no email", doc_name: notif.doc_name }, { status: 404 });
  }

  // (a) Direct query against auth.users via a service-role client scoped
  //     to the auth schema. Far more reliable than paginating listUsers.
  try {
    const authDb = getAuthSchemaClient();
    const { data, error } = await authDb
      .from("users")
      .select("id, email")
      .ilike("email", targetEmail)
      .limit(1)
      .maybeSingle();
    if (error) console.warn("[notif/doc] auth.users query error:", error);
    if (data?.id) userId = data.id;
  } catch (err) {
    console.warn("[notif/doc] auth.users query threw:", err);
  }

  // (b) Fallback: paginated listUsers
  if (!userId) {
    try {
      let page = 1;
      while (page <= 50) {
        const { data: list } = await adminClient.auth.admin.listUsers({ perPage: 200, page });
        const u = (list?.users ?? []).find(u => (u.email ?? "").trim().toLowerCase() === targetEmail);
        if (u) { userId = u.id; break; }
        if ((list?.users ?? []).length < 200) break;
        page++;
      }
    } catch (err) {
      console.warn("[notif/doc] listUsers fallback failed:", err);
    }
  }

  if (!userId) {
    console.warn("[notif/doc] could not resolve user_id from email", { targetEmail });
    return NextResponse.json({ error: "User not found", targetEmail }, { status: 404 });
  }

  // 3. Find the doc — try a sequence of strategies, pick the first match.
  //    All queries scoped to the candidate so we never leak across users.
  type Doc = {
    id: string; user_id: string; file_name: string; file_type: string;
    uploaded_at: string; status: string; feedback: string | null; drive_file_id: string | null;
  };

  // a) exact filename match
  if (notif.doc_name) {
    const { data } = await db
      .from("documents")
      .select("id, user_id, file_name, file_type, uploaded_at, status, feedback, drive_file_id")
      .eq("user_id", userId)
      .eq("file_name", notif.doc_name)
      .order("uploaded_at", { ascending: false })
      .limit(1);
    if (data && data.length > 0) return NextResponse.json({ doc: data[0] as Doc });
  }

  // b) exact file_type match
  if (notif.doc_type) {
    const { data } = await db
      .from("documents")
      .select("id, user_id, file_name, file_type, uploaded_at, status, feedback, drive_file_id")
      .eq("user_id", userId)
      .eq("file_type", notif.doc_type)
      .order("uploaded_at", { ascending: false })
      .limit(1);
    if (data && data.length > 0) return NextResponse.json({ doc: data[0] as Doc });
  }

  // c) file_type ilike (handles label/translation drift)
  if (notif.doc_type) {
    const safe = notif.doc_type.replace(/[%_]/g, "\\$&");
    const { data } = await db
      .from("documents")
      .select("id, user_id, file_name, file_type, uploaded_at, status, feedback, drive_file_id")
      .eq("user_id", userId)
      .ilike("file_type", `%${safe}%`)
      .order("uploaded_at", { ascending: false })
      .limit(1);
    if (data && data.length > 0) return NextResponse.json({ doc: data[0] as Doc });
  }

  // d) closest-by-time fallback — within 1 hour of the notification
  const { data: nearby } = await db
    .from("documents")
    .select("id, user_id, file_name, file_type, uploaded_at, status, feedback, drive_file_id")
    .eq("user_id", userId)
    .gte("uploaded_at", new Date(new Date(notif.created_at).getTime() - 60 * 60 * 1000).toISOString())
    .lte("uploaded_at", new Date(new Date(notif.created_at).getTime() + 60 * 60 * 1000).toISOString())
    .order("uploaded_at", { ascending: false })
    .limit(1);
  if (nearby && nearby.length > 0) return NextResponse.json({ doc: nearby[0] as Doc });

  // e) most-recent doc for that user, period.
  const { data: anyDoc } = await db
    .from("documents")
    .select("id, user_id, file_name, file_type, uploaded_at, status, feedback, drive_file_id")
    .eq("user_id", userId)
    .order("uploaded_at", { ascending: false })
    .limit(1);
  if (anyDoc && anyDoc.length > 0) return NextResponse.json({ doc: anyDoc[0] as Doc });

  return NextResponse.json({ error: "No documents for this user" }, { status: 404 });
}
