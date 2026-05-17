import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireUser, requireAdminRole } from "@/lib/admin-auth";
import { canAccessPost } from "@/lib/feedAccess";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * DELETE /api/portal/feed/[id]
 * Deletes a post. Only the author OR a Borivon admin/sub_admin may delete.
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid post id" }, { status: 400 });

  const db = getServiceSupabase();

  // Channel gate first — a sub-admin scoped to org A must not be able to
  // delete org B's (or another channel's) posts by raw id. Supreme admin
  // passes for every channel; owner passes for their own channel.
  const access = await canAccessPost(db, id, auth.userId, auth.email);
  if (!access.ok) return NextResponse.json({ error: access.status === 404 ? "Not found" : "Forbidden" }, { status: access.status });

  const { data: post } = await db
    .from("feed_posts")
    .select("user_id")
    .eq("id", id)
    .maybeSingle();

  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isOwner = (post as { user_id: string }).user_id === auth.userId;

  const { data: sub } = await db
    .from("sub_admins")
    .select("email")
    .eq("email", auth.email)
    .maybeSingle();
  const isAdmin = !!sub || auth.email === (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();

  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await db.from("feed_posts").delete().eq("id", id);

  try {
    const BUCKET = "feed-photos";
    await db.storage.from(BUCKET).remove([`${id}.jpg`, `${id}.png`, `${id}.webp`]);
  } catch { /* ignore */ }

  return NextResponse.json({ success: true });
}

/**
 * PATCH /api/portal/feed/[id]
 * Body: { pinned: boolean }
 * Pin / unpin a post. Borivon admins and sub-admins only.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid post id" }, { status: 400 });

  const db = getServiceSupabase();
  const body = await req.json().catch(() => ({}));
  const pinned = typeof body.pinned === "boolean" ? body.pinned : false;

  const { error } = await db.from("feed_posts").update({ pinned }).eq("id", id);
  if (error) return NextResponse.json({ error: "Internal error" }, { status: 500 });

  return NextResponse.json({ success: true, pinned });
}
