import { describe, it, expect } from "vitest";
import { contentTokens, contentOverlap } from "../lib/reminderAuto";

// The auto-close precision gate: a reminder is only cleared when the founder's "done"
// message actually REFERENCES it (shares a distinctive token). This stops an incidental
// "I sent it" from silently closing an unrelated task — the founder's tasks must never
// vanish on fuzzy phrasing.
describe("contentTokens — keep distinctive words, drop generic done/action words", () => {
  it("keeps the distinctive noun, drops the action verb + fillers", () => {
    const t = contentTokens("I already paid the Mercury invoice");
    expect(t.has("mercury")).toBe(true);
    expect(t.has("invoice")).toBe(true);
    expect(t.has("paid")).toBe(false);     // generic done-verb
    expect(t.has("already")).toBe(false);  // filler
  });
  it("a bare acknowledgement has NO content tokens", () => {
    expect(contentTokens("done").size).toBe(0);
    expect(contentTokens("erledigt").size).toBe(0);
    expect(contentTokens("yeah I handled that").size).toBe(0);
  });
  it("ascii-folds accents (French)", () => {
    const t = contentTokens("j'ai envoyé le contrat à l'ambassade");
    expect(t.has("contrat")).toBe(true);
    expect(t.has("ambassade")).toBe(true);
    expect(t.has("envoye")).toBe(false); // folded 'envoyé' is a stop-verb
  });
});

describe("contentOverlap — does the message reference the reminder?", () => {
  it("MATCHES when a distinctive token is shared", () => {
    expect(contentOverlap("I already paid the Mercury invoice", "the Mercury bank thing")).toBeGreaterThan(0);
    expect(contentOverlap("booked the embassy appointment", "call the embassy about the visa")).toBeGreaterThan(0);
  });
  it("does NOT match an unrelated 'done' message (no shared distinctive token)", () => {
    expect(contentOverlap("I sent it", "renew the apartment lease")).toBe(0);
    expect(contentOverlap("I called them back", "review the diplomas")).toBe(0);
  });
  it("a bare 'done' overlaps nothing (zero content tokens)", () => {
    expect(contentOverlap("done", "call the embassy")).toBe(0);
    expect(contentOverlap("erledigt", "Mercury bank")).toBe(0);
  });
});
