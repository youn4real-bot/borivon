import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireUser } from "@/lib/admin-auth";

const BUCKET = "feed-photos";
const PAGE_SIZE = 20;

async function ensureBucket() {
  const db = getServiceSupabase();
  const { error } = await db.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: 5 * 1024 * 1024,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
  });
  if (error && !error.message?.toLowerCase().includes("already exist") && !error.message?.toLowerCase().includes("duplicate")) {
    console.warn("[feed] bucket warn:", error.message);
  }
}

async function resolveUserMeta(db: ReturnType<typeof getServiceSupabase>, userIds: string[]) {
  if (!userIds.length) return {};

  const authInfo: Record<string, { name: string; email: string }> = {};
  await Promise.all(userIds.map(async uid => {
    try {
      const { data } = await db.auth.admin.getUserById(uid);
      if (data?.user) {
        authInfo[uid] = {
          name:  data.user.user_metadata?.full_name ?? data.user.email ?? uid,
          email: data.user.email ?? "",
        };
      }
    } catch { /* skip */ }
  }));

  const { data: profiles } = await db
    .from("candidate_profiles")
    .select("user_id, profile_photo, manually_verified, payment_tier")
    .in("user_id", userIds);
  const profileMap: Record<string, { photo: string | null; verified: boolean; tier: string | null }> = {};
  for (const p of (profiles ?? []) as { user_id: string; profile_photo: string | null; manually_verified: boolean; payment_tier: string | null }[]) {
    profileMap[p.user_id] = { photo: p.profile_photo, verified: p.manually_verified, tier: p.payment_tier };
  }

  const emails = Object.values(authInfo).map(i => i.email).filter(Boolean);
  const { data: subAdmins } = await db.from("sub_admins").select("email").in("email", emails);
  const borivonEmails = new Set((subAdmins ?? []).map((s: { email: string }) => s.email));

  const adminEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  if (adminEmail) borivonEmails.add(adminEmail);

  const result: Record<string, {
    name: string; email: string; photo: string | null;
    verified: boolean; tier: string | null; isBorivonTeam: boolean;
  }> = {};
  for (const uid of userIds) {
    const auth = authInfo[uid];
    const prof = profileMap[uid];
    const isBorivonTeam = auth?.email ? borivonEmails.has(auth.email) : false;
    result[uid] = {
      name:          auth?.name ?? "Unknown",
      email:         auth?.email ?? "",
      photo:         prof?.photo ?? null,
      verified:      isBorivonTeam || (prof?.verified ?? false),
      tier:          prof?.tier ?? null,
      isBorivonTeam,
    };
  }
  return result;
}

async function isOrgMember(db: ReturnType<typeof getServiceSupabase>, email: string): Promise<boolean> {
  const { data } = await db
    .from("organization_members")
    .select("org_id")
    .eq("sub_admin_email", email)
    .maybeSingle();
  return !!data;
}

