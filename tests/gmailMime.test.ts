import { describe, it, expect } from "vitest";
import { buildRawMessage } from "@/lib/gmailApi";

// Decode the base64url RFC-822 back to text so we can assert on real headers.
function decode(b64url: string): string {
  return Buffer.from(b64url.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

describe("buildRawMessage — native Gmail MIME (replaces the hand-rolled builder)", () => {
  it("threads a reply with the correct In-Reply-To / References / Subject", async () => {
    const raw = await buildRawMessage({
      to: "anna@klinik.de",
      subject: "Re: Bewerbung Hajar",
      text: "Hallo Anna,\n\nanbei die Unterlagen.",
      html: "<div>Hallo Anna</div>",
      fromName: "Youness Taoufiq",
      fromEmail: "youness.taoufiq@borivon.com",
      inReplyTo: "<msg-123@mail.gmail.com>",
      references: "<root-1@mail.gmail.com> <msg-123@mail.gmail.com>",
    });
    const mime = decode(raw);
    expect(mime).toContain("To: anna@klinik.de");
    expect(mime).toContain("Subject: Re: Bewerbung Hajar");
    // The threading headers Gmail needs — these are exactly what the hand-rolled
    // builder got subtly wrong. Reply must carry BOTH or the thread breaks.
    expect(mime).toContain("In-Reply-To: <msg-123@mail.gmail.com>");
    expect(mime).toContain("References: <root-1@mail.gmail.com> <msg-123@mail.gmail.com>");
    expect(mime.toLowerCase()).toContain("multipart/alternative");
    // Must be valid base64url for the Gmail API (no +, /, or = padding).
    expect(raw).not.toMatch(/[+/=]/);
  });

  it("encloses an attachment as its own MIME part (multipart/mixed)", async () => {
    const raw = await buildRawMessage({
      to: "anna@klinik.de",
      subject: "CVs",
      text: "siehe Anhang",
      html: "<p>siehe Anhang</p>",
      fromName: "Y",
      fromEmail: "y@borivon.com",
      attachments: [{ filename: "Hajar_CV.pdf", content: Buffer.from("%PDF-1.4 not-a-real-pdf") }],
    });
    const mime = decode(raw);
    expect(mime.toLowerCase()).toContain("multipart/mixed");
    expect(mime).toContain("Hajar_CV.pdf");
  });
});
