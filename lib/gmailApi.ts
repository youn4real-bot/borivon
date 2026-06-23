/**
 * Native Gmail operations on the domain-wide-delegation client (lib/googleWorkspace).
 * Read / search / get-full / send (with threading) — the foundation for the bot's
 * full email: search the inbox, read a whole message, and REPLY in-thread (Gmail
 * threads on threadId + References, which only the API gives cleanly). All fail-safe:
 * return null / {ok:false} when Workspace isn't connected, so callers can fall back.
 */
import { gmailClient, workspaceConfigured } from "@/lib/googleWorkspace";
import nodemailer from "nodemailer";
import { buildMimeBase64Url } from "@/lib/mimeBuilder";

// On Cloudflare Workers, nodemailer's MIME composer (even in socket-free streamTransport
// mode) leans on Node stream/os/crypto surface workerd doesn't fully provide → reply /
// forward / draft would silently fail. Use the pure-JS MIME builder there instead. Vercel
// (Node) keeps the battle-tested nodemailer path. Same detection as lib/googleWorkspace.ts.
const ON_WORKERS = typeof navigator !== "undefined" && (navigator as { userAgent?: string }).userAgent === "Cloudflare-Workers";

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
// Machine senders that are never a "needs a follow-up" counterparty (no-reply, newsletters,
// billing bots). Mirrors lib/gmailInbox.ts so the follow-up engine skips them too.
const AUTOMATED_RE =
  /(^|[._-])(no-?reply|do-?not-?reply|donotreply|do-not-respond|notifications?|notify|alerts?|alerting|mailer|mailer-daemon|postmaster|bounce|bounces|automated|auto-?confirm|newsletter|news|updates?|digest|unsubscribe|receipts?|billing|invoices?)@/i;

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

/** Read one message in full (decoded body + the headers needed to thread a reply).
 *  `maxBody` caps the decoded body (default 8000 — plenty for the model to read / for a
 *  reply quote). FORWARDING passes a much higher cap so a long embassy letter / contract
 *  isn't silently chopped to 8 KB before being re-sent. */
