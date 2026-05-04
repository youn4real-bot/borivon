import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireUser } from "@/lib/admin-auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/portal/feed/[id]/comments
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid post id" }, { status: 400 });

  const db = getServiceSupabase();

  const { data: comments } = await db
    .from("feed_comments")
    .select("id, user_id, content, created_at")
    .eq("post_id", id)
    .order("created_at", { ascending: true });

  const rows = (comments ?? []) as { id: string; user_id: string; content: string; created_at: string }[];
  if (!rows.length) return NextResponse.json({ comments: [] });

  const commentIds = rows.map(r => r.id);

  // Comment likes (table may not exist yet — degrade gracefully)
  const { data: commentLikesData, error: clErr } = await db
    .from("feed_comment_likes")
    .select("comment_id, user_id")
    .in("comment_id", commentIds);

  const likeCountByComment: Record<string, number> = {};
  const likedByMeSet = new Set<string>();
  if (!clErr) {
    for (const l of (commentLikesData ?? []) as { comment_id: string; user_id: string }[]) {
      likeCountByComment[l.comment_id] = (likeCountByComment[l.comment_id] ?? 0) + 1;
      if (l.user_id === auth.userId) likedByMeSet.add(l.comment_id);
    }
  }

  // Enrich author info
  const userIds = [...new Set(rows.map(r => r.user_id))];
  const authInfo: Record<string, { name: string; email: string }> = {};
  const photoInfo: Record<string, { photo: string | null; verified: boolean }> = {};

  await Promise.all(userIds.map(async uid => {
    try {
      const { data } = await db.auth.admin.getUserById(uid);
      if (data?.user) authInfo[uid] = { name: data.user.user_metadata?.full_name ?? data.user.email ?? uid, email: data.user.email ?? "" };
    } catch { /* skip */ }
  }));

  const { data: profiles } = await db
    .from("candidate_profiles")
    .select("user_id, profile_photo, manually_verified")
    .in("user_id", userIds);
  for (const p of (profiles ?? []) as { user_id: string; profile_photo: string | null; manually_verified: boolean }[]) {
    photoInfo[p.user_id] = { photo: p.profile_photo, verified: p.manually_verified };
  }

  const emails = Object.values(authInfo).map(a => a.email).filter(Boolean);
  const { data: subs } = await db.from("sub_admins").select("email").in("email", emails);
  const borivonEmails = new Set((subs ?? []).map((s: { email: string }) => s.email));
  const adminEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  if (adminEmail) borivonEmails.add(adminEmail);

  const { data: orgMemberData } = await db
    .from("organization_members")
    .select("sub_admin_email")
    .in("sub_admin_email", emails);
  const orgMemberEmailSet = new Set(
    ((orgMemberData ?? []) as { sub_admin_email: string }[]).map(r => r.sub_admin_email.toLowerCase())
  );

  const enriched = rows.map(r => {
    const userEmail = (authInfo[r.user_id]?.email ?? "").toLowerCase();
    const isBorivonTeam = borivonEmails.has(userEmail);
    const isSuperAdmin = !!adminEmail && userEmail === adminEmail;
    const isOrgMember = orgMemberEmailSet.has(userEmail) && !isSuperAdmin;
    return {
      id:             r.id,
      content:        r.content,
      createdAt:      r.created_at,
      authorId:       r.user_id,
      authorName:     authInfo[r.user_id]?.name ?? "Unknown",
      authorPhoto:    photoInfo[r.user_id]?.photo ?? null,
      authorVerified: isBorivonTeam || (photoInfo[r.user_id]?.verified ?? false),
      isBorivonTeam,
      isSuperAdmin,
      isOrgMember,
      isOwn:          r.user_id === auth.userId,
      likeCount:      likeCountByComment[r.id] ?? 0,
      likedByMe:      likedByMeSet.has(r.id),
    };
  });

  return NextResponse.json({ comments: enriched });
}

