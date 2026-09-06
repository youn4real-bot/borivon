import { describe, it, expect } from "vitest";
import {
  generateAffiliateCode, looksLikeAffiliateCode,
  generateDashToken, hashDashToken, looksLikeDashToken,
} from "@/lib/affiliates";

describe("affiliate public code", () => {
  it("is the requested length and uses only the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const c = generateAffiliateCode();
      expect(c).toHaveLength(7);
      expect(c).toMatch(/^[A-Z2-9]+$/);          // no lowercase, no 0/O/1/I/L
      expect(c).not.toMatch(/[01OIL]/);
    }
  });
  it("looksLikeAffiliateCode accepts real codes, rejects junk", () => {
    expect(looksLikeAffiliateCode(generateAffiliateCode())).toBe(true);
    expect(looksLikeAffiliateCode("ABCDE")).toBe(true);
    expect(looksLikeAffiliateCode("abc123")).toBe(false); // lowercase
    expect(looksLikeAffiliateCode("AB")).toBe(false);      // too short
    expect(looksLikeAffiliateCode("A".repeat(20))).toBe(false); // too long
    expect(looksLikeAffiliateCode("../etc")).toBe(false);
    expect(looksLikeAffiliateCode(null)).toBe(false);
    expect(looksLikeAffiliateCode(123)).toBe(false);
  });
  it("is effectively unique across many draws", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(generateAffiliateCode());
    expect(seen.size).toBeGreaterThan(495); // collisions astronomically rare
  });
});

describe("affiliate private dashboard token", () => {
  it("generates a 40–64 char url-safe token", () => {
    const t = generateDashToken();
    expect(looksLikeDashToken(t)).toBe(true);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(t).not.toContain("=");
  });
  it("hash is a deterministic 64-char sha256 hex", async () => {
    const t = generateDashToken();
    const h1 = await hashDashToken(t);
    const h2 = await hashDashToken(t);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    // different token → different hash
    expect(await hashDashToken(generateDashToken())).not.toBe(h1);
  });
  it("looksLikeDashToken rejects codes and junk", () => {
    expect(looksLikeDashToken("short")).toBe(false);
    expect(looksLikeDashToken(generateAffiliateCode())).toBe(false); // 7 chars
    expect(looksLikeDashToken(null)).toBe(false);
  });
});
