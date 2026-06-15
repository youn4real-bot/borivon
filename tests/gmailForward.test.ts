import { describe, it, expect } from "vitest";
import { buildForwardQuote } from "@/lib/gmailApi";

describe("buildForwardQuote", () => {
  it("builds a standard forwarded-message block with the original headers + body", () => {
    const q = buildForwardQuote({
      fromName: "Abdelhak Benchir", from: "abenchiir@gmail.com",
      date: "Sat, 13 Jun 2026 13:22:00 +0000", subject: "Defizitbescheid",
      to: "youness.taoufiq@borivon.com", body: "Sehr geehrter Herr Youness, ...",
    });
    expect(q).toContain("---------- Forwarded message ----------");
    expect(q).toContain("From: Abdelhak Benchir <abenchiir@gmail.com>");
    expect(q).toContain("Subject: Defizitbescheid");
    expect(q).toContain("Sehr geehrter Herr Youness");
    // header block sits above the quoted body
    expect(q.indexOf("From:")).toBeLessThan(q.indexOf("Sehr geehrter"));
  });
});
