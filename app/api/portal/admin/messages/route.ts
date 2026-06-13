import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getServiceSupabase } from "@/lib/supabase";
import { isVerified } from "@/lib/verified";
import { requireAdminRole, canActOnCandidate, getVisibleCandidateIds, resolveAuthNames } from "@/lib/admin-auth";
import { validateImageDataUrl } from "@/lib/validateDataUrl";
import { enforceUserRateLimit } from "@/lib/rateLimit";
import { r2Configured, r2Put } from "@/lib/r2";
import { chatAttachmentKey } from "@/lib/chatAttachments";
import { isOrgSide } from "@/lib/messagesAuth";

export const runtime = "nodejs";

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

  const url = new URL(req.url);
  const threadUserId = url.searchParams.get("threadUserId");
  const db = getServiceSupabase();

  if (await isOrgSide(db, auth.role, auth.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Single thread mode — LAW #25: sub-admins can only read threads for visible
  // candidates. Supreme admin sees everything.
  if (threadUserId) {
    if (auth.role !== "admin") {
      const allowed = await canActOnCandidate(auth.role, auth.email, threadUserId);
      if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { data, error } = await db
      .from("messages")
      // No `attachment` — the bytes are fetched lazily via [id]/attachment. The
      // cheap has_attachment flag tells the client which bubbles carry an image.
      .select("id, sender_role, body, kind, created_at, read_by_admin, has_attachment")
      .eq("thread_user_id", threadUserId)
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) {
      console.error("[admin messages GET thread] failed:", error);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
    return NextResponse.json({ messages: data ?? [] });
  }

  // Conversations list — LAW #25: for sub-admins, filter to their visible
  // candidates only. null = regular sub-admin (no filter, sees all).
  let visibleIds: string[] | null = null;
  if (auth.role !== "admin") {
    visibleIds = await getVisibleCandidateIds(auth.email);
    if (visibleIds !== null && visibleIds.length === 0) {
      return NextResponse.json({ conversations: [] });
    }
  }

  let listQuery = db
    .from("messages")
    // has_attachment (cheap boolean) instead of the full base64 `attachment`
    // column — the conversations list only needs the 📎 flag, and pulling the
    // attachment for up to 500 rows was a large needless Supabase egress.
    .select("id, thread_user_id, sender_role, body, kind, has_attachment, read_by_admin, created_at")
    .order("created_at", { ascending: false })
    .limit(500);
  if (visibleIds !== null) listQuery = listQuery.in("thread_user_id", visibleIds);
  const { data: rows, error } = await listQuery;

  if (error) {
    console.error("[admin messages GET list] failed:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  type Row = {
    id: string; thread_user_id: string; sender_role: "candidate" | "admin";
    body: string; kind: "message" | "bug"; has_attachment: boolean;
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
        hasAttachment: !!r.has_attachment,
        unread: !r.read_by_admin && r.sender_role === "candidate" ? 1 : 0,
      };
    } else if (!r.read_by_admin && r.sender_role === "candidate") {
      t.unread += 1;
    }
  }

  // Resolve user names/emails — ONE bounded listUsers walk instead of one
  // getUserById per conversation (the inbox lists up to 500 threads).
  const userIds = Object.keys(threads);
  const resolvedNames = await resolveAuthNames(userIds);
  const userMap: Record<string, { name: string; email: string }> = {};
  for (const uid of userIds) userMap[uid] = resolvedNames[uid] ?? { name: uid, email: uid };

  // Fetch verified status + profile photo + payment tier for all candidates in one batch query
  const profileMap: Record<string, { verified: boolean; photoUrl: string | null; paymentTier: string | null }> = {};
  if (userIds.length > 0) {
    const { data: profiles } = await db
      .from("candidate_profiles")
      .select("user_id, manually_verified, profile_photo, payment_tier")
      .in("user_id", userIds);
    for (const p of (profiles ?? [])) {
      profileMap[p.user_id] = {
        verified:    isVerified(p),
        photoUrl:    (p as { profile_photo?: string | null }).profile_photo ?? null,
        paymentTier: (p as { payment_tier?: string | null }).payment_tier ?? null,
      };
    }
  }

  // Determine which thread participants are org-admins (members of any organization).
  // organization_members rows are keyed by sub_admin_email — match by email.
  const orgAdminEmails = new Set<string>();
  const allEmails = userIds
    .map(uid => (userMap[uid]?.email ?? "").trim().toLowerCase())
    .filter(Boolean);
  if (allEmails.length > 0) {
    const { data: members } = await db
      .from("organization_members")
      .select("sub_admin_email")
      .in("sub_admin_email", allEmails);
    for (const m of (members ?? []) as { sub_admin_email: string }[]) {
      orgAdminEmails.add((m.sub_admin_email ?? "").trim().toLowerCase());
    }
  }

  const conversations = Object.values(threads)
    .map(t => {
      const email = (userMap[t.threadUserId]?.email ?? "").trim().toLowerCase();
      return {
        ...t,
        ...userMap[t.threadUserId],
        verified:    !!profileMap[t.threadUserId]?.verified,
        photoUrl:    profileMap[t.threadUserId]?.photoUrl ?? null,
        paymentTier: profileMap[t.threadUserId]?.paymentTier ?? null,
        isOrgMember: orgAdminEmails.has(email),
      };
    })
    .sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());

  return NextResponse.json({ conversations });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (await isOrgSide(getServiceSupabase(), auth.role, auth.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Limit AFTER auth so an unauthenticated / org-side caller never spends a
  // bucket; keyed per-admin (e:) to match the rollout's distributed pattern.
  const rl = await enforceUserRateLimit("admin-msg-send", `e:${auth.email}`, { limit: 60, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: "Too many messages" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });

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
  // LAW #25: sub-admins can only message their assigned/org candidates.
  if (auth.role !== "admin") {
    const allowed = await canActOnCandidate(auth.role, auth.email, threadUserId);
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!text && !attachment) {
    return NextResponse.json({ error: "Empty message" }, { status: 400 });
  }
  if (text.length > MAX_BODY_CHARS) {
    return NextResponse.json({ error: "Message too long" }, { status: 400 });
  }
  // Attachment → Cloudflare R2 (free egress), keep only an object key on the row.
  let legacyInline: string | null = null; // only used when R2 isn't configured
  let attachmentKey: string | null = null;
  let attachmentMime: string | null = null;
  if (attachment) {
    if (attachment.length > MAX_ATTACHMENT_CHARS) {
      return NextResponse.json({ error: "Attachment too large" }, { status: 413 });
    }
    // SECURITY: reject SVG and spoofed MIMEs (stored-XSS vector).
    const validated = validateImageDataUrl(attachment);
    if (!validated.ok) {
      console.warn("[admin messages POST] attachment rejected:", validated.reason);
      return NextResponse.json({ error: "Invalid attachment" }, { status: 400 });
    }
    if (r2Configured()) {
      const key = chatAttachmentKey(threadUserId, randomUUID(), validated.mime);
      try {
        await r2Put(key, validated.bytes, validated.mime);
      } catch (e) {
        console.error("[admin messages POST] R2 upload failed:", e instanceof Error ? e.message : e);
        return NextResponse.json({ error: "Internal error" }, { status: 500 });
      }
      attachmentKey = key;
      attachmentMime = validated.mime;
    } else {
      legacyInline = attachment; // R2 not configured → keep legacy inline
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
      attachment: legacyInline,
      attachment_key: attachmentKey,
      attachment_mime: attachmentMime,
      kind: "message",
      read_by_admin: true,
      read_by_candidate: false,
    })
    .select("id, sender_role, body, kind, created_at, read_by_admin, has_attachment")
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

  if (await isOrgSide(getServiceSupabase(), auth.role, auth.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { threadUserId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const threadUserId = typeof body.threadUserId === "string" ? body.threadUserId : "";
  if (!threadUserId) return NextResponse.json({ error: "Missing threadUserId" }, { status: 400 });
  // LAW #25: sub-admins can only mark threads for visible candidates as read.
  if (auth.role !== "admin") {
    const allowed = await canActOnCandidate(auth.role, auth.email, threadUserId);
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getServiceSupabase();
  await db
    .from("messages")
    .update({ read_by_admin: true })
    .eq("thread_user_id", threadUserId)
    .eq("sender_role", "candidate")
    .eq("read_by_admin", false);

  return NextResponse.json({ success: true });
}
