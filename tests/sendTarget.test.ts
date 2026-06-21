import { describe, it, expect } from "vitest";
import { sendTargetKey } from "../lib/assistantWrites";

// stagePending uses sendTargetKey to SUPERSEDE a re-stage to the SAME recipient (a
// correction) while keeping a send to a DIFFERENT recipient. A bug here could cancel the
// wrong pending send (real-people impact) or fail to replace a stale one — so it's pinned.
describe("sendTargetKey — recipient identity for the send-supersede", () => {
  it("keys an email recipient (lowercased)", () => {
    expect(sendTargetKey({ to: "Anna@Klinik.de" })).toBe("to:anna@klinik.de");
  });
  it("keys invite attendees order-independently (sorted, lowercased)", () => {
    expect(sendTargetKey({ attendees: "b@y.com, A@x.com" })).toBe("att:a@x.com,b@y.com");
    expect(sendTargetKey({ attendees: "A@x.com,b@y.com" })).toBe(sendTargetKey({ attendees: "b@y.com, a@x.com" }));
  });
  it("keys a candidate / message / broadcast", () => {
    expect(sendTargetKey({ candidateUserId: "ABC-123" })).toBe("cand:abc-123");
    expect(sendTargetKey({ messageId: "m1" })).toBe("msg:m1");
    expect(sendTargetKey({ by: "batch", value: "UKSH-Q3" })).toBe("bcast:batch:uksh-q3");
  });
  it("SAME recipient, different other args → SAME key (so a correction supersedes)", () => {
    expect(sendTargetKey({ to: "anna@x.com", subject: "v1" })).toBe(sendTargetKey({ to: "anna@x.com", subject: "v2" }));
  });
  it("DIFFERENT recipients → DIFFERENT keys (two distinct emails are BOTH kept)", () => {
    expect(sendTargetKey({ to: "anna@x.com" })).not.toBe(sendTargetKey({ to: "bob@y.com" }));
  });
  it("no identifiable target → '' (keep all; e.g. a batch nudge)", () => {
    expect(sendTargetKey({})).toBe("");
    expect(sendTargetKey({ text: "hi" })).toBe("");
    expect(sendTargetKey(null)).toBe("");
  });
});
