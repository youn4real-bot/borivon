import { describe, it, expect } from "vitest";
import { normalizeWaPhone, isValidWaPhone, prettyWaPhone, waMeUrl } from "@/lib/waLink";

describe("normalizeWaPhone", () => {
  it("strips spaces/plus and keeps a correct MA number", () => {
    expect(normalizeWaPhone("+212 630 298 377")).toBe("212630298377");
  });
  it("strips a leading 00 country prefix", () => {
    expect(normalizeWaPhone("00212630298377")).toBe("212630298377");
  });
  it("drops a local leading 0 kept under +212", () => {
    expect(normalizeWaPhone("+212 0630298377")).toBe("212630298377");
  });
  it("does NOT invent a missing digit (MARIAME's case stays short)", () => {
    // stored missing the leading 6 → stays 11 digits, to be flagged
    expect(normalizeWaPhone("+212 30298377")).toBe("21230298377");
  });
  it("returns empty for junk", () => {
    expect(normalizeWaPhone("")).toBe("");
    expect(normalizeWaPhone(null)).toBe("");
  });
});

describe("isValidWaPhone", () => {
  it("accepts a full MA mobile (212 + 9 digits starting 6/7)", () => {
    expect(isValidWaPhone("212630298377")).toBe(true);
    expect(isValidWaPhone("212712345678")).toBe(true);
  });
  it("rejects a MA number missing a digit (11 digits)", () => {
    expect(isValidWaPhone("21230298377")).toBe(false); // MARIAME
  });
  it("rejects a MA national not starting 6/7", () => {
    expect(isValidWaPhone("212230298377")).toBe(false);
  });
  it("accepts a loose non-MA international number", () => {
    expect(isValidWaPhone("491701234567")).toBe(true);
  });
  it("rejects empty / too short", () => {
    expect(isValidWaPhone("")).toBe(false);
    expect(isValidWaPhone("21267")).toBe(false);
  });
});

describe("prettyWaPhone + waMeUrl", () => {
  it("formats a MA number for display", () => {
    expect(prettyWaPhone("212630298377")).toBe("+212 6 30 29 83 77");
  });
  it("builds an encoded wa.me url", () => {
    const url = waMeUrl("212630298377", "Hi Aya");
    expect(url).toBe("https://wa.me/212630298377?text=Hi%20Aya");
  });
});
