import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole, getVisibleCandidateIds } from "@/lib/admin-auth";

// GET — fetch latest admin notifications.
// Full admins see everything. Sub-admins / org admins see only notifications
// for candidates they're assigned to (via direct assignment or org membership).
export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db = getServiceSupabase();

  // Build the query — sub-admins get filtered by their visible candidates' emails
  let query = db
    .from("admin_notifications")
    .select("id, type, user_name, user_email, doc_type, doc_name, read, created_at")
    .order("created_at", { ascending: false })
    .limit(40);

  if (auth.role !== "admin") {
    // LAW #25: null = regular sub-admin (sees all notifications), array = org admin scope.
    const visibleIds = await getVisibleCandidateIds(auth.email);
    if (visibleIds !== null) {
      if (visibleIds.length === 0) return NextResponse.json({ notifications: [] });
      // Resolve user_ids to emails so we can filter admin_notifications by user_email.
      let emails: string[] = [];
      let page = 1;
      while (true) {
        const { data: batch } = await db.auth.admin.listUsers({ page, perPage: 50 });
        const list = batch?.users ?? [];
        for (const u of list) {
          if (u.id && u.email && visibleIds.includes(u.id)) emails.push(u.email);
        }
        if (list.length < 50) break;
        page++;
      }
      if (emails.length === 0) return NextResponse.json({ notifications: [] });
      query = query.in("user_email", emails);
    }
    // Regular sub-admin: no filter — they see all notifications.
  }

  const { data, error } = await query;

  if (error) {
    console.error("[admin notifications GET] failed:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  const rows = data ?? [];

  // Enrich with profile photo + verified status by joining through auth.users
  const emails = [...new Set(rows.map(n => n.user_email).filter(Boolean))];
  const photoMap: Record<string, { photo: string | null; verified: boolean }> = {};
  if (emails.length > 0) {
    let page = 1;
    const authUsers: { id: string; email?: string }[] = [];
    while (true) {
      const { data: batch } = await db.auth.admin.listUsers({ page, perPage: 50 });
      authUsers.push(...(batch?.users ?? []));
      if ((batch?.users ?? []).length < 50) break;
      page++;
    }
    const emailToId: Record<string, string> = {};
    for (const u of authUsers) {
      if (u.email && emails.includes(u.email)) emailToId[u.email] = u.id;
    }
    const userIds = Object.values(emailToId);
    if (userIds.length > 0) {
      const { data: profiles } = await db
        .from("candidate_profiles")
        .select("user_id, profile_photo, manually_verified")
        .in("user_id", userIds);
      const profileById: Record<string, { profile_photo: string | null; manually_verified: boolean | null }> =
        Object.fromEntries((profiles ?? []).map(p => [p.user_id, p]));
      for (const [email, uid] of Object.entries(emailToId)) {
        const p = profileById[uid];
        photoMap[email] = { photo: p?.profile_photo ?? null, verified: !!p?.manually_verified };
      }
    }
  }

  const enriched = rows.map(n => ({
    ...n,
    user_photo:    photoMap[n.user_email]?.photo    ?? null,
    user_verified: photoMap[n.user_email]?.verified ?? false,
  }));

  return NextResponse.json({ notifications: enriched });
}

// PATCH — mark notifications as read.
// If `ids` array is supplied, only those rows are touched; otherwise all unread.
// Restricted to full admins.
export async function PATCH(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  // Supreme + regular Borivon sub-admins share this team queue and all see the
  // same notifications, so both may clear them (parity with the shared model).
  // Org admins are scoped (LAW #25) and the `read` flag is GLOBAL — letting
  // them mark-all-read would wipe other admins' unread state, so they stay 403.
  if (auth.role !== "admin") {
    const visibleIds = await getVisibleCandidateIds(auth.email);
    if (visibleIds !== null) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let ids: string[] | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    if (Array.isArray(body?.ids) && body.ids.every((x: unknown) => typeof x === "string")) {
      ids = body.ids as string[];
    }
  } catch { /* no body — mark all unread as read */ }

  const db = getServiceSupabase();
  if (ids && ids.length > 0) {
    await db.from("admin_notifications").update({ read: true }).in("id", ids);
  } else {
    await db.from("admin_notifications").update({ read: true }).eq("read", false);
  }
  return NextResponse.json({ success: true });
}
