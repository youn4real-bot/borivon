import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getServiceSupabase } from "@/lib/supabase";
import { requireUser } from "@/lib/admin-auth";
import { validateImageDataUrl } from "@/lib/validateDataUrl";
import { enforceRateLimit, enforceUserRateLimit } from "@/lib/rateLimit";
import { r2Configured, r2Put } from "@/lib/r2";
import { chatAttachmentKey } from "@/lib/chatAttachments";

export const runtime = "nodejs";

const MAX_BODY_CHARS = 5000;
const MAX_ATTACHMENT_CHARS = 800_000; // ~600 KB raw image after base64

/**
 * Candidate-side messages: a single conversation between the candidate and
 * the super-admin.
 *
 *   GET    — list messages in the candidate's own thread (ordered oldest→newest)
 *   POST   — { body?, attachment?, kind? } send a new message
 *   PATCH  — mark candidate's unread admin replies as read
 *
 * For the admin's mass inbox + reply path, see /api/portal/admin/messages.
 */

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db = getServiceSupabase();
  // NOTE: we deliberately do NOT select `attachment` — that base64 column is
  // megabytes per thread and was re-shipped out of Supabase on every poll. The
  // cheap generated `has_attachment` flag tells the client which messages carry
  // an image; the bytes are fetched lazily, once, via the [id]/attachment route.
  const { data, error } = await db
    .from("messages")
    .select("id, sender_role, body, kind, created_at, read_by_candidate, has_attachment")
    .eq("thread_user_id", auth.userId)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) {
    console.error("[messages GET] failed:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  return NextResponse.json({ messages: data ?? [] });
}

export async function POST(req: NextRequest) {
  const rl = enforceRateLimit(req, "msg-send", { limit: 30, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: "Too many messages" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });

  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: { body?: unknown; attachment?: unknown; kind?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const text = typeof body.body === "string" ? body.body.trim() : "";
  const attachment = typeof body.attachment === "string" ? body.attachment : null;
  const kind = body.kind === "bug" ? "bug" : "message";

  if (!text && !attachment) {
    return NextResponse.json({ error: "Empty message" }, { status: 400 });
  }
  if (text.length > MAX_BODY_CHARS) {
    return NextResponse.json({ error: "Message too long" }, { status: 400 });
  }

  // Attachment: validate, then store the BYTES in Cloudflare R2 (free egress)
  // and keep only an object key on the row — never inline base64 in Postgres
  // (re-shipping that on every chat poll was the app's biggest Supabase egress).
  let legacyInline: string | null = null; // only used when R2 isn't configured
  let attachmentKey: string | null = null;
  let attachmentMime: string | null = null;
  if (attachment) {
    if (attachment.length > MAX_ATTACHMENT_CHARS) {
      return NextResponse.json({ error: "Attachment too large" }, { status: 413 });
    }
    // SECURITY: reject SVG and spoofed MIMEs. Permissive `startsWith("data:image/")`
    // accepts `data:image/svg+xml,<svg onload=…>` which is a stored-XSS vector.
    const validated = validateImageDataUrl(attachment);
    if (!validated.ok) {
      console.warn("[messages POST] attachment rejected:", validated.reason);
      return NextResponse.json({ error: "Invalid attachment" }, { status: 400 });
    }
    if (r2Configured()) {
      const key = chatAttachmentKey(auth.userId, randomUUID(), validated.mime);
      try {
        await r2Put(key, validated.bytes, validated.mime);
      } catch (e) {
        console.error("[messages POST] R2 upload failed:", e instanceof Error ? e.message : e);
        return NextResponse.json({ error: "Internal error" }, { status: 500 });
      }
      attachmentKey = key;
      attachmentMime = validated.mime;
    } else {
      // R2 not configured → fall back to legacy inline storage so the feature
      // still works (the generated has_attachment flag covers this case too).
      legacyInline = attachment;
    }
  }

  const db = getServiceSupabase();
  const { data, error } = await db
    .from("messages")
    .insert({
      thread_user_id: auth.userId,
      sender_user_id: auth.userId,
      sender_role: "candidate",
      body: text,
      attachment: legacyInline,
      attachment_key: attachmentKey,
      attachment_mime: attachmentMime,
      kind,
      read_by_candidate: true,
      read_by_admin: false,
    })
    .select("id, sender_role, body, kind, created_at, read_by_candidate, has_attachment")
    .single();

  if (error) {
    console.error("[messages POST] failed:", error);
    // PGRST205 = relation does not exist (forgot to run the SQL migration).
    // Surface a clearer message so the operator knows what to do.
    if ((error as { code?: string }).code === "PGRST205") {
      return NextResponse.json({ error: "Messaging not set up yet — admin must run supabase/messages.sql" }, { status: 503 });
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  return NextResponse.json({ message: data });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rl = await enforceUserRateLimit("msg", `u:${auth.userId}`, { limit: 30, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });

  // Mark all admin replies in this candidate's thread as read.
  const db = getServiceSupabase();
  await db
    .from("messages")
    .update({ read_by_candidate: true })
    .eq("thread_user_id", auth.userId)
    .eq("sender_role", "admin")
    .eq("read_by_candidate", false);

  return NextResponse.json({ success: true });
}

