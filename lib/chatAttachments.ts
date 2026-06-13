/**
 * Chat image attachments stored in Cloudflare R2 (free egress) instead of inline
 * base64 in Postgres. New messages keep only an R2 object key + mime on the row;
 * the bytes live in R2 and are served lazily, once, per message (never re-shipped
 * out of Supabase on every chat poll).
 *
 * Back-compat: messages that still hold a legacy `attachment` (base64 data-URL)
 * are decoded on the fly until the one-time migration moves them to R2.
 */
import { r2GetObject } from "@/lib/r2";
import { validateImageDataUrl } from "@/lib/validateDataUrl";

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function extFromMime(mime: string): string {
  return MIME_EXT[(mime || "").toLowerCase()] ?? "bin";
}

/** Path-safe segment — strips anything outside [A-Za-z0-9._-] so a crafted id
 *  can never escape the chat/ prefix (no `..`, no `/`). */
function safeSeg(s: string): string {
  return (s || "").replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** R2 object key for one chat attachment: chat/<thread>/<uniqueId>.<ext>. */
export function chatAttachmentKey(threadUserId: string, uniqueId: string, mime: string): string {
  return `chat/${safeSeg(threadUserId)}/${safeSeg(uniqueId)}.${extFromMime(mime)}`;
}

export type ChatAttachmentRow = {
  attachment: string | null;
  attachment_key: string | null;
  attachment_mime: string | null;
};

/**
 * Resolve a message's attachment to raw bytes + mime — from R2 (preferred) or
 * the legacy inline base64 data-URL. Null when the message has no attachment
 * (or the R2 object / data-URL is missing or invalid).
 */
export async function loadChatAttachmentBytes(
  row: ChatAttachmentRow,
): Promise<{ bytes: Buffer; mime: string } | null> {
  if (row.attachment_key) {
    const obj = await r2GetObject(row.attachment_key);
    if (!obj) return null;
    return { bytes: obj.body, mime: row.attachment_mime || obj.contentType || "application/octet-stream" };
  }
  if (row.attachment) {
    const v = validateImageDataUrl(row.attachment);
    if (!v.ok) return null;
    return { bytes: v.bytes, mime: v.mime };
  }
  return null;
}
