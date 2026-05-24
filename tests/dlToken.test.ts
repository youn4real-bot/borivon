import { describe, it, expect, vi } from "vitest";

// secret() reads the env var at call-time, so set a deterministic key before
// importing the module under test.
process.env.DL_TOKEN_SECRET = "test-dl-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaa";

import { signDlToken, verifyDlToken } from "../lib/dlToken";

describe("dlToken (short-lived download auth)", () => {
  it("round-trips: a freshly signed token verifies to its userId", () => {
    const tok = signDlToken("user-abc");
    expect(verifyDlToken(tok)).toEqual({ userId: "user-abc" });
  });

  it("rejects a tampered payload", () => {
    const tok = signDlToken("user-abc");
    const [payload, sig] = tok.split(".");
    const forged = payload.slice(0, -2) + (payload.slice(-2) === "AA" ? "BB" : "AA");
    expect(verifyDlToken(`${forged}.${sig}`)).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const tok = signDlToken("user-abc");
    expect(verifyDlToken(tok.slice(0, -2) + "zz")).toBeNull();
  });

  it("rejects malformed tokens", () => {
    expect(verifyDlToken("")).toBeNull();
    expect(verifyDlToken("no-dot-here")).toBeNull();
    expect(verifyDlToken(".onlysig")).toBeNull();
    expect(verifyDlToken("onlypayload.")).toBeNull();
    expect(verifyDlToken(null)).toBeNull();
    expect(verifyDlToken(undefined)).toBeNull();
  });

  it("rejects an expired token", () => {
    const tok = signDlToken("user-abc", 30); // min ttl is 30s
    const future = Date.now() + 40_000;
    vi.useFakeTimers();
    vi.setSystemTime(future);
    try {
      expect(verifyDlToken(tok)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not verify under a different signing secret", () => {
    const tok = signDlToken("user-abc");
    const orig = process.env.DL_TOKEN_SECRET;
    process.env.DL_TOKEN_SECRET = "a-totally-different-secret-value-xxxxxxxx";
    try {
      expect(verifyDlToken(tok)).toBeNull();
    } finally {
      process.env.DL_TOKEN_SECRET = orig;
    }
  });
});
