/**
 * Native Gmail operations on the domain-wide-delegation client (lib/googleWorkspace).
 * Read / search / get-full / send (with threading) — the foundation for the bot's
 * full email: search the inbox, read a whole message, and REPLY in-thread (Gmail
 * threads on threadId + References, which only the API gives cleanly). All fail-safe:
 * return null / {ok:false} when Workspace isn't connected, so callers can fall back.
 */
import { gmailClient, workspaceConfigured } from "@/lib/googleWorkspace";
import nodemailer from "nodemailer";

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

export type EmailAttachmentMeta = { attachmentId: string; filename: string; mimeType: string; size: number };

/** List the real file attachments on a message (skips inline body parts). Walks
 *  the MIME tree for parts that have a filename + an attachmentId. */
export async function listEmailAttachments(messageId: string): Promise<EmailAttachmentMeta[] | null> {
  const gmail = gmailClient();
  if (!gmail) return null;
  try {
    const m = await gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
    const out: EmailAttachmentMeta[] = [];
    const walk = (p: any): void => {
      if (!p) return;
      if (p.filename && p.body?.attachmentId) {
        out.push({
          attachmentId: p.body.attachmentId,
          filename: String(p.filename).slice(0, 200),
          mimeType: p.mimeType || "application/octet-stream",
          size: typeof p.body.size === "number" ? p.body.size : 0,
        });
      }
      for (const part of p.parts ?? []) walk(part);
    };
    walk(m.data.payload);
    return out;
  } catch (e) {
    console.error("[gmailApi] listEmailAttachments failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Fetch one attachment's bytes by (messageId, attachmentId). */
export async function getEmailAttachmentBytes(messageId: string, attachmentId: string): Promise<Buffer | null> {
  const gmail = gmailClient();
  if (!gmail) return null;
  try {
    const a = await gmail.users.messages.attachments.get({ userId: "me", messageId, id: attachmentId });
    const data = a.data.data;
    if (!data) return null;
    return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  } catch (e) {
    console.error("[gmailApi] getEmailAttachmentBytes failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

// The founder's REAL Gmail signature, read natively via the API (gmail.modify
// scope covers settings.sendAs) and cached per warm instance for an hour so it's
// not an API call on every send. Replaces the old OAuth-based signature feature.
let _sigCache: { html: string | null; at: number } | null = null;
export async function getNativeGmailSignature(): Promise<string | null> {
  if (_sigCache && Date.now() - _sigCache.at < 3_600_000) return _sigCache.html;
  const gmail = gmailClient();
  if (!gmail) return null;
  try {
    const r = await gmail.users.settings.sendAs.list({ userId: "me" });
    const list = r.data.sendAs ?? [];
    const primary = list.find((s) => s.isPrimary) ?? list.find((s) => s.isDefault) ?? list[0];
    const html = (primary?.signature ?? "").trim() || null;
    _sigCache = { html, at: Date.now() };
    return html;
  } catch (e) {
    console.error("[gmailApi] signature read failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

export type RawMessageOpts = {
  to: string; cc?: string; subject: string; html: string; text: string;
  fromName: string; fromEmail: string;
  inReplyTo?: string; references?: string;
  attachments?: { filename: string; content: Buffer }[];
};

/** Build a complete, correctly-encoded RFC-822 message as base64url — using
 *  nodemailer's battle-tested MIME composer instead of hand-concatenating headers
 *  and boundaries. The hand-rolled version was the #1 source of subtle email bugs
 *  (encoding, threading headers, no attachment support). This is PURE and
 *  Google-free, so it's unit-testable without a live mailbox. */
export async function buildRawMessage(opts: RawMessageOpts): Promise<string> {
  // streamTransport + buffer:true makes sendMail BUILD the message and hand it
  // back as a Buffer WITHOUT sending — the documented way to extract raw MIME
  // from nodemailer. CRLF newlines per RFC-822. nodemailer sets In-Reply-To /
  // References / encodes the (possibly non-ASCII) subject / lays out multipart.
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "\r\n" });
  const info = await transport.sendMail({
    from: `"${opts.fromName}" <${opts.fromEmail}>`,
    to: opts.to,
    ...(opts.cc ? { cc: opts.cc } : {}),
    subject: opts.subject.replace(/[\r\n]+/g, " ").trim(),
    text: opts.text,
    html: opts.html,
    ...(opts.inReplyTo ? { inReplyTo: opts.inReplyTo } : {}),
    ...(opts.references ? { references: opts.references } : {}),
    ...(opts.attachments?.length ? { attachments: opts.attachments.map((a) => ({ filename: a.filename, content: a.content })) } : {}),
  });
  const msg = (info as unknown as { message?: Buffer }).message;
  const raw = Buffer.isBuffer(msg) ? msg : Buffer.from(String(msg ?? ""));
  return raw.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Low-level send via the Gmail API (lands in the founder's Sent natively). Pass
 *  threadId + inReplyTo/references to thread a reply; attachments to enclose files. */
export async function gmailSendRaw(opts: RawMessageOpts & { threadId?: string }): Promise<{ ok: boolean; id?: string; error?: string }> {
  const gmail = gmailClient();
  if (!gmail) return { ok: false, error: "workspace_not_connected" };
  try {
    const raw = await buildRawMessage(opts);
    const res = await gmail.users.messages.send({ userId: "me", requestBody: { raw, ...(opts.threadId ? { threadId: opts.threadId } : {}) } });
    return { ok: true, id: res.data.id ?? undefined };
  } catch (e) {
    console.error("[gmailApi] send failed:", e instanceof Error ? e.message : e);
    return { ok: false, error: e instanceof Error ? e.message : "send_failed" };
  }
}

/** Create a Gmail DRAFT (saved in the founder's Drafts, NOT sent) — they finish
 *  + send it from Gmail. Same RawMessageOpts as a send; pass threadId for a
 *  reply-draft. */
export async function gmailCreateDraft(opts: RawMessageOpts & { threadId?: string }): Promise<{ ok: boolean; id?: string; error?: string }> {
  const gmail = gmailClient();
  if (!gmail) return { ok: false, error: "workspace_not_connected" };
  try {
    const raw = await buildRawMessage(opts);
    const res = await gmail.users.drafts.create({ userId: "me", requestBody: { message: { raw, ...(opts.threadId ? { threadId: opts.threadId } : {}) } } });
    return { ok: true, id: res.data.id ?? undefined };
  } catch (e) {
    console.error("[gmailApi] draft create failed:", e instanceof Error ? e.message : e);
    return { ok: false, error: e instanceof Error ? e.message : "draft_failed" };
  }
}

/** The quoted "---------- Forwarded message ----------" block (pure → testable). */
export function buildForwardQuote(orig: { fromName: string; from: string; date: string; subject: string; to: string; body: string }): string {
  return [
    "---------- Forwarded message ----------",
    `From: ${orig.fromName} <${orig.from}>`,
    `Date: ${orig.date}`,
    `Subject: ${orig.subject}`,
    `To: ${orig.to}`,
    "",
    orig.body,
  ].join("\n");
}

export type ThreadView = { subject: string; messages: { from: string; fromName: string; date: string; body: string }[] };

/** Read a WHOLE conversation — every message in the thread that `messageId` is in. */
export async function gmailGetThread(messageId: string): Promise<ThreadView | null> {
  const gmail = gmailClient();
  if (!gmail) return null;
  try {
    const head = await gmail.users.messages.get({ userId: "me", id: messageId, format: "metadata", metadataHeaders: ["Subject"] });
    const threadId = head.data.threadId;
    if (!threadId) return null;
    const t = await gmail.users.threads.get({ userId: "me", id: threadId, format: "full" });
    const messages = (t.data.messages ?? []).map((m) => {
      const headers = m.payload?.headers as Hdr[] | undefined;
      const fromRaw = hdr(headers, "From");
      return { from: emailOf(fromRaw), fromName: nameOf(fromRaw), date: hdr(headers, "Date"), body: extractBody(m.payload).slice(0, 4000) };
    });
    const subject = hdr(head.data.payload?.headers as Hdr[] | undefined, "Subject") || "(conversation)";
    return { subject, messages };
  } catch (e) {
    console.error("[gmailApi] getThread failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Add/remove labels on a message — archive (remove INBOX), mark read (remove
 *  UNREAD), star (add STARRED), spam (add SPAM + remove INBOX), etc. */
export async function gmailModify(messageId: string, addLabelIds: string[], removeLabelIds: string[]): Promise<boolean> {
  const gmail = gmailClient();
  if (!gmail) return false;
  try {
    await gmail.users.messages.modify({ userId: "me", id: messageId, requestBody: { addLabelIds, removeLabelIds } });
    return true;
  } catch (e) {
    console.error("[gmailApi] modify failed:", e instanceof Error ? e.message : e);
    return false;
  }
}

/** Move a message to Trash (reversible ~30 days) or restore it. NOT a permanent
 *  delete — we never hard-delete mail. */
export async function gmailTrash(messageId: string, restore = false): Promise<boolean> {
  const gmail = gmailClient();
  if (!gmail) return false;
  try {
    if (restore) await gmail.users.messages.untrash({ userId: "me", id: messageId });
    else await gmail.users.messages.trash({ userId: "me", id: messageId });
    return true;
  } catch (e) {
    console.error("[gmailApi] trash failed:", e instanceof Error ? e.message : e);
    return false;
  }
}
