import { describe, it, expect } from "vitest";
import { buildMimeBase64Url } from "@/lib/mimeBuilder";

/** Decode a base64url raw message back to the RFC-822 text. */
function decodeRaw(b64url: string): string {
  return Buffer.from(b64url.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}
/** Decode a base64 (possibly line-wrapped) body chunk to a UTF-8 string. */
function decodeB64Text(b64: string): string {
  return Buffer.from(b64.replace(/\s+/g, ""), "base64").toString("utf8");
}
/** Decode a base64 body chunk to raw bytes. */
function decodeB64Bytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64.replace(/\s+/g, ""), "base64"));
}

const base = { fromName: "Youness Taoufiq", fromEmail: "youness.taoufiq@borivon.com" };

describe("buildMimeBase64Url", () => {
  it("output is valid base64url (no +, /, or = padding)", () => {
    const raw = buildMimeBase64Url({ ...base, to: "a@b.com", subject: "Hi", text: "Hello", html: "" });
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("text-only → single text/plain base64 part that round-trips", () => {
    const raw = decodeRaw(buildMimeBase64Url({ ...base, to: "anna@x.com", subject: "Subject Line", text: "Hello Anna,\nThis is the body.", html: "" }));
    expect(raw).toContain("To: anna@x.com");
    expect(raw).toContain(`From: "Youness Taoufiq" <youness.taoufiq@borivon.com>`);
    expect(raw).toContain("Subject: Subject Line");
    expect(raw).toContain("MIME-Version: 1.0");
    expect(raw).toContain(`Content-Type: text/plain; charset="UTF-8"`);
    expect(raw).toContain("Content-Transfer-Encoding: base64");
    // body after the blank line decodes back to the text
    const body = raw.split("\r\n\r\n").slice(1).join("\r\n\r\n");
    expect(decodeB64Text(body)).toBe("Hello Anna,\nThis is the body.");
  });

  it("text + html → multipart/alternative with both parts decodable", () => {
    const raw = decodeRaw(buildMimeBase64Url({ ...base, to: "a@b.com", subject: "S", text: "PLAIN-BODY", html: "<p>HTML-BODY</p>" }));
    const m = raw.match(/multipart\/alternative; boundary="([^"]+)"/);
    expect(m).toBeTruthy();
    const boundary = m![1];
    // Leaf parts carry a charset; the preamble/header chunk (which also names the
    // multipart Content-Type) does not — count only the leaves.
    const parts = raw.split(`--${boundary}`).filter((p) => /charset="UTF-8"/.test(p));
    expect(parts.length).toBe(2);
    const textPart = parts.find((p) => p.includes("text/plain"))!;
    const htmlPart = parts.find((p) => p.includes("text/html"))!;
    expect(decodeB64Text(textPart.split("\r\n\r\n")[1])).toBe("PLAIN-BODY");
    expect(decodeB64Text(htmlPart.split("\r\n\r\n")[1])).toBe("<p>HTML-BODY</p>");
  });

  it("attachment → multipart/mixed; attachment bytes round-trip exactly", () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x10, 0x42]); // %PDF + binary
    const raw = decodeRaw(buildMimeBase64Url({ ...base, to: "a@b.com", subject: "With file", text: "see attached", html: "", attachments: [{ filename: "report.pdf", content: bytes }] }));
    const m = raw.match(/multipart\/mixed; boundary="([^"]+)"/);
    expect(m).toBeTruthy();
    const boundary = m![1];
    expect(raw).toContain(`Content-Disposition: attachment; filename="report.pdf"`);
    expect(raw).toContain("Content-Type: application/pdf");
    const attPart = raw.split(`--${boundary}`).find((p) => p.includes("attachment; filename="))!;
    const attB64 = attPart.split("\r\n\r\n")[1];
    expect(Array.from(decodeB64Bytes(attB64))).toEqual(Array.from(bytes));
  });

  it("non-ASCII subject is RFC-2047 encoded-word and decodes back", () => {
    const raw = decodeRaw(buildMimeBase64Url({ ...base, to: "a@b.com", subject: "Grüße über Anerkennung", text: "x", html: "" }));
    const sub = raw.split("\r\n").find((l) => l.startsWith("Subject:"))!;
    expect(sub).toMatch(/Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/);
    const enc = sub.match(/=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/)![1];
    expect(Buffer.from(enc, "base64").toString("utf8")).toBe("Grüße über Anerkennung");
  });

  it("non-ASCII From display name is encoded-word wrapped (no raw bytes in header)", () => {
    const raw = decodeRaw(buildMimeBase64Url({ fromName: "Müller Groß", fromEmail: "m@x.com", to: "a@b.com", subject: "S", text: "x", html: "" }));
    const from = raw.split("\r\n").find((l) => l.startsWith("From:"))!;
    expect(from).toContain("<m@x.com>");
    expect(from).toMatch(/=\?UTF-8\?B\?/);
  });

  it("threading headers (In-Reply-To / References) are included verbatim", () => {
    const raw = decodeRaw(buildMimeBase64Url({ ...base, to: "a@b.com", subject: "Re: x", text: "y", html: "", inReplyTo: "<msg-123@mail.gmail.com>", references: "<msg-100@x> <msg-123@mail.gmail.com>" }));
    expect(raw).toContain("In-Reply-To: <msg-123@mail.gmail.com>");
    expect(raw).toContain("References: <msg-100@x> <msg-123@mail.gmail.com>");
  });

  it("strips CR/LF from header values (header-injection guard)", () => {
    const raw = decodeRaw(buildMimeBase64Url({ ...base, to: "a@b.com", subject: "Hi\r\nBcc: evil@attacker.com\r\nX-Injected: 1", text: "x", html: "" }));
    // No injected Bcc/X-Injected header line should exist (we passed no bcc).
    const lines = raw.split("\r\n");
    expect(lines.some((l) => l.startsWith("Bcc:"))).toBe(false);
    expect(lines.some((l) => l.startsWith("X-Injected:"))).toBe(false);
    // The subject survives as a single folded line with CRLF collapsed to spaces.
    expect(raw).toContain("Subject: Hi Bcc: evil@attacker.com X-Injected: 1");
  });

  it("cc and bcc headers render when provided", () => {
    const raw = decodeRaw(buildMimeBase64Url({ ...base, to: "a@b.com", cc: "c@b.com", bcc: "d@b.com", subject: "S", text: "x", html: "" }));
    expect(raw).toContain("Cc: c@b.com");
    expect(raw).toContain("Bcc: d@b.com");
  });

  it("html-only → single text/html part", () => {
    const raw = decodeRaw(buildMimeBase64Url({ ...base, to: "a@b.com", subject: "S", text: "", html: "<b>Only HTML</b>" }));
    expect(raw).toContain(`Content-Type: text/html; charset="UTF-8"`);
    expect(raw).not.toContain("multipart");
    const body = raw.split("\r\n\r\n").slice(1).join("\r\n\r\n");
    expect(decodeB64Text(body)).toBe("<b>Only HTML</b>");
  });
});
