import { describe, it, expect } from "vitest";

// feedKey() derives from this at call-time, so set a deterministic secret first.
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-feed-secret-aaaaaaaaaaaaaaaaaaaaaaaa";

import { signFeedToken, verifyFeedToken } from "../lib/calendarFeed";

const UID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

describe("calendarFeed (per-user subscription token)", () => {
  it("round-trips: a signed token verifies back to its userId", () => {
    expect(verifyFeedToken(signFeedToken(UID))).toBe(UID);
  });

  it("tolerates a trailing .ics extension", () => {
    expect(verifyFeedToken(signFeedToken(UID) + ".ics")).toBe(UID);
  });

  it("rejects a tampered signature", () => {
    const tok = signFeedToken(UID);
    const last = tok.slice(-1);
    expect(verifyFeedToken(tok.slice(0, -1) + (last === "A" ? "B" : "A"))).toBeNull();
  });

  it("rejects a forged token (other userId glued to a valid sig)", () => {
    const sig = signFeedToken(UID).split(".")[1];
    expect(verifyFeedToken(`${OTHER}.${sig}`)).toBeNull();
  });

  it("rejects malformed / non-uuid tokens", () => {
    expect(verifyFeedToken("")).toBeNull();
    expect(verifyFeedToken("no-dot-here")).toBeNull();
    expect(verifyFeedToken("not-a-uuid.somesig")).toBeNull();
    expect(verifyFeedToken(".onlysig")).toBeNull();
  });
});
