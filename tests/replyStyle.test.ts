import { describe, it, expect } from "vitest";
import { tightenReply } from "../lib/replyStyle";

describe("tightenReply — strip robotic openers", () => {
  it("drops 'Okay, '", () => expect(tightenReply("Okay, I've updated Ismail to waiting.")).toBe("I've updated Ismail to waiting."));
  it("drops 'Alright, '", () => expect(tightenReply("Alright, here's the email.")).toBe("here's the email."));
  it("drops 'Of course, '", () => expect(tightenReply("Of course, done.")).toBe("done."));
  it("KEEPS 'Got it' (he uses it)", () => expect(tightenReply("Got it ✅")).toBe("Got it ✅"));
  it("KEEPS a bare 'Okay.' with nothing after", () => expect(tightenReply("Okay.")).toBe("Okay."));
  it("leaves a clean answer untouched", () => expect(tightenReply("3 passports expiring soon: Lamia, Badr.")).toBe("3 passports expiring soon: Lamia, Badr."));
});

describe("tightenReply — strip trailing closers", () => {
  it("drops 'Anything else you need?'", () => expect(tightenReply("I've saved it. Anything else you need?")).toBe("I've saved it."));
  it("drops 'Let me know if…'", () => expect(tightenReply("Marked done. Let me know if you need anything.")).toBe("Marked done."));
  it("drops 'What do you need?'", () => expect(tightenReply("All set. What do you need?")).toBe("All set."));
  it("drops 'Hope this helps.'", () => expect(tightenReply("Here it is. Hope this helps.")).toBe("Here it is."));
});

describe("tightenReply — strip unsolicited model-identity preamble", () => {
  it("removes a prepended 'I'm Claude, not Gemini' before the real answer", () => {
    const out = tightenReply("The API I'm using is Claude (Anthropic), not Gemini. Here's the email to Asmae: To: x@y.com");
    expect(out.startsWith("Here's the email to Asmae")).toBe(true);
    expect(out.toLowerCase()).not.toContain("gemini");
  });
  it("KEEPS the identity when that IS the answer (he asked which model)", () => {
    expect(tightenReply("Claude (Haiku), not Gemini.")).toBe("Claude (Haiku), not Gemini.");
  });
});
