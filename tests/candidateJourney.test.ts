import { describe, it, expect } from "vitest";
import {
  JOURNEY_PRESETS,
  JOURNEY_OWNERS,
  PRESET_BY_KEY,
  isJourneyOwner,
  allowedOwnersFor,
  canToggle,
  journeyItemLabel,
  type JourneyOwner,
} from "../lib/candidateJourney";

describe("journey presets", () => {
  it("has unique keys, valid owners, and full i18n labels", () => {
    const keys = JOURNEY_PRESETS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length); // no dup keys (seeding identity)
    for (const p of JOURNEY_PRESETS) {
      expect(JOURNEY_OWNERS).toContain(p.owner);
      expect(p.label.en && p.label.fr && p.label.de).toBeTruthy();
    }
  });

  it("PRESET_BY_KEY resolves every preset", () => {
    for (const p of JOURNEY_PRESETS) expect(PRESET_BY_KEY[p.key]).toBe(p);
  });
});

describe("isJourneyOwner", () => {
  it("accepts only the three parties", () => {
    expect(isJourneyOwner("borivon")).toBe(true);
    expect(isJourneyOwner("organization")).toBe(true);
    expect(isJourneyOwner("candidate")).toBe(true);
    expect(isJourneyOwner("employer")).toBe(false);
    expect(isJourneyOwner("")).toBe(false);
    expect(isJourneyOwner(null)).toBe(false);
  });
});

describe("allowedOwnersFor", () => {
  it("borivon may assign to anyone", () => {
    expect(allowedOwnersFor("borivon").sort()).toEqual(["borivon", "candidate", "organization"]);
  });
  it("organization may assign to org or candidate (not borivon)", () => {
    expect(allowedOwnersFor("organization").sort()).toEqual(["candidate", "organization"]);
    expect(allowedOwnersFor("organization")).not.toContain("borivon");
  });
  it("candidate may add nothing", () => {
    expect(allowedOwnersFor("candidate")).toEqual([]);
  });
});

describe("canToggle", () => {
  it("borivon (supreme) toggles any owner's item", () => {
    for (const o of JOURNEY_OWNERS) expect(canToggle("borivon", o as JourneyOwner)).toBe(true);
  });
  it("organization toggles only organization items", () => {
    expect(canToggle("organization", "organization")).toBe(true);
    expect(canToggle("organization", "candidate")).toBe(false);
    expect(canToggle("organization", "borivon")).toBe(false);
  });
  it("candidate toggles only candidate items", () => {
    expect(canToggle("candidate", "candidate")).toBe(true);
    expect(canToggle("candidate", "organization")).toBe(false);
    expect(canToggle("candidate", "borivon")).toBe(false);
  });
});

describe("journeyItemLabel", () => {
  it("re-labels preset rows by key in the active language", () => {
    expect(journeyItemLabel({ preset_key: "arrived", text: "ignored EN" }, "de")).toBe("In Deutschland angekommen");
    expect(journeyItemLabel({ preset_key: "arrived", text: "ignored" }, "fr")).toBe("Arrivé en Allemagne");
  });
  it("falls back to stored text for custom rows", () => {
    expect(journeyItemLabel({ preset_key: null, text: "Call the embassy" }, "de")).toBe("Call the embassy");
  });
  it("unknown lang falls back to English", () => {
    expect(journeyItemLabel({ preset_key: "flight_booked", text: "x" }, "es")).toBe("Flight booked");
  });
});
