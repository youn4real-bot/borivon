import { describe, it, expect } from "vitest";
import { canonicalCountry, countryLabel, nationalityKey } from "@/lib/nationality";

describe("nationality canonicalization", () => {
  it("maps every Morocco spelling/language to MA", () => {
    for (const v of ["Maroc", "Marokko", "Morocco", "moroccan", "marocain", "marokkanisch", "marokkanische Staatsangehörigkeit"]) {
      expect(canonicalCountry(v)).toBe("MA");
    }
  });

  it("returns null for unknown / empty", () => {
    expect(canonicalCountry("Ruritania")).toBeNull();
    expect(canonicalCountry("")).toBeNull();
    expect(canonicalCountry(null)).toBeNull();
  });

  it("labels the country in each UI language", () => {
    expect(countryLabel("MA", "en")).toBe("Morocco");
    expect(countryLabel("MA", "fr")).toBe("Maroc");
    expect(countryLabel("MA", "de")).toBe("Marokko");
  });

  it("passes an unknown raw value through unchanged", () => {
    expect(countryLabel("Ruritania", "de")).toBe("Ruritania");
  });

  it("nationalityKey gives the code when known, else the trimmed raw", () => {
    expect(nationalityKey("marokkanisch")).toBe("MA");
    expect(nationalityKey("  Ruritania ")).toBe("Ruritania");
    expect(nationalityKey("")).toBeNull();
  });
});