/**
 * POST /api/portal/feed/[id]/comments
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid post id" }, { status: 400 });

  const db = getServiceSupabase();

  const { data: membership } = await db
    .from("organization_members")
    .select("org_id")
    .eq("sub_admin_email", auth.email)
    .maybeSingle();
  if (membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content || content.length > 300) {
    return NextResponse.json({ error: "Comment must be 1–300 characters" }, { status: 400 });
  }

  const { data: comment, error } = await db
    .from("feed_comments")
    .insert({ post_id: id, user_id: auth.userId, content })
    .select("id, user_id, content, created_at")
    .single();

  if (error || !comment) return NextResponse.json({ error: "Could not add comment" }, { status: 500 });
  const c = comment as { id: string; user_id: string; content: string; created_at: string };

  let authorName = "Unknown";
  try {
    const { data } = await db.auth.admin.getUserById(auth.userId);
    authorName = data?.user?.user_metadata?.full_name ?? data?.user?.email ?? "Unknown";
  } catch { /* skip */ }

  const { data: profile } = await db
    .from("candidate_profiles")
    .select("profile_photo, manually_verified")
    .eq("user_id", auth.userId)
    .maybeSingle();

  const { data: sub } = await db.from("sub_admins").select("email").eq("email", auth.email).maybeSingle();
  const isBorivonTeam = !!sub || auth.email === (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const isSuperAdmin = auth.email === (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();

  return NextResponse.json({
    comment: {
      id:             c.id,
      content:        c.content,
      createdAt:      c.created_at,
      authorId:       auth.userId,
      authorName,
      authorPhoto:    (profile as { profile_photo?: string | null } | null)?.profile_photo ?? null,
      authorVerified: isBorivonTeam || ((profile as { manually_verified?: boolean } | null)?.manually_verified ?? false),
      isBorivonTeam,
      isSuperAdmin,
      isOrgMember:    false,
      isOwn:          true,
      likeCount:      0,
      likedByMe:      false,
    },
  });
}

/**
 * PATCH /api/portal/feed/[id]/comments
 * Body: { commentId } — toggles a like on that comment.
 */
export async function PATCH(req: NextRequest, _ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({}));
  const commentId = typeof body.commentId === "string" ? body.commentId : "";
  if (!UUID_RE.test(commentId)) return NextResponse.json({ error: "Invalid comment id" }, { status: 400 });

  const db = getServiceSupabase();

  const { data: existing } = await db
    .from("feed_comment_likes")
    .select("comment_id")
    .eq("comment_id", commentId)
    .eq("user_id", auth.userId)
    .maybeSingle();

  let liked: boolean;
  if (existing) {
    await db.from("feed_comment_likes").delete().eq("comment_id", commentId).eq("user_id", auth.userId);
    liked = false;
  } else {
    await db.from("feed_comment_likes").insert({ comment_id: commentId, user_id: auth.userId });
    liked = true;
  }

  const { count } = await db
    .from("feed_comment_likes")
    .select("*", { count: "exact", head: true })
    .eq("comment_id", commentId);

  return NextResponse.json({ liked, likeCount: count ?? 0 });
}

/**
 * DELETE /api/portal/feed/[id]/comments?commentId=...
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const commentId = req.nextUrl.searchParams.get("commentId") ?? "";
  if (!UUID_RE.test(commentId)) return NextResponse.json({ error: "Invalid comment id" }, { status: 400 });

  const db = getServiceSupabase();

  const { data: comment } = await db
    .from("feed_comments")
    .select("user_id")
    .eq("id", commentId)
    .maybeSingle();

  if (!comment) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isOwner = (comment as { user_id: string }).user_id === auth.userId;
  const { data: sub } = await db.from("sub_admins").select("email").eq("email", auth.email).maybeSingle();
  const isAdmin = !!sub || auth.email === (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();

  if (!isOwner && !isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await db.from("feed_comments").delete().eq("id", commentId);
  return NextResponse.json({ success: true });
}