export async function gmailGet(id: string, maxBody = 8000): Promise<FullEmail | null> {
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
      body: extractBody(m.data.payload).slice(0, Math.max(1, maxBody)),
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
  to: string; cc?: string; bcc?: string; subject: string; html: string; text: string;
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
  // Cloudflare Workers: nodemailer is unreliable on workerd → use the pure-JS RFC-822
  // builder (lib/mimeBuilder.ts). Produces an equivalent, valid, correctly-threaded
  // base64url message. Vercel (Node) falls through to the nodemailer path below.
  if (ON_WORKERS) {
    return buildMimeBase64Url({
      to: opts.to, cc: opts.cc, bcc: opts.bcc, subject: opts.subject,
      html: opts.html, text: opts.text, fromName: opts.fromName, fromEmail: opts.fromEmail,
      inReplyTo: opts.inReplyTo, references: opts.references,
      attachments: opts.attachments?.map((a) => ({ filename: a.filename, content: a.content })),
    });
  }
  // streamTransport + buffer:true makes sendMail BUILD the message and hand it
  // back as a Buffer WITHOUT sending — the documented way to extract raw MIME
  // from nodemailer. CRLF newlines per RFC-822. nodemailer sets In-Reply-To /
  // References / encodes the (possibly non-ASCII) subject / lays out multipart.
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "\r\n" });
  const info = await transport.sendMail({
    from: `"${opts.fromName}" <${opts.fromEmail}>`,
    to: opts.to,
    ...(opts.cc ? { cc: opts.cc } : {}),
    ...(opts.bcc ? { bcc: opts.bcc } : {}),
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
export async function gmailCreateDraft(opts: RawMessageOpts & { threadId?: string }): Promise<{ ok: boolean; id?: string; messageId?: string; error?: string }> {
  const gmail = gmailClient();
  if (!gmail) return { ok: false, error: "workspace_not_connected" };
  try {
    const raw = await buildRawMessage(opts);
    const res = await gmail.users.drafts.create({ userId: "me", requestBody: { message: { raw, ...(opts.threadId ? { threadId: opts.threadId } : {}) } } });
    // draftId (for send) + the draft's message id (for reading its attachments back).
    return { ok: true, id: res.data.id ?? undefined, messageId: res.data.message?.id ?? undefined };
  } catch (e) {
    console.error("[gmailApi] draft create failed:", e instanceof Error ? e.message : e);
    return { ok: false, error: e instanceof Error ? e.message : "draft_failed" };
  }
}

/** SEND an existing draft exactly as-is (its attachments are whatever's on it —
 *  the single source of truth). Lands in the founder's Sent natively. */
export async function gmailSendDraft(draftId: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  const gmail = gmailClient();
  if (!gmail) return { ok: false, error: "workspace_not_connected" };
  try {
    const res = await gmail.users.drafts.send({ userId: "me", requestBody: { id: draftId } });
    return { ok: true, id: res.data.id ?? undefined };
  } catch (e) {
    console.error("[gmailApi] draft send failed:", e instanceof Error ? e.message : e);
    return { ok: false, error: e instanceof Error ? e.message : "draft_send_failed" };
  }
}

/** Read a draft's REAL attachments (so the founder can verify exactly what's on
 *  the draft before sending). Returns the draft's message id (to fetch the bytes
 *  via getEmailAttachmentBytes) + the attachment list. */
export async function listDraftAttachments(draftId: string): Promise<{ messageId: string; attachments: EmailAttachmentMeta[] } | null> {
  const gmail = gmailClient();
  if (!gmail) return null;
  try {
    const d = await gmail.users.drafts.get({ userId: "me", id: draftId, format: "full" });
    const messageId = d.data.message?.id ?? "";
    const out: EmailAttachmentMeta[] = [];
    const walk = (p: any): void => {
      if (!p) return;
      if (p.filename && p.body?.attachmentId) {
        out.push({ attachmentId: p.body.attachmentId, filename: String(p.filename).slice(0, 200), mimeType: p.mimeType || "application/octet-stream", size: typeof p.body.size === "number" ? p.body.size : 0 });
      }
      for (const part of p.parts ?? []) walk(part);
    };
    walk(d.data.message?.payload);
    return { messageId, attachments: out };
  } catch (e) {
    console.error("[gmailApi] listDraftAttachments failed:", e instanceof Error ? e.message : e);
    return null;
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

export type FollowUp = {
  threadId: string;
  lastMessageId: string;
  who: string;        // the OTHER party's email
  whoName: string;    // their display name
  subject: string;
  lastDate: string;   // ISO of the last message in the thread
  ageDays: number;    // whole days since the last message
  direction: "awaiting_them" | "i_owe"; // last msg from me → awaiting their reply; from them → I owe one
  lastFrom: string;   // who sent the LAST message (email)
};

export type ThreadMsg = { id: string; fromEmail: string; fromName: string; to: string; subject: string; internal: number };

/**
 * PURE classification of ONE thread into a follow-up (or null). The bug-prone core of the
 * follow-up engine, exported so it's unit-tested deterministically (the I/O wrapper just
 * fetches threads + calls this). `me` is my own address; `now` lets tests pin ageDays.
 *   last message from ME  → "awaiting_them" (they owe me a reply → chase them)
 *   last message from THEM → "i_owe"        (I owe them a reply)
 * Returns null when the other party is automated/no-reply, or can't be resolved.
 */
export function classifyThreadFollowUp(msgs: ThreadMsg[], me: string, now: number = Date.now()): FollowUp | null {
  if (!msgs.length) return null;
  const meL = (me || "").toLowerCase();
  const sorted = [...msgs].sort((a, b) => a.internal - b.internal); // oldest → newest
  const last = sorted[sorted.length - 1];
  const lastFromMe = !!meL && last.fromEmail.toLowerCase() === meL;
  const direction: "awaiting_them" | "i_owe" = lastFromMe ? "awaiting_them" : "i_owe";
  let who = "", whoName = "";
  if (direction === "i_owe") { who = last.fromEmail.toLowerCase(); whoName = last.fromName; }
  else {
    who = emailOf(last.to); whoName = nameOf(last.to);
    if (!who || who === meL) { const other = sorted.find((p) => p.fromEmail && p.fromEmail.toLowerCase() !== meL); if (other) { who = other.fromEmail.toLowerCase(); whoName = other.fromName; } }
  }
  if (!who || who === meL || AUTOMATED_RE.test(who)) return null;
  const lastMs = last.internal || 0;
  return {
    threadId: "",
    lastMessageId: last.id,
    who,
    whoName: (whoName || who).slice(0, 120),
    subject: (last.subject || sorted[0].subject || "(no subject)").slice(0, 200),
    lastDate: lastMs ? new Date(lastMs).toISOString() : "",
    ageDays: lastMs ? Math.max(0, Math.floor((now - lastMs) / 86_400_000)) : 0,
    direction,
    lastFrom: last.fromEmail.toLowerCase(),
  };
}

/**
 * THE follow-up engine. Finds threads that NEED A FOLLOW-UP, in EITHER direction, over ANY
 * timeframe — based on the ACTUAL last message in each thread (not just unread state):
 *   • "awaiting_them" — the LAST message is from ME and the other side hasn't replied → chase them.
 *   • "i_owe"         — the LAST message is from THEM and I haven't replied → I owe a reply.
 * Window via `days` (newer_than) OR an explicit Gmail date query in `opts.query`
 * ("after:2026/05/01 before:2026/06/01"); `query` also narrows by person ("from:anna").
 * Real people only (automated/no-reply senders skipped). Most-overdue first. Same mailbox
 * (gmailClient, userId:"me") the rest of the bot's email tools use. Null on read failure.
 */
export async function gmailFindFollowUps(opts: {
  direction: "awaiting_them" | "i_owe" | "both";
  days?: number;
  query?: string;
  maxThreads?: number;
}): Promise<FollowUp[] | null> {
  const gmail = gmailClient();
  if (!gmail) return null;
  try {
    // MY address — needed to tell which messages in a thread are mine.
    let me = "";
    try { const p = await gmail.users.getProfile({ userId: "me" }); me = (p.data.emailAddress || "").toLowerCase(); } catch { /* fall back below */ }
    if (!me) me = (process.env.GMAIL_USER || process.env.GOOGLE_WORKSPACE_SUBJECT || "").toLowerCase();

    const days = opts.days && opts.days > 0 ? Math.min(opts.days, 365) : 7;
    const cap = Math.min(Math.max(opts.maxThreads ?? 50, 1), 60);
    const userQuery = (opts.query || "").trim();
    const hasExplicitWindow = /\b(after|before|older_than|newer_than):/i.test(userQuery);
    // Exclude chats/spam/trash; AND the caller's filter; apply the time window unless the
    // caller already gave an explicit one.
    const q = [userQuery, hasExplicitWindow ? "" : `newer_than:${days}d`, "-in:chats", "-in:spam", "-in:trash"]
      .filter(Boolean).join(" ");

    const list = await gmail.users.threads.list({ userId: "me", q, maxResults: cap });
    const threadIds = (list.data.threads ?? []).map((t) => t.id!).filter(Boolean);
    const out: FollowUp[] = [];
    for (const tid of threadIds) {
      const t = await gmail.users.threads.get({ userId: "me", id: tid, format: "metadata", metadataHeaders: ["From", "To", "Subject", "Date"] });
      const msgs = (t.data.messages ?? []).map((m) => {
        const h = m.payload?.headers as Hdr[] | undefined;
        const fromRaw = hdr(h, "From");
        return {
          id: m.id ?? "",
          fromEmail: emailOf(fromRaw),
          fromName: nameOf(fromRaw),
          to: hdr(h, "To"),
          subject: hdr(h, "Subject"),
          internal: m.internalDate ? Number(m.internalDate) : 0,
        };
      });
      const fu = classifyThreadFollowUp(msgs, me);
      if (!fu) continue; // automated/no counterparty
      if (opts.direction !== "both" && fu.direction !== opts.direction) continue;
      fu.threadId = tid;
      out.push(fu);
    }
    out.sort((a, b) => b.ageDays - a.ageDays); // most overdue first
    return out;
  } catch (e) {
    console.error("[gmailApi] findFollowUps failed:", e instanceof Error ? e.message : e);
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
