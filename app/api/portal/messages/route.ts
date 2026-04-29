import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireUser } from "@/lib/admin-auth";

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
  const { data, error } = await db
    .from("messages")
    .select("id, sender_role, body, attachment, kind, created_at, read_by_candidate")
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
      thread_user_id: auth.userId,
      sender_user_id: auth.userId,
      sender_role: "candidate",
      body: text,
      attachment,
      kind,
      read_by_candidate: true,
      read_by_admin: false,
    })
    .select("id, sender_role, body, attachment, kind, created_at, read_by_candidate")
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

