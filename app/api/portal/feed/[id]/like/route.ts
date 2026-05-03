import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireUser } from "@/lib/admin-auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/portal/feed/[id]/like
 * Toggles a like on a post.
 * Returns { liked: boolean, likeCount: number }
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid post id" }, { status: 400 });

  const db = getServiceSupabase();

  // Check if org member (not allowed)
  const { data: membership } = await db
    .from("organization_members")
    .select("org_id")
    .eq("sub_admin_email", auth.email)
    .maybeSingle();
  if (membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Check existing like
  const { data: existing } = await db
    .from("feed_likes")
    .select("post_id")
    .eq("post_id", id)
    .eq("user_id", auth.userId)
    .maybeSingle();

  let liked: boolean;
  if (existing) {
    // Unlike
    await db.from("feed_likes").delete().eq("post_id", id).eq("user_id", auth.userId);
    liked = false;
  } else {
    // Like
    await db.from("feed_likes").insert({ post_id: id, user_id: auth.userId });
    liked = true;
  }

  // Return updated like count
  const { count } = await db
    .from("feed_likes")
    .select("*", { count: "exact", head: true })
    .eq("post_id", id);

  return NextResponse.json({ liked, likeCount: count ?? 0 });
}
