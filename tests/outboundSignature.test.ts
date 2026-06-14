import { describe, it, expect } from "vitest";
import { stripTrailingSignoff, OUTBOUND_SIGNATURE_TEXT } from "../lib/outboundEmail";

// The bot's outbound email appends the founder's official signature in code
// (Gmail SMTP doesn't add the saved web signature). If the model ALSO writes a
// sign-off in the body, we'd get two signatures — so stripTrailingSignoff cuts a
// trailing closing. Pinned here so the double-signature bug can't come back.

describe("stripTrailingSignoff — removes a model-written closing so the official sig isn't doubled", () => {
  it("cuts a German sign-off block", () => {
    const body = "Hallo Anna,\n\nanbei die vier Lebensläufe.\n\nMit freundlichen Grüßen,\nYouness Taoufiq";
    expect(stripTrailingSignoff(body)).toBe("Hallo Anna,\n\nanbei die vier Lebensläufe.");
  });
  it("cuts an English sign-off block", () => {
    const body = "Hi Anna,\n\nplease find the CVs attached.\n\nBest regards,\nYouness";
    expect(stripTrailingSignoff(body)).toBe("Hi Anna,\n\nplease find the CVs attached.");
  });
  it("leaves a body with no sign-off unchanged (just trims trailing space)", () => {
    const body = "Hi Anna,\n\nplease find the CVs attached.";
    expect(stripTrailingSignoff(body)).toBe(body);
  });
  it("does NOT cut into the real body when a greeting-like word appears early", () => {
    const body = "Best practices for the exam:\n\n1. study daily\n2. mock tests\n\nLet me know if that helps.";
    expect(stripTrailingSignoff(body)).toBe(body);
  });
});

describe("OUTBOUND_SIGNATURE_TEXT — the founder's exact signature is reproduced", () => {
  it("contains the name, CEO line, address and the confidentiality disclaimer", () => {
    expect(OUTBOUND_SIGNATURE_TEXT).toContain("Youness Taoufiq");
    expect(OUTBOUND_SIGNATURE_TEXT).toContain("CEO @ Borivon.com");
    expect(OUTBOUND_SIGNATURE_TEXT).toContain("77 Boulevard Mohamed Smiha");
    expect(OUTBOUND_SIGNATURE_TEXT).toContain("20080 Casablanca, Marokko");
    expect(OUTBOUND_SIGNATURE_TEXT).toContain("vertraulich");
  });
});
