/**
 * Native Gmail operations on the domain-wide-delegation client (lib/googleWorkspace).
 * Read / search / get-full / send (with threading) — the foundation for the bot's
 * full email: search the inbox, read a whole message, and REPLY in-thread (Gmail
 * threads on threadId + References, which only the API gives cleanly). All fail-safe:
 * return null / {ok:false} when Workspace isn't connected, so callers can fall back.
 */
import { gmailClient, workspaceConfigured } from "@/lib/googleWorkspace";

export function gmailApiReady(): boolean {
  return workspaceConfigured() && !!gmailClient();
}

type Hdr = { name?: string | null; value?: string | null };
function hdr(headers: Hdr[] | undefined, name: string): string {
  return (headers ?? []).find((x) => (x.name ?? "").toLowerCase() === name.toLowerCase())?.value ?? "";
}
function b64urlDecode(s: string): string {
  return Buffer.from((s || "").replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}
function b64url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function emailOf(raw: string): string {
  return (raw.match(/<([^>]+)>/)?.[1] || raw).trim().toLowerCase();
}
function nameOf(raw: string): string {
  return raw.replace(/<[^>]+>/, "").replace(/"/g, "").trim() || emailOf(raw);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function extractBody(payload: any): string {
  const walk = (p: any, want: string): string | null => {
    if (!p) return null;
    if (p.mimeType === want && p.body?.data) return b64urlDecode(p.body.data);
    for (const part of p.parts ?? []) { const r = walk(part, want); if (r) return r; }
    return null;
  };
  const plain = walk(payload, "text/plain");
  if (plain) return plain.trim();
  const html = walk(payload, "text/html");
  if (html) {
    return html
      .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|h[1-6]|li)>/gi, "\n")
      .replace(/<[^>]+>/g, "").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
      .replace(/\n{3,}/g, "\n\n").trim();
  }
  if (payload?.body?.data) return b64urlDecode(payload.body.data).trim();
  return "";
}

export type EmailSummary = { id: string; threadId: string; from: string; fromName: string; subject: string; date: string; snippet: string };
export type FullEmail = EmailSummary & { to: string; cc: string; body: string; messageIdHeader: string; references: string };

/** Search the mailbox with Gmail query syntax (e.g. "from:anna newer_than:30d",
 *  "in:inbox is:unread", "subject:interview"). Default = recent inbox. */
export async function gmailSearch(query: string, max = 15): Promise<EmailSummary[] | null> {
  const gmail = gmailClient();
  if (!gmail) return null;
  try {
    const list = await gmail.users.messages.list({ userId: "me", q: query?.trim() || "in:inbox", maxResults: Math.min(Math.max(max, 1), 25) });
    const ids = (list.data.messages ?? []).map((m) => m.id!).filter(Boolean);
    const out: EmailSummary[] = [];
    for (const id of ids) {
      const m = await gmail.users.messages.get({ userId: "me", id, format: "metadata", metadataHeaders: ["From", "Subject", "Date"] });
      const headers = m.data.payload?.headers as Hdr[] | undefined;
      const fromRaw = hdr(headers, "From");
      out.push({
        id, threadId: m.data.threadId ?? "",
        from: emailOf(fromRaw), fromName: nameOf(fromRaw),
        subject: hdr(headers, "Subject") || "(no subject)", date: hdr(headers, "Date"),
        snippet: (m.data.snippet ?? "").slice(0, 200),
      });
    }
    return out;
  } catch (e) {
    console.error("[gmailApi] search failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Read one message in full (decoded body + the headers needed to thread a reply). */
export async function gmailGet(id: string): Promise<FullEmail | null> {
  const gmail = gmailClient();
  if (!gmail) return null;
  try {
    const m = await gmail.users.messages.get({ userId: "me", id, format: "full" });
    const headers = m.data.payload?.headers as Hdr[] | undefined;
    const fromRaw = hdr(headers, "From");
    return {
      id, threadId: m.data.threadId ?? "",
      from: emailOf(fromRaw), fromName: nameOf(fromRaw),
      to: hdr(headers, "To"), cc: hdr(headers, "Cc"),
      subject: hdr(headers, "Subject") || "(no subject)", date: hdr(headers, "Date"),
      snippet: (m.data.snippet ?? "").slice(0, 200),
      body: extractBody(m.data.payload).slice(0, 8000),
      messageIdHeader: hdr(headers, "Message-ID") || hdr(headers, "Message-Id"),
      references: hdr(headers, "References"),
    };
  } catch (e) {
    console.error("[gmailApi] get failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Low-level send via the Gmail API (lands in the founder's Sent natively). Pass
 *  threadId + inReplyTo/references to thread a reply. Builds a multipart/alternative
 *  (text + html) RFC-822 message. */
export async function gmailSendRaw(opts: {
  to: string; cc?: string; subject: string; html: string; text: string;
  fromName: string; fromEmail: string; inReplyTo?: string; references?: string; threadId?: string;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const gmail = gmailClient();
  if (!gmail) return { ok: false, error: "workspace_not_connected" };
  try {
    const boundary = "bnd_" + Math.abs([...opts.subject].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)).toString(36);
    const mime = [
      `From: "${opts.fromName}" <${opts.fromEmail}>`,
      `To: ${opts.to}`,
      opts.cc ? `Cc: ${opts.cc}` : null,
      `Subject: ${opts.subject.replace(/[\r\n]+/g, " ").trim()}`,
      opts.inReplyTo ? `In-Reply-To: ${opts.inReplyTo}` : null,
      opts.references ? `References: ${opts.references}` : null,
      "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(opts.text, "utf8").toString("base64"),
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(opts.html, "utf8").toString("base64"),
      `--${boundary}--`,
      "",
    ].filter((l) => l !== null).join("\r\n");
    const res = await gmail.users.messages.send({ userId: "me", requestBody: { raw: b64url(mime), ...(opts.threadId ? { threadId: opts.threadId } : {}) } });
    return { ok: true, id: res.data.id ?? undefined };
  } catch (e) {
    console.error("[gmailApi] send failed:", e instanceof Error ? e.message : e);
    return { ok: false, error: e instanceof Error ? e.message : "send_failed" };
  }
}
