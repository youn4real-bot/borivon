/**
 * lib/mimeBuilder.ts — pure-JS RFC-822 / MIME composer.
 *
 * A Cloudflare-Workers-safe replacement for nodemailer's `streamTransport` MIME
 * builder. nodemailer is a Node mailer: even in streamTransport mode (which only
 * ASSEMBLES the message, no socket) its internals lean on Node stream/os/crypto
 * surface that the workerd runtime (via unenv) doesn't fully provide — so the bot's
 * reply / forward / draft path (lib/gmailApi.ts buildRawMessage) is unreliable on
 * Workers. This module builds the SAME thing nodemailer hands back — a complete
 * RFC-822 message, base64url-encoded, ready for Gmail API `messages.send` /
 * `drafts.create` `raw` — using only TextEncoder + btoa + (optional) crypto.randomUUID,
 * all present on BOTH Node and workerd.
 *
 * It does NOT try to be byte-identical to nodemailer; it produces an EQUIVALENT,
 * valid, correctly-threaded message. Vercel keeps nodemailer (unchanged, battle-
 * tested); only the ON_WORKERS branch in gmailApi.ts calls this. Pure + sync →
 * unit-tested without a mailbox or network (tests/mimeBuilder.test.ts).
 *
 * SECURITY: every header value is stripped of CR/LF before use (header-injection
 * guard) and non-ASCII header text is RFC-2047 encoded-word wrapped.
 */

export type MimeAttachment = { filename: string; content: Uint8Array };
export type MimeOpts = {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  html: string;
  text: string;
  fromName: string;
  fromEmail: string;
  inReplyTo?: string;
  references?: string;
  attachments?: { filename: string; content: Uint8Array }[];
};

const CRLF = "\r\n";

/** base64-encode bytes (chunked so a big attachment can't blow the call stack). */
function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000; // 32 KiB — under the String.fromCharCode.apply arg cap
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(bin);
}

/** Wrap a base64 string to 76-char lines (RFC 2045) with CRLF. */
function wrap76(b64: string): string {
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 76) lines.push(b64.slice(i, i + 76));
  return lines.join(CRLF);
}

/** A UTF-8 string body, base64-encoded + line-wrapped. */
function b64Body(s: string): string {
  return wrap76(bytesToB64(new TextEncoder().encode(s)));
}

/** Strip CR/LF (and collapse whitespace) from a header value — header-injection guard. */
function cleanHeader(s: string): string {
  return (s || "").replace(/[\r\n]+/g, " ").trim();
}

/** RFC-2047 encoded-word for header TEXT that may be non-ASCII; ASCII passes through. */
function encodeWordIfNeeded(s: string): string {
  if (/^[\x20-\x7E]*$/.test(s)) return s; // printable ASCII → as-is
  return `=?UTF-8?B?${bytesToB64(new TextEncoder().encode(s))}?=`;
}

/** Format the From header: "Name" <email>, RFC-2047-encoding a non-ASCII name. */
function formatFrom(name: string, email: string): string {
  const cleanName = cleanHeader(name);
  const cleanEmail = cleanHeader(email);
  if (!cleanName) return cleanEmail;
  const isAscii = /^[\x20-\x7E]*$/.test(cleanName);
  return isAscii ? `"${cleanName.replace(/"/g, "")}" <${cleanEmail}>` : `${encodeWordIfNeeded(cleanName)} <${cleanEmail}>`;
}

/** A short unique boundary token (crypto.randomUUID on Node 19+/workerd; falls back to a
 *  time/counter token if unavailable — only used to separate MIME parts, not security). */
let _seq = 0;
function boundary(prefix: string): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
    }
  } catch { /* fall through */ }
  _seq += 1;
  return `${prefix}_b0r1v0n${_seq}x${(_seq * 2654435761) >>> 0}`;
}

/** Guess a content-type from a filename extension (common bot attachments); octet-stream otherwise. */
function guessContentType(filename: string): string {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  const map: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    txt: "text/plain",
    csv: "text/csv",
    zip: "application/zip",
  };
  return map[ext] || "application/octet-stream";
}

