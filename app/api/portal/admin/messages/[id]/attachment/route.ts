/**
 * Admin-side counterpart to /api/portal/messages/[id]/attachment — serves one
 * chat image attachment by message id for the Borivon Support team, lazily +
 * browser-cached, so the admin thread/list polls carry only metadata.
 *
 * Auth: requireAdminRole + the shared isOrgSide gate (org admins / org members
 * are NOT part of the Borivon Support inbox) + LAW #25 (sub-admins only for
 * candidates they can act on).
 */
import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole, canActOnCandidate } from "@/lib/admin-auth";
import { isOrgSide } from "@/lib/messagesAuth";
import { loadChatAttachmentBytes, type ChatAttachmentRow } from "@/lib/chatAttachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });

  const db = getServiceSupabase();
  if (await isOrgSide(db, auth.role, auth.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await db
    .from("messages")
    .select("thread_user_id, attachment, attachment_key, attachment_mime")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[admin messages attachment GET] failed:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // LAW #25: sub-admins can only read attachments for candidates they can act on.
  if (auth.role !== "admin") {
    const allowed = await canActOnCandidate(auth.role, auth.email, (data as { thread_user_id: string }).thread_user_id);
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const file = await loadChatAttachmentBytes(data as ChatAttachmentRow);
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return new NextResponse(new Uint8Array(file.bytes), {
    status: 200,
    headers: {
      "Content-Type": file.mime,
      "Cache-Control": "private, max-age=31536000, immutable",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
