/**
 * Files the founder sends the bot in the Telegram chat (photos, PDFs, …) are
 * stored in R2 under chat-uploads/<userId>/<uuid>__<originalName>. This lets the
 * bot ATTACH those chat-uploaded files to an outbound email later ("email Anna
 * those JPGs I sent") — not just files that came from email or the candidate
 * store. No DB: we list the founder's recent chat uploads straight from R2.
 */
import { r2List, r2GetObject } from "@/lib/r2";
import type { OutboundAttachment } from "@/lib/outboundEmail";

/** Recover a sane attachment filename from a chat-upload key. New keys carry the
 *  original name after "__"; legacy keys (uuid.ext) fall back to the base. */
export function nameFromChatKey(key: string): string {
  const base = key.split("/").pop() || "datei";
  const i = base.indexOf("__");
  const name = i >= 0 ? base.slice(i + 2) : base;
  return name.trim() || "datei";
}

/** The founder's most-recent chat uploads as email attachments (bytes from R2),
 *  newest first. Empty when none / R2 unavailable. */
export async function recentChatUploadAttachments(
  ownerUserId: string,
  opts: { withinHours?: number; limit?: number } = {},
): Promise<OutboundAttachment[]> {
  if (!ownerUserId) return [];
  const withinMs = (opts.withinHours ?? 168) * 3_600_000; // 7 days
  const limit = opts.limit ?? 8;
  let listed: { key: string; lastModified?: Date }[] = [];
  try {
    listed = await r2List(`chat-uploads/${ownerUserId}/`);
  } catch {
    return [];
  }
  const now = Date.now();
  const recent = listed
    .filter((o) => o.key && (!o.lastModified || now - o.lastModified.getTime() <= withinMs))
    .sort((a, b) => (b.lastModified?.getTime() ?? 0) - (a.lastModified?.getTime() ?? 0))
    .slice(0, limit);
  const out: OutboundAttachment[] = [];
  for (const o of recent) {
    const obj = await r2GetObject(o.key);
    if (obj?.body) out.push({ filename: nameFromChatKey(o.key), content: obj.body });
  }
  return out;
}