/** Final base64url-encode of the full assembled message. */
function toBase64Url(message: string): string {
  return bytesToB64(new TextEncoder().encode(message)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Build a complete RFC-822 message and return it base64url-encoded (Gmail API `raw`).
 * Mirrors lib/gmailApi.ts RawMessageOpts. Pure + deterministic except for MIME
 * boundary tokens (which don't affect parsing). Gmail assigns Date + Message-ID, so
 * we omit them; In-Reply-To / References drive threading and are included verbatim.
 */
export function buildMimeBase64Url(opts: MimeOpts): string {
  const headers: string[] = [];
  headers.push(`From: ${formatFrom(opts.fromName, opts.fromEmail)}`);
  headers.push(`To: ${cleanHeader(opts.to)}`);
  if (opts.cc) headers.push(`Cc: ${cleanHeader(opts.cc)}`);
  if (opts.bcc) headers.push(`Bcc: ${cleanHeader(opts.bcc)}`);
  headers.push(`Subject: ${encodeWordIfNeeded(cleanHeader(opts.subject))}`);
  if (opts.inReplyTo) headers.push(`In-Reply-To: ${cleanHeader(opts.inReplyTo)}`);
  if (opts.references) headers.push(`References: ${cleanHeader(opts.references)}`);
  headers.push("MIME-Version: 1.0");

  const text = opts.text || "";
  const html = opts.html || "";
  const atts = opts.attachments ?? [];

  // The message body: multipart/alternative when BOTH text+html, else a single part.
  const altBoundary = boundary("alt");
  const bothBodies = !!text && !!html;
  let bodyContentType: string;
  let bodySection: string; // the bytes that go AFTER the (body's) Content-Type header block
  if (bothBodies) {
    bodyContentType = `multipart/alternative; boundary="${altBoundary}"`;
    bodySection =
      `--${altBoundary}${CRLF}` +
      `Content-Type: text/plain; charset="UTF-8"${CRLF}Content-Transfer-Encoding: base64${CRLF}${CRLF}${b64Body(text)}${CRLF}` +
      `--${altBoundary}${CRLF}` +
      `Content-Type: text/html; charset="UTF-8"${CRLF}Content-Transfer-Encoding: base64${CRLF}${CRLF}${b64Body(html)}${CRLF}` +
      `--${altBoundary}--`;
  } else if (html) {
    bodyContentType = `text/html; charset="UTF-8"`;
    bodySection = b64Body(html);
  } else {
    bodyContentType = `text/plain; charset="UTF-8"`;
    bodySection = b64Body(text);
  }

  // No attachments: the body IS the top-level entity.
  if (atts.length === 0) {
    const out: string[] = [...headers, `Content-Type: ${bodyContentType}`];
    if (!bothBodies) out.push("Content-Transfer-Encoding: base64");
    out.push("");
    out.push(bodySection);
    return toBase64Url(out.join(CRLF));
  }

  // With attachments: multipart/mixed, body first, then each attachment.
  const mixedBoundary = boundary("mixed");
  const out: string[] = [...headers, `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`, ""];
  out.push(`--${mixedBoundary}`);
  out.push(`Content-Type: ${bodyContentType}`);
  if (!bothBodies) out.push("Content-Transfer-Encoding: base64");
  out.push("");
  out.push(bodySection);
  for (const a of atts) {
    const fn = cleanHeader(a.filename || "attachment").replace(/"/g, "");
    out.push(`--${mixedBoundary}`);
    out.push(`Content-Type: ${guessContentType(fn)}; name="${fn}"`);
    out.push("Content-Transfer-Encoding: base64");
    out.push(`Content-Disposition: attachment; filename="${fn}"`);
    out.push("");
    out.push(wrap76(bytesToB64(a.content instanceof Uint8Array ? a.content : new Uint8Array(a.content))));
  }
  out.push(`--${mixedBoundary}--`);
  return toBase64Url(out.join(CRLF));
}
