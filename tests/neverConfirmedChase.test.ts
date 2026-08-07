import { describe, it, expect } from "vitest";
import { chaseMessage, waNumber, whatsappLink } from "@/lib/whatsapp";

/**
 * Eight people filled in the registration form — real names, real +212 numbers —
 * and never confirmed, so no account was ever opened and no candidate_profiles
 * row was ever written. Every list in the portal reads candidate_profiles, so
 * none of them has ever been visible anywhere.
 *
 * The giveaway is Doha Zini: two unconfirmed accounts ten minutes apart, gmail
 * then icloud, same phone number. That is not somebody losing interest, that is
 * somebody who never received the code and tried another mailbox.
 */
describe("the never-got-in chase message", () => {
  const opts = { firstName: "Doha", lang: "fr" as const };

  it("never tells her to check the email that never arrived", () => {
    // The whole failure is that the message did not reach her inbox. Sending her
    // back to look for it puts our delivery problem on her, and she already
    // tried twice.
    const msg = chaseMessage("never_confirmed", opts).toLowerCase();
    for (const wrongAdvice of ["spam", "boîte de réception", "vérifie ton e-mail", "clique sur le lien"]) {
      expect(msg).not.toContain(wrongAdvice);
    }
  });

  it("offers the channel that is demonstrably working", () => {
    expect(chaseMessage("never_confirmed", opts)).toContain("Réponds");
  });

  it("greets her by first name and signs off, like every other reason", () => {
    const msg = chaseMessage("never_confirmed", opts);
    expect(msg.startsWith("Bonjour Doha,")).toBe(true);
    expect(msg).toContain("L'équipe Borivon");
  });

  it("exists in all three languages (LAW #19)", () => {
    for (const lang of ["fr", "en", "de"] as const) {
      const msg = chaseMessage("never_confirmed", { firstName: "Hasnae", lang });
      expect(msg.length).toBeGreaterThan(80);
      expect(msg).toContain("Hasnae");
    }
  });

  it("reaches the real numbers these people registered with", () => {
    // Taken verbatim from the live auth records.
    const live: [string, string][] = [
      ["+212 722 949 515", "212722949515"],
      ["+212 654 546 861", "212654546861"],
      ["+212 760 110 476", "212760110476"],
      ["+212 623 938 037", "212623938037"],
      ["+212 715 366 649", "212715366649"],
    ];
    for (const [stored, expected] of live) expect(waNumber(stored)).toBe(expected);
  });

  it("produces no link at all when there is no number, rather than a broken one", () => {
    // Two of the eight registered without a phone; the UI must say why instead
    // of opening an empty WhatsApp chat.
    expect(whatsappLink(null, chaseMessage("never_confirmed", opts))).toBe("");
  });
});
