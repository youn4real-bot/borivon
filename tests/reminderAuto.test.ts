import { describe, it, expect } from "vitest";
import { contentTokens, contentOverlap, parsePingReply } from "../lib/reminderAuto";

// Replying to a reminder's ping: "done" closes it, "+1h"/"in 2h"/"tomorrow 9" snoozes it.
// Pure + deterministic so the founder can act on the exact pinged task with no fuzzy matching.
describe("parsePingReply — act on a reminder by replying to its ping", () => {
  const NOW = new Date("2026-06-18T10:00:00Z"); // 11:00 local (Casablanca, UTC+1)
  it("treats done-words as DONE (not negated)", () => {
    expect(parsePingReply("done", NOW).action).toBe("done");
    expect(parsePingReply("erledigt", NOW).action).toBe("done");
    expect(parsePingReply("✅", NOW).action).toBe("done");
    expect(parsePingReply("handled it", NOW).action).toBe("done");
  });
  it("does NOT mark done on a negation", () => {
    expect(parsePingReply("haven't done it yet", NOW).action).not.toBe("done");
    expect(parsePingReply("not done", NOW).action).not.toBe("done");
  });
  it("snoozes on +Nh / +Nm / +Nd shorthand", () => {
    const h = parsePingReply("+1h", NOW);
    expect(h.action).toBe("snooze");
    if (h.action === "snooze") expect(h.dueAt.getTime()).toBe(NOW.getTime() + 3_600_000);
    const m = parsePingReply("+30m", NOW);
    if (m.action === "snooze") expect(m.dueAt.getTime()).toBe(NOW.getTime() + 30 * 60_000);
    const d = parsePingReply("+2d", NOW);
    if (d.action === "snooze") expect(d.dueAt.getTime()).toBe(NOW.getTime() + 2 * 86_400_000);
  });
  it("snoozes on natural language (in 2h, tomorrow 9am, snooze to 5pm)", () => {
    expect(parsePingReply("in 2h", NOW).action).toBe("snooze");
    expect(parsePingReply("tomorrow 9am", NOW).action).toBe("snooze");
    expect(parsePingReply("snooze to 5pm", NOW).action).toBe("snooze"); // strips "snooze to" → "5pm" today (future)
  });
  it("returns none for an unactionable reply", () => {
    expect(parsePingReply("later maybe", NOW).action).toBe("none");
    expect(parsePingReply("", NOW).action).toBe("none");
  });
});

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
