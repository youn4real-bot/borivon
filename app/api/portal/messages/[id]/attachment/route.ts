/**
 * Serve ONE chat image attachment by message id — fetched lazily by the client
 * the first time a message bubble with an image is shown, then browser-cached
 * hard (immutable). This is what lets the chat LIST/poll carry only metadata:
 * the heavy bytes leave Supabase at most once per image, not on every poll.
 *
 * Candidate-side: the caller may only read attachments in their OWN thread.
 * Bytes come from Cloudflare R2 (new messages) or the legacy inline base64
 * column (not-yet-migrated rows) — see lib/chatAttachments.ts.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireUser } from "@/lib/admin-auth";
import { loadChatAttachmentBytes, type ChatAttachmentRow } from "@/lib/chatAttachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });

  const db = getServiceSupabase();
  const { data, error } = await db
    .from("messages")
    .select("thread_user_id, attachment, attachment_key, attachment_mime")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[messages attachment GET] failed:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  // 404 (not 403) when the message is missing OR not in the caller's OWN thread,
  // so a candidate can't use the status code to probe whether a given message id
  // exists in someone else's thread (existence-oracle / IDOR hygiene).
  if (!data || (data as { thread_user_id: string }).thread_user_id !== auth.userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const file = await loadChatAttachmentBytes(data as ChatAttachmentRow);
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return new NextResponse(new Uint8Array(file.bytes), {
    status: 200,
    headers: {
      "Content-Type": file.mime,
      // Attachments are immutable once sent → cache hard so the browser fetches
      // each image exactly once. private: it's a per-candidate document.
      "Cache-Control": "private, max-age=31536000, immutable",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
