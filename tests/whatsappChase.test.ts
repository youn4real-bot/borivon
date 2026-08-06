import { describe, it, expect } from "vitest";
import { waNumber, chaseMessage, whatsappLink, chaseLang } from "@/lib/whatsapp";

describe("waNumber", () => {
  it("converts the stored Moroccan format wa.me needs", () => {
    expect(waNumber("+212 652 628 769")).toBe("212652628769");
    expect(waNumber("0652628769")).toBe("212652628769");
    expect(waNumber("652628769")).toBe("212652628769");
  });
  it("refuses a number too short to dial rather than opening a broken chat", () => {
    expect(waNumber("+212 6")).toBe("");
    expect(waNumber("+212 690 29")).toBe("");
    expect(waNumber("")).toBe("");
    expect(waNumber(null)).toBe("");
  });
});

describe("chaseMessage", () => {
  it("greets her by first name only", () => {
    const m = chaseMessage("passport_expired", { firstName: "IKRAM AATMAN", lang: "fr" });
    expect(m.startsWith("Bonjour IKRAM,")).toBe(true);
    expect(m).not.toContain("AATMAN,");
  });
  it("defaults to French — these are Moroccan candidates", () => {
    expect(chaseLang(null)).toBe("fr");
    expect(chaseLang("de")).toBe("de");
  });
  it("says the actual number of days, not a vague nudge", () => {
    expect(chaseMessage("passport_expiring", { firstName: "Badr", lang: "fr", days: 11 })).toContain("11 jours");
  });
  it("explains the ID-card mix-up in words a non-expert can act on", () => {
    const m = chaseMessage("id_card_not_passport", { firstName: "Hind", lang: "fr" });
    expect(m).toContain("carte nationale d'identité");
    expect(m).toContain("PASSEPORT");
  });
  it("carries the message into the wa.me link", () => {
    const link = whatsappLink("+212 652 628 769", "Bonjour Badr");
    expect(link.startsWith("https://wa.me/212652628769?text=")).toBe(true);
    expect(decodeURIComponent(link.split("text=")[1])).toBe("Bonjour Badr");
  });
  it("gives no link at all when there is no usable number", () => {
    expect(whatsappLink("+212 6", "hi")).toBe("");
  });
});
