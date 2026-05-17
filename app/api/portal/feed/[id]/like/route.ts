import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireUser } from "@/lib/admin-auth";
import { canAccessPost } from "@/lib/feedAccess";
import { enforceRateLimit } from "@/lib/rateLimit";

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

  // Anti-spam: like is a toggle so allow a generous burst.
  const rl = enforceRateLimit(req, "feed-like", { limit: 60, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  const db = getServiceSupabase();

  // Channel gate: the post must be in a feed the caller can access (global
  // for candidates/Borivon, or an org channel they belong to). Closes the
  // private-channel like-inflation hole.
  const access = await canAccessPost(db, id, auth.userId, auth.email);
  if (!access.ok) return NextResponse.json({ error: access.status === 404 ? "Not found" : "Forbidden" }, { status: access.status });

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
