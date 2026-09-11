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
  // `?unread=1` (the bell's Unread tab) also returns the newest UNREAD rows, so
  // unread items older than the newest-40 window stay reachable from the bell.
  const withUnread = req.nextUrl.searchParams.get("unread") === "1";

  // id → email map, built lazily and reused for both the sub-admin scope filter
  // and the photo enrichment below. Avoids paginating the ENTIRE auth.users table
  // on every bell poll — work stays bounded to the handful of rows we serve.
  const emailToId: Record<string, string> = {};

  // Scope — sub-admins get filtered by their visible candidates' emails.
  // null = no filter (supreme admin / regular sub-admin).
  let scopeEmails: string[] | null = null;
  const empty = { notifications: [], unread: [], unreadCount: 0, overdueCount: 0 };

  if (auth.role !== "admin") {
    // LAW #25: null = regular sub-admin (sees all notifications), array = org admin scope.
    const visibleIds = await getVisibleCandidateIds(auth.email);
    if (visibleIds !== null) {
      if (visibleIds.length === 0) return NextResponse.json(empty);
      // Resolve ONLY the visible candidate ids → emails (bounded by the org scope),
      // not the whole user table. getUserById takes the id directly.
      const resolved = await Promise.all(
        visibleIds.map(id => db.auth.admin.getUserById(id).catch(() => null)),
      );
      const emails: string[] = [];
      for (const r of resolved) {
        const u = r?.data?.user;
        if (u?.id && u.email) { emails.push(u.email); emailToId[u.email] = u.id; }
      }
      if (emails.length === 0) return NextResponse.json(empty);
      scopeEmails = emails;
    }
    // Regular sub-admin: no filter — they see all notifications.
  }

  const COLS = "id, type, user_name, user_email, doc_type, doc_name, read, created_at";
  const cutoff48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  let listQ = db.from("admin_notifications").select(COLS)
    .order("created_at", { ascending: false }).limit(40);
  let unreadListQ = db.from("admin_notifications").select(COLS).eq("read", false)
    .order("created_at", { ascending: false }).limit(40);
  // Badge + 48h banner come from head-only COUNTS over the whole table, not the
  // 40 rows above — deriving them client-side capped "Unread" at the window and
  // hid every overdue item as soon as 40 newer rows existed.
  let unreadQ  = db.from("admin_notifications").select("id", { count: "exact", head: true })
    .eq("read", false);
  let overdueQ = db.from("admin_notifications").select("id", { count: "exact", head: true })
    .eq("read", false).lte("created_at", cutoff48h);
  // LAW #25: the SAME scope filter on every query — list AND counts.
  if (scopeEmails) {
    listQ       = listQ.in("user_email", scopeEmails);
    unreadListQ = unreadListQ.in("user_email", scopeEmails);
    unreadQ     = unreadQ.in("user_email", scopeEmails);
    overdueQ    = overdueQ.in("user_email", scopeEmails);
  }

  const [listRes, unreadListRes, unreadRes, overdueRes] = await Promise.all([
    listQ, withUnread ? unreadListQ : null, unreadQ, overdueQ,
  ]);

  if (listRes.error) {
    console.error("[admin notifications GET] failed:", listRes.error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  // Counts / unread list are additive — on failure the bell falls back to
  // deriving from the loaded rows, so log and keep serving the feed.
  if (unreadRes.error || overdueRes.error) {
    console.error("[admin notifications GET] count failed:", unreadRes.error ?? overdueRes.error);
  }
  if (unreadListRes?.error) {
    console.error("[admin notifications GET] unread list failed:", unreadListRes.error);
  }

  const rows = listRes.data ?? [];
  const unreadRows = unreadListRes && !unreadListRes.error ? (unreadListRes.data ?? []) : null;

  // Enrich with profile photo + verified status by joining through auth.users.
  const emails = [...new Set([...rows, ...(unreadRows ?? [])].map(n => n.user_email).filter(Boolean))];
  const photoMap: Record<string, { photo: string | null; verified: boolean }> = {};
  if (emails.length > 0) {
    // Resolve email → id for ONLY the emails these <=80 rows reference. auth.users
    // is not exposed via PostgREST and listUsers has no email filter, so page the
    // Admin API but STOP as soon as every needed email is matched (and hard-cap the
    // walk) — never a guaranteed full-table sweep on this polled route. Any emails
    // already resolved above (sub-admin scope) are skipped entirely.
    const need = new Set(emails.filter(e => !emailToId[e]));
    for (let page = 1; need.size > 0 && page <= 20; page++) { // hard cap 20×1000 = 20k
      const { data: batch, error: lErr } = await db.auth.admin.listUsers({ page, perPage: 1000 });
      const list = batch?.users ?? [];
      for (const u of list) {
        if (u.email && need.has(u.email)) { emailToId[u.email] = u.id; need.delete(u.email); }
      }
      if (lErr || list.length < 1000) break;
    }
    const userIds = emails.map(e => emailToId[e]).filter(Boolean);
    if (userIds.length > 0) {
      const { data: profiles } = await db
        .from("candidate_profiles")
        .select("user_id, profile_photo, manually_verified")
        .in("user_id", userIds);
      const profileById: Record<string, { profile_photo: string | null; manually_verified: boolean | null }> =
        Object.fromEntries((profiles ?? []).map(p => [p.user_id, p]));
      for (const email of emails) {
        const uid = emailToId[email];
        if (!uid) continue;
        const p = profileById[uid];
        photoMap[email] = { photo: p?.profile_photo ?? null, verified: !!p?.manually_verified };
      }
    }
  }

  const enrich = (list: typeof rows) => list.map(n => ({
    ...n,
    user_photo:    photoMap[n.user_email]?.photo    ?? null,
    user_verified: photoMap[n.user_email]?.verified ?? false,
  }));

  return NextResponse.json({
    notifications: enrich(rows),
    ...(unreadRows ? { unread: enrich(unreadRows) } : {}),
    // null = count failed → the bell falls back to counting its loaded rows.
    unreadCount:  unreadRes.error  ? null : (unreadRes.count  ?? 0),
    overdueCount: overdueRes.error ? null : (overdueRes.count ?? 0),
  });
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
