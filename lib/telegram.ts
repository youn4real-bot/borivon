/**
 * Minimal Telegram Bot helpers for the Borivon ops bot. Server-only.
 * Reads TELEGRAM_BOT_TOKEN. Everything no-ops gracefully when unset so the
 * feature ships inert until the token is added.
 */
import { getServiceSupabase } from "@/lib/supabase";

const API = "https://api.telegram.org";
const token = () => process.env.TELEGRAM_BOT_TOKEN || "";

export function telegramConfigured(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN;
}

/** Send a plain-text message (chunked to Telegram's 4096-char limit). */
export async function tgSend(chatId: string | number, text: string): Promise<void> {
  if (!token()) return;
  for (let i = 0; i < text.length; i += 3900) {
    const chunk = text.slice(i, i + 3900);
    try {
      await fetch(`${API}/bot${token()}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: chunk, disable_web_page_preview: true }),
      });
    } catch (e) {
      console.error("[telegram] sendMessage failed:", e instanceof Error ? e.message : e);
    }
  }
}

/** Download a Telegram file (e.g. a voice note) → bytes + best-guess mime. */
export async function tgGetFileBytes(fileId: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  if (!token()) return null;
  try {
    const r = await fetch(`${API}/bot${token()}/getFile?file_id=${encodeURIComponent(fileId)}`);
    const j = (await r.json()) as { result?: { file_path?: string } };
    const path = j?.result?.file_path;
    if (!path) return null;
    const f = await fetch(`${API}/file/bot${token()}/${path}`);
    if (!f.ok) return null;
    const bytes = new Uint8Array(await f.arrayBuffer());
    const mime = /\.(oga|ogg)$/i.test(path) ? "audio/ogg" : /\.mp3$/i.test(path) ? "audio/mpeg" : /\.m4a$/i.test(path) ? "audio/mp4" : "audio/ogg";
    return { bytes, mime };
  } catch (e) {
    console.error("[telegram] getFile failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Resolve the supreme admin's user id (for owner-scoped tools), cached per warm instance. */
let _adminId: string | null | undefined;
export async function getAdminUserId(): Promise<string | null> {
  if (_adminId !== undefined) return _adminId;
  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  if (!email) { _adminId = null; return null; }
  const db = getServiceSupabase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error || !data?.users?.length) break;
    const u = data.users.find((x) => (x.email ?? "").trim().toLowerCase() === email);
    if (u) { _adminId = u.id; return u.id; }
    if (data.users.length < 1000) break;
  }
  _adminId = null;
  return null;
}
