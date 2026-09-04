import { describe, it, expect } from "vitest";
import { generateUploadToken, hashUploadToken, looksLikeUploadToken } from "@/lib/uploadLink";

describe("uploadLink token", () => {
  it("generates a URL-safe base64url token of the expected shape", () => {
    for (let i = 0; i < 20; i++) {
      const t = generateUploadToken();
      expect(looksLikeUploadToken(t)).toBe(true);
      expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("generates unique tokens", () => {
    const set = new Set(Array.from({ length: 200 }, () => generateUploadToken()));
    expect(set.size).toBe(200);
  });

  it("hashes deterministically to 64 hex chars", async () => {
    const t = "abc123_-ABCdef";
    const h1 = await hashUploadToken(t);
    const h2 = await hashUploadToken(t);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("different tokens hash differently", async () => {
    const a = await hashUploadToken(generateUploadToken());
    const b = await hashUploadToken(generateUploadToken());
    expect(a).not.toBe(b);
  });

  it("rejects malformed tokens at the shape gate", () => {
    expect(looksLikeUploadToken("")).toBe(false);
    expect(looksLikeUploadToken(null)).toBe(false);
    expect(looksLikeUploadToken("short")).toBe(false);
    expect(looksLikeUploadToken("has spaces and stuff !!")).toBe(false);
    expect(looksLikeUploadToken("a".repeat(200))).toBe(false);
  });
});
