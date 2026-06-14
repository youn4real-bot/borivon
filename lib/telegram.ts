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

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** One sendMessage with bounded retries: respect Telegram's 429 retry_after
 *  (capped), and back off + retry on transient 5xx / network errors. A 4xx other
 *  than 429 is our bug — don't loop on it. (This is the @grammyjs/auto-retry idea
 *  inlined — no framework, since the bot owns its fetch helpers.) */
async function postMessage(chatId: string | number, text: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(`${API}/bot${token()}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      });
      if (r.ok) return;
      if (r.status === 429) {
        const j = (await r.json().catch(() => null)) as { parameters?: { retry_after?: number } } | null;
        await delay(Math.min(10, Number(j?.parameters?.retry_after) || 1) * 1000);
        continue;
      }
      if (r.status >= 500 && attempt < 2) { await delay(500 * (attempt + 1)); continue; } // transient server error
      console.error("[telegram] sendMessage HTTP", r.status); // 4xx (≠429) won't fix by retrying
      return;
    } catch (e) {
      if (attempt < 2) { await delay(500 * (attempt + 1)); continue; } // network blip → backoff + retry
      console.error("[telegram] sendMessage failed:", e instanceof Error ? e.message : e);
      return;
    }
  }
}

/** Send a plain-text message. Telegram caps a message at 4096 chars, so for long
 *  text we split — but on a WORD/LINE boundary, never mid-word/number/URL. */
export async function tgSend(chatId: string | number, text: string): Promise<void> {
  if (!token()) return;
  let rest = text;
  while (rest.length > 3900) {
    // Back up to the last newline or space before the limit so a word/number/link
    // is never sliced in half; only honor it if it isn't absurdly early.
    const boundary = Math.max(rest.lastIndexOf("\n", 3900), rest.lastIndexOf(" ", 3900));
    const cut = boundary > 3000 ? boundary : 3900;
    await postMessage(chatId, rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\s+/, "");
  }
  if (rest) await postMessage(chatId, rest);
}

/** Pack prose into 1–4 paragraph-boundary "bubbles" (never mid-sentence) so a
 *  reply arrives like a person typing in chat, not one monolith. A short reply
 *  stays ONE bubble. Pure → exported for tests. */
export function splitIntoBubbles(text: string, maxLen = 800, maxBubbles = 4): string[] {
  const clean = (text ?? "").trim();
  if (!clean) return [];
  const paras = clean.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (paras.length <= 1) return [clean]; // single block → one bubble (tgSend handles >4096)
  const bubbles: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (cur && cur.length + 2 + p.length > maxLen) { bubbles.push(cur); cur = p; }
    else cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur) bubbles.push(cur);
  if (bubbles.length > maxBubbles) {
    // Merge the overflow into the last allowed bubble so we never spam >maxBubbles.
    return [...bubbles.slice(0, maxBubbles - 1), bubbles.slice(maxBubbles - 1).join("\n\n")];
  }
  return bubbles;
}

/** Send a reply the natural way: as a few digestible bubbles with a brief
 *  "typing…" pause between them (the single biggest "feels like ChatGPT" lever).
 *  Short replies go out as one message with no delay. */
export async function tgSendNatural(chatId: string | number, text: string): Promise<void> {
  if (!token()) return;
  const bubbles = splitIntoBubbles(text);
  for (let i = 0; i < bubbles.length; i++) {
    if (i > 0) {
      void tgSendChatAction(chatId, "typing");
      await delay(Math.min(1400, 350 + bubbles[i].length * 5)); // human-ish pause, capped
    }
    await tgSend(chatId, bubbles[i]);
  }
}

/** Show the "Borivon Assistant is typing…" bubble once. Telegram clears it after
 *  ~5s or when the next message arrives. Best-effort. */
export async function tgSendChatAction(chatId: string | number, action: "typing" | "upload_document" = "typing"): Promise<void> {
  if (!token()) return;
  try {
    await fetch(`${API}/bot${token()}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action }),
    });
  } catch { /* best-effort — never block on the typing bubble */ }
}

/** Keep the "typing…" bubble alive while the bot thinks. Telegram's action lasts
 *  ~5s, so we re-send every 4s until the returned stop() is called. Makes the bot
 *  feel alive (a real chat) instead of dead-silent for several seconds. */
export function tgTypingLoop(chatId: string | number, action: "typing" | "upload_document" = "typing"): () => void {
  if (!token()) return () => {};
  let stopped = false;
  void tgSendChatAction(chatId, action); // immediate
  const timer = setInterval(() => { if (!stopped) void tgSendChatAction(chatId, action); }, 4000);
  return () => { stopped = true; clearInterval(timer); };
}

/** Send an actual file INTO the chat (multipart). Used to "pull" a candidate's
 *  document so it lands in Telegram, not just a link. */
export async function tgSendDocument(
  chatId: string | number,
  bytes: Uint8Array,
  fileName: string,
  caption?: string,
): Promise<boolean> {
  if (!token()) return false;
  try {
    const fd = new FormData();
    fd.append("chat_id", String(chatId));
    fd.append("document", new Blob([bytes as BlobPart]), fileName || "document");
    if (caption) fd.append("caption", caption.slice(0, 1000));
    const r = await fetch(`${API}/bot${token()}/sendDocument`, { method: "POST", body: fd });
    return r.ok;
  } catch (e) {
    console.error("[telegram] sendDocument failed:", e instanceof Error ? e.message : e);
    return false;
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
