import { describe, it, expect } from "vitest";
import {
  generatePartnerKey, hashPartnerKey, keyPrefixOf, extractPartnerKey,
  looksLikePartnerKey, KEY_PREFIX,
} from "@/lib/partnerKeys";

/**
 * These keys let an outside agency's system read candidate documents —
 * passports included. Everything here is the difference between "Calmaroi can
 * fetch the people we shared" and "whoever finds this string can".
 */
describe("generatePartnerKey", () => {
  it("is recognisable on sight in a log or a pasted message", () => {
    expect(generatePartnerKey().startsWith(KEY_PREFIX)).toBe(true);
  });

  it("carries 256 bits of entropy", () => {
    // 32 random bytes -> 43 base64url chars. Shorter would be guessable.
    expect(generatePartnerKey().slice(KEY_PREFIX.length)).toHaveLength(43);
  });

  it("survives a copy-paste anywhere — no +, / or = to escape", () => {
    for (let i = 0; i < 50; i++) {
      expect(generatePartnerKey().slice(KEY_PREFIX.length)).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("never repeats", () => {
    const seen = new Set(Array.from({ length: 500 }, () => generatePartnerKey()));
    expect(seen.size).toBe(500);
  });
});

describe("hashPartnerKey", () => {
  it("is a stable SHA-256 hex digest", async () => {
    // Known vector: sha256("") — proves we are hashing what we think we are.
    expect(await hashPartnerKey("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("gives the same answer every time, so lookup works", async () => {
    const k = generatePartnerKey();
    expect(await hashPartnerKey(k)).toBe(await hashPartnerKey(k));
  });

  it("does not leak the key it came from", async () => {
    const k = generatePartnerKey();
    const h = await hashPartnerKey(k);
    expect(h).not.toContain(k.slice(KEY_PREFIX.length));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("separates two keys that differ by one character", async () => {
    const a = await hashPartnerKey(`${KEY_PREFIX}${"a".repeat(43)}`);
    const b = await hashPartnerKey(`${KEY_PREFIX}${"a".repeat(42)}b`);
    expect(a).not.toBe(b);
  });
});

describe("keyPrefixOf", () => {
  it("shows enough to tell two keys apart and no more", async () => {
    const k = generatePartnerKey();
    const shown = keyPrefixOf(k);
    expect(k.startsWith(shown)).toBe(true);
    // The remaining 35 characters stay secret — that is what makes it unguessable.
    expect(k.length - shown.length).toBe(35);
  });
});

describe("extractPartnerKey", () => {
  const hdr = (o: Record<string, string>) => ({
    get: (n: string) => o[n.toLowerCase()] ?? null,
  });

  it("accepts Authorization: Bearer", () => {
    expect(extractPartnerKey(hdr({ authorization: "Bearer bv_live_abc" }))).toBe("bv_live_abc");
  });

  it("accepts X-API-Key, because we do not know their provider yet", () => {
    expect(extractPartnerKey(hdr({ "x-api-key": "bv_live_abc" }))).toBe("bv_live_abc");
  });

  it("is case-insensitive about the word Bearer", () => {
    expect(extractPartnerKey(hdr({ authorization: "bearer bv_live_abc" }))).toBe("bv_live_abc");
    expect(extractPartnerKey(hdr({ authorization: "BEARER bv_live_abc" }))).toBe("bv_live_abc");
  });

  it("returns null when there is no credential at all", () => {
    expect(extractPartnerKey(hdr({}))).toBeNull();
    expect(extractPartnerKey(hdr({ authorization: "" }))).toBeNull();
    expect(extractPartnerKey(hdr({ authorization: "Bearer" }))).toBeNull();
    expect(extractPartnerKey(hdr({ authorization: "Bearer    " }))).toBeNull();
  });

  it("does not mistake another auth scheme for a key", () => {
    expect(extractPartnerKey(hdr({ authorization: "Basic dXNlcjpwYXNz" }))).toBeNull();
  });
});

describe("looksLikePartnerKey", () => {
  it("passes a real key", () => {
    expect(looksLikePartnerKey(generatePartnerKey())).toBe(true);
  });

  it("rejects junk before it costs a database lookup", () => {
    for (const junk of [null, undefined, "", "admin", "Bearer", "bv_live_", "bv_live_short",
                        `${KEY_PREFIX}${"a".repeat(42)}`, `${KEY_PREFIX}${"a".repeat(44)}`]) {
      expect(looksLikePartnerKey(junk)).toBe(false);
    }
  });

  it("rejects a key whose body has characters ours never contain", () => {
    expect(looksLikePartnerKey(`${KEY_PREFIX}${"a".repeat(42)}+`)).toBe(false);
    expect(looksLikePartnerKey(`${KEY_PREFIX}${"a".repeat(42)}/`)).toBe(false);
  });

  it("rejects another product's key that happens to be long", () => {
    expect(looksLikePartnerKey(`sk_live_${"a".repeat(43)}`)).toBe(false);
  });
});
