import { describe, it, expect } from "vitest";
import { tightenReply, humanizeWriteError, stripInviteFooterClaim } from "../lib/replyStyle";

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

describe("tightenReply — strip unsolicited next-step OFFERS", () => {
  it("drops 'Want me to also…?'", () => expect(tightenReply("Set Hajar to waiting. Want me to also email her?")).toBe("Set Hajar to waiting."));
  it("drops 'Should I…?'", () => expect(tightenReply("Done. Should I notify the org too?")).toBe("Done."));
  it("drops German 'Soll ich…?'", () => expect(tightenReply("Erledigt. Soll ich sie anschreiben?")).toBe("Erledigt."));
  it("KEEPS a genuine clarifying question (never empties it)", () => {
    expect(tightenReply("Which Hajar do you mean?")).toBe("Which Hajar do you mean?");
  });
});

describe("tightenReply — never mangles an email body (divider guard)", () => {
  it("passes the body verbatim, only tightening the info head", () => {
    const draft = "To: anna@klinik.de · Subject: CV · 📎 —\n———\nHallo Anna,\n\nanbei der Lebenslauf. Lassen Sie mich wissen, ob Sie Fragen haben.\n\nViele Grüße";
    const out = tightenReply(draft);
    // The closer-like sentence inside the BODY must survive (it's the real email).
    expect(out).toContain("Lassen Sie mich wissen, ob Sie Fragen haben.");
    expect(out).toContain("Viele Grüße");
    expect(out).toContain("\n———\n");
  });
  it("still strips an opener that's in the info head", () => {
    const draft = "Okay, here's the email.\n———\nHallo Anna,\n\nText.";
    const out = tightenReply(draft);
    expect(out.startsWith("here's the email.")).toBe(true);
  });
});

describe("stripInviteFooterClaim — kill the 'invite carries a footer' lie", () => {
  it("strips the classic lie", () => {
    const out = stripInviteFooterClaim("I've sent the invite. Please remember, the system will still append the standard Borivon email footer to the very bottom of the email.");
    expect(out.toLowerCase()).not.toContain("footer");
    expect(out).toContain("I've sent the invite.");
  });
  it("strips 'system appends signature to the calendar invitation, I can't remove it'", () => {
    const out = stripInviteFooterClaim("The system automatically appends the full Borivon signature to every calendar invitation and I cannot remove it.");
    expect(out.toLowerCase()).not.toMatch(/signature|append/);
  });
  it("LEAVES a clean invite confirmation alone", () => {
    const s = "Done — calendar invite sent to anna@klinik.de for Sun 21 Jun, 5:00 PM.";
    expect(stripInviteFooterClaim(s)).toBe(s);
  });
  it("LEAVES a normal email signature note alone (no invite word)", () => {
    const s = "Your signature & confidentiality footer are auto-added on send.";
    expect(stripInviteFooterClaim(s)).toBe(s);
  });
  // The EXACT lie found in the founder's REAL chat (2026-06-20) — pinned so it can never
  // re-surface, and so the read-path scrub that cleans historical turns is proven on it.
  it("strips the exact real-world 2026-06-20 lie", () => {
    const out = stripInviteFooterClaim("I did send a calendar invite, not a regular email. The system automatically adds a footer to all outgoing communications, including calendar invites, which is something I cannot control or remove.");
    expect(out.toLowerCase()).not.toContain("footer");
    expect(out).toContain("I did send a calendar invite, not a regular email.");
  });
});

describe("humanizeWriteError — plain lines, no codes/ids leak", () => {
  it("maps a known code", () => expect(humanizeWriteError("no_email")).toBe("that candidate has no email on file"));
  it("strips a ':<id>' suffix before mapping", () => {
    expect(humanizeWriteError("attachment_missing:6f0a-uuid")).toBe("one of the files isn't ready (e.g. no CV on file yet)");
  });
  it("falls back gracefully for an unknown code", () => {
    expect(humanizeWriteError("kaboom_42")).toBe("something didn't go through — try once more");
  });
  it("never returns an empty string for empty input", () => {
    expect(humanizeWriteError("").length).toBeGreaterThan(0);
  });
});
