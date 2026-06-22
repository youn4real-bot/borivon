import { describe, it, expect } from "vitest";
import { classifyThreadFollowUp, type ThreadMsg } from "../lib/gmailApi";

// The follow-up engine's bug-prone core: given a thread's messages, decide which way the
// follow-up goes and WHO to chase. Pinned because the founder loses business to dropped
// follow-ups — this must be right in BOTH directions.
const ME = "youness@borivon.com";
const NOW = Date.UTC(2026, 5, 23, 12, 0, 0); // 2026-06-23 12:00 UTC, for deterministic ageDays
const D = (daysAgo: number) => NOW - daysAgo * 86_400_000;

function msg(p: Partial<ThreadMsg>): ThreadMsg {
  return { id: "m", fromEmail: "", fromName: "", to: "", subject: "", internal: 0, ...p };
}

describe("classifyThreadFollowUp — which way does the follow-up go, and who do I chase?", () => {
  it("I sent the LAST message, no reply → awaiting_them (chase THEM)", () => {
    const fu = classifyThreadFollowUp([
      msg({ id: "a", fromEmail: ME, to: "Anna <anna@klinik.de>", subject: "4 Profile", internal: D(5) }),
    ], ME, NOW);
    expect(fu).not.toBeNull();
    expect(fu!.direction).toBe("awaiting_them");
    expect(fu!.who).toBe("anna@klinik.de");
    expect(fu!.whoName).toBe("Anna");
    expect(fu!.ageDays).toBe(5);
    expect(fu!.lastMessageId).toBe("a");
  });

  it("THEY sent the LAST message, I haven't replied → i_owe (I owe THEM)", () => {
    const fu = classifyThreadFollowUp([
      msg({ id: "a", fromEmail: ME, to: "anna@klinik.de", subject: "Profile", internal: D(9) }),
      msg({ id: "b", fromEmail: "anna@klinik.de", fromName: "Anna Gombert", to: ME, subject: "Re: Profile", internal: D(2) }),
    ], ME, NOW);
    expect(fu!.direction).toBe("i_owe");
    expect(fu!.who).toBe("anna@klinik.de");
    expect(fu!.whoName).toBe("Anna Gombert");
    expect(fu!.ageDays).toBe(2);
    expect(fu!.lastMessageId).toBe("b");
  });

  it("picks the LATEST message even if input is out of order", () => {
    const fu = classifyThreadFollowUp([
      msg({ id: "newest", fromEmail: ME, to: "client@x.com", internal: D(1) }),
      msg({ id: "oldest", fromEmail: "client@x.com", to: ME, internal: D(10) }),
    ], ME, NOW);
    expect(fu!.lastMessageId).toBe("newest");
    expect(fu!.direction).toBe("awaiting_them");
    expect(fu!.who).toBe("client@x.com");
  });

  it("skips automated/no-reply counterparties (null)", () => {
    expect(classifyThreadFollowUp([
      msg({ id: "a", fromEmail: "no-reply@stripe.com", to: ME, subject: "Receipt", internal: D(1) }),
    ], ME, NOW)).toBeNull();
    expect(classifyThreadFollowUp([
      msg({ id: "a", fromEmail: "newsletter@news.com", to: ME, internal: D(1) }),
    ], ME, NOW)).toBeNull();
  });

  it("a thread where the last sender is ME but the To is also me → resolves the real other party", () => {
    const fu = classifyThreadFollowUp([
      msg({ id: "a", fromEmail: "recruiter@hosp.de", to: ME, internal: D(8) }),
      msg({ id: "b", fromEmail: ME, to: ME, subject: "fwd note to self", internal: D(3) }), // To header is me
    ], ME, NOW);
    expect(fu!.direction).toBe("awaiting_them");
    expect(fu!.who).toBe("recruiter@hosp.de"); // fell back to the real counterparty
  });

  it("empty thread → null", () => {
    expect(classifyThreadFollowUp([], ME, NOW)).toBeNull();
  });

  it("case-insensitive on MY address (Gmail returns mixed case)", () => {
    const fu = classifyThreadFollowUp([
      msg({ id: "a", fromEmail: "Youness@Borivon.com", to: "anna@klinik.de", internal: D(4) }),
    ], ME, NOW);
    expect(fu!.direction).toBe("awaiting_them"); // recognized as me despite casing
    expect(fu!.who).toBe("anna@klinik.de");
  });
});