/**
 * GET /api/portal/feed?page=0
 */
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db = getServiceSupabase();

  if (await isOrgMember(db, auth.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const page = Math.max(0, parseInt(req.nextUrl.searchParams.get("page") ?? "0", 10) || 0);

  const category = req.nextUrl.searchParams.get("category") ?? "all";

  // Try selecting with category column; fall back gracefully if it doesn't exist yet
  let queryResult = await db
    .from("feed_posts")
    .select("id, user_id, content, image_url, gif_url, title, pinned, category, created_at")
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false })
    .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

  if (queryResult.error?.message?.includes("category")) {
    // category column not yet created — fall back without it
    queryResult = await db
      .from("feed_posts")
      .select("id, user_id, content, image_url, gif_url, title, pinned, created_at")
      .order("pinned", { ascending: false })
      .order("created_at", { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1) as typeof queryResult;
  }

  if (queryResult.error) {
    console.error("[feed GET] posts:", queryResult.error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  type RawPost = {
    id: string; user_id: string; content: string;
    image_url: string | null; gif_url: string | null;
    title: string | null; pinned: boolean; category?: string; created_at: string;
  };
  let rows = (queryResult.data ?? []) as RawPost[];

  // Client-side category filter (only if category column exists in result)
  if (category && category !== "all") {
    rows = rows.filter(r => (r.category ?? "general") === category);
  }
  if (!rows.length) return NextResponse.json({ posts: [], hasMore: false });

  const postIds = rows.map(r => r.id);

  // Likes
  const { data: likes } = await db
    .from("feed_likes")
    .select("post_id, user_id")
    .in("post_id", postIds);
  const likesByPost: Record<string, number> = {};
  const likedByMe = new Set<string>();
  for (const l of (likes ?? []) as { post_id: string; user_id: string }[]) {
    likesByPost[l.post_id] = (likesByPost[l.post_id] ?? 0) + 1;
    if (l.user_id === auth.userId) likedByMe.add(l.post_id);
  }

  // Comments: counts + first 3 unique commenter user_ids per post
  const { data: allComments } = await db
    .from("feed_comments")
    .select("post_id, user_id")
    .in("post_id", postIds)
    .order("created_at", { ascending: true });

  const commentsByPost: Record<string, number> = {};
  const commentersByPost: Record<string, string[]> = {};
  for (const c of (allComments ?? []) as { post_id: string; user_id: string }[]) {
    commentsByPost[c.post_id] = (commentsByPost[c.post_id] ?? 0) + 1;
    if (!commentersByPost[c.post_id]) commentersByPost[c.post_id] = [];
    if (
      commentersByPost[c.post_id].length < 3 &&
      !commentersByPost[c.post_id].includes(c.user_id)
    ) {
      commentersByPost[c.post_id].push(c.user_id);
    }
  }

  // Resolve metadata for post authors + commenters in one call
  const allCommenterIds = [...new Set(Object.values(commentersByPost).flat())];
  const uniqueUserIds = [...new Set([...rows.map(r => r.user_id), ...allCommenterIds])];
  const userMeta = await resolveUserMeta(db, uniqueUserIds);

  const enriched = rows.map(r => ({
    id:               r.id,
    title:            r.title ?? null,
    content:          r.content,
    imageUrl:         r.image_url,
    gifUrl:           r.gif_url ?? null,
    pinned:           r.pinned ?? false,
    category:         r.category ?? "general",
    createdAt:        r.created_at,
    author:           userMeta[r.user_id] ?? { name: "Unknown", email: "", photo: null, verified: false, tier: null, isBorivonTeam: false },
    authorId:         r.user_id,
    isOwn:            r.user_id === auth.userId,
    likeCount:        likesByPost[r.id] ?? 0,
    commentCount:     commentsByPost[r.id] ?? 0,
    likedByMe:        likedByMe.has(r.id),
    commenterAvatars: (commentersByPost[r.id] ?? []).map(uid => ({
      photo: userMeta[uid]?.photo ?? null,
      name:  userMeta[uid]?.name ?? "?",
    })),
  }));

  return NextResponse.json({ posts: enriched, hasMore: rows.length === PAGE_SIZE });
}

/**
 * POST /api/portal/feed
 * Body: { content, title?, imageBase64?, gifUrl? }
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db = getServiceSupabase();

  if (await isOrgMember(db, auth.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content || content.length > 500) {
    return NextResponse.json({ error: "Content must be 1–500 characters" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim().slice(0, 100) : null;
  const gifUrl = typeof body.gifUrl === "string" && body.gifUrl.startsWith("http") ? body.gifUrl.trim() : null;
  const category = typeof body.category === "string" ? body.category : "general";
  const validCategories = ["general", "progress", "question", "tip"];
  const safeCategory = validCategories.includes(category) ? category : "general";

  const { data: post, error: insertErr } = await db
    .from("feed_posts")
    .insert({ user_id: auth.userId, content, image_url: null, title: title || null, gif_url: gifUrl || null, category: safeCategory })
    .select("id, user_id, content, image_url, gif_url, title, pinned, created_at")
    .single();

  if (insertErr || !post) {
    console.error("[feed POST] insert:", insertErr);
    return NextResponse.json({ error: "Could not create post" }, { status: 500 });
  }
  const p = post as { id: string; user_id: string; content: string; image_url: string | null; gif_url: string | null; title: string | null; pinned: boolean; created_at: string };

  // Upload image if provided
  let imageUrl: string | null = null;
  const imageBase64 = typeof body.imageBase64 === "string" ? body.imageBase64 : null;
  if (imageBase64 && imageBase64.startsWith("data:image/")) {
    try {
      await ensureBucket();
      const commaIdx = imageBase64.indexOf(",");
      const header = imageBase64.slice(0, commaIdx);
      const b64 = imageBase64.slice(commaIdx + 1);
      const mime = header.match(/data:([^;]+);/)?.[1] ?? "image/jpeg";
      const ext  = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
      const buffer = Buffer.from(b64, "base64");

      if (buffer.length <= 5_000_000) {
        const fileName = `${p.id}.${ext}`;
        const { error: uploadErr } = await db.storage.from(BUCKET).upload(fileName, buffer, { contentType: mime, upsert: true });
        if (!uploadErr) {
          const { data: { publicUrl } } = db.storage.from(BUCKET).getPublicUrl(fileName);
          imageUrl = `${publicUrl}?t=${Date.now()}`;
          await db.from("feed_posts").update({ image_url: imageUrl }).eq("id", p.id);
        }
      }
    } catch (e) {
      console.warn("[feed POST] image upload failed:", e);
    }
  }

  const userMeta = await resolveUserMeta(db, [auth.userId]);

  return NextResponse.json({
    post: {
      id:               p.id,
      title:            p.title ?? null,
      content:          p.content,
      imageUrl:         imageUrl,
      gifUrl:           p.gif_url ?? null,
      pinned:           false,
      category:         safeCategory,
      createdAt:        p.created_at,
      author:           userMeta[auth.userId] ?? { name: "Unknown", email: "", photo: null, verified: false, tier: null, isBorivonTeam: false },
      authorId:         auth.userId,
      isOwn:            true,
      likeCount:        0,
      commentCount:     0,
      likedByMe:        false,
      commenterAvatars: [],
    },
  });
}
