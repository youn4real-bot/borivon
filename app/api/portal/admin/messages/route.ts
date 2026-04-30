import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";

const MAX_BODY_CHARS = 5000;
const MAX_ATTACHMENT_CHARS = 800_000;

/**
 * Admin-side messaging:
 *
 *   GET    — list all conversations (one row per candidate with last msg + unread count)
 *            OR ?threadUserId=<uuid> for the full thread of a single candidate.
 *   POST   — { threadUserId, body?, attachment? } reply to a candidate.
 *   PATCH  — { threadUserId } mark all unread candidate messages in a thread as read.
 *
 * Restricted to full admins (super-admin) only. Sub-admins get 403.
 */

export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const threadUserId = url.searchParams.get("threadUserId");
  const db = getServiceSupabase();

  // Single thread mode
  if (threadUserId) {
    const { data, error } = await db
      .from("messages")
      .select("id, sender_role, body, attachment, kind, created_at, read_by_admin")
      .eq("thread_user_id", threadUserId)
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) {
      console.error("[admin messages GET thread] failed:", error);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
    return NextResponse.json({ messages: data ?? [] });
  }

  // Conversations list — last message + unread count per thread.
  const { data: rows, error } = await db
    .from("messages")
    .select("id, thread_user_id, sender_role, body, kind, attachment, read_by_admin, created_at")
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    console.error("[admin messages GET list] failed:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  type Row = {
    id: string; thread_user_id: string; sender_role: "candidate" | "admin";
    body: string; kind: "message" | "bug"; attachment: string | null;
    read_by_admin: boolean; created_at: string;
  };
  const sorted = (rows ?? []) as Row[];

  // First pass — aggregate per thread
  const threads: Record<string, {
    threadUserId: string;
    lastBody: string;
    lastKind: "message" | "bug";
    lastSender: "candidate" | "admin";
    lastAt: string;
    hasAttachment: boolean;
    unread: number;
  }> = {};

  for (const r of sorted) {
    const t = threads[r.thread_user_id];
    if (!t) {
      threads[r.thread_user_id] = {
        threadUserId: r.thread_user_id,
        lastBody: r.body,
        lastKind: r.kind,
        lastSender: r.sender_role,
        lastAt: r.created_at,
        hasAttachment: !!r.attachment,
        unread: !r.read_by_admin && r.sender_role === "candidate" ? 1 : 0,
      };
    } else if (!r.read_by_admin && r.sender_role === "candidate") {
      t.unread += 1;
    }
  }

  // Resolve user names/emails
  const userIds = Object.keys(threads);
  const userMap: Record<string, { name: string; email: string }> = {};
  await Promise.all(userIds.map(async (uid) => {
    const { data } = await db.auth.admin.getUserById(uid);
    if (data?.user) {
      userMap[uid] = {
        email: data.user.email ?? uid,
        name: (data.user.user_metadata?.full_name as string | undefined) ?? data.user.email ?? uid,
      };
    } else {
      userMap[uid] = { name: uid, email: uid };
    }
  }));

  // Fetch verified status + profile photo for all candidates in one batch query
  const profileMap: Record<string, { verified: boolean; photoUrl: string | null }> = {};
  if (userIds.length > 0) {
    const { data: profiles } = await db
      .from("candidate_profiles")
      .select("user_id, manually_verified, profile_photo")
      .in("user_id", userIds);
    for (const p of (profiles ?? [])) {
      profileMap[p.user_id] = {
        verified: !!p.manually_verified,
        photoUrl: (p as { profile_photo?: string | null }).profile_photo ?? null,
      };
    }
  }

  const conversations = Object.values(threads)
    .map(t => ({
      ...t,
      ...userMap[t.threadUserId],
      verified: !!profileMap[t.threadUserId]?.verified,
      photoUrl: profileMap[t.threadUserId]?.photoUrl ?? null,
    }))
    .sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());

  return NextResponse.json({ conversations });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { threadUserId?: unknown; body?: unknown; attachment?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const threadUserId = typeof body.threadUserId === "string" ? body.threadUserId : "";
  const text = typeof body.body === "string" ? body.body.trim() : "";
  const attachment = typeof body.attachment === "string" ? body.attachment : null;

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(threadUserId)) {
    return NextResponse.json({ error: "Invalid threadUserId" }, { status: 400 });
  }
  if (!text && !attachment) {
    return NextResponse.json({ error: "Empty message" }, { status: 400 });
  }
  if (text.length > MAX_BODY_CHARS) {
    return NextResponse.json({ error: "Message too long" }, { status: 400 });
  }
  if (attachment) {
    if (!attachment.startsWith("data:image/")) {
      return NextResponse.json({ error: "Invalid attachment" }, { status: 400 });
    }
    if (attachment.length > MAX_ATTACHMENT_CHARS) {
      return NextResponse.json({ error: "Attachment too large" }, { status: 413 });
    }
  }

  const db = getServiceSupabase();
  const { data, error } = await db
    .from("messages")
    .insert({
      thread_user_id: threadUserId,
      sender_user_id: auth.userId,
      sender_role: "admin",
      body: text,
      attachment,
      kind: "message",
      read_by_admin: true,
      read_by_candidate: false,
    })
    .select("id, sender_role, body, attachment, kind, created_at, read_by_admin")
    .single();

  if (error) {
    console.error("[admin messages POST] failed:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  return NextResponse.json({ message: data });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { threadUserId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const threadUserId = typeof body.threadUserId === "string" ? body.threadUserId : "";
  if (!threadUserId) return NextResponse.json({ error: "Missing threadUserId" }, { status: 400 });

  const db = getServiceSupabase();
  await db
    .from("messages")
    .update({ read_by_admin: true })
    .eq("thread_user_id", threadUserId)
    .eq("sender_role", "candidate")
    .eq("read_by_admin", false);

  return NextResponse.json({ success: true });
}
