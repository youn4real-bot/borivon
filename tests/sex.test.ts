import { describe, it, expect } from "vitest";
import { normalizeSex, isFemaleSex } from "@/lib/sex";

describe("normalizeSex — language-agnostic", () => {
  it("maps every female spelling to F", () => {
    for (const v of ["F", "f", "Female", "FEMALE", "female", "Femme", "féminin", "Féminin", "Feminin", "Femenino", "Femminile", "Weiblich", "weiblich", "W", "w", "Frau", "  female  "]) {
      expect(normalizeSex(v)).toBe("F");
    }
  });

  it("maps every male spelling to M", () => {
    for (const v of ["M", "m", "Male", "MALE", "male", "Masculin", "masculin", "Männlich", "männlich", "Maennlich", "Masculino", "Mann", "Homme", "homme", "Hombre", "H", "h", "  male  "]) {
      expect(normalizeSex(v)).toBe("M");
    }
  });

  it("returns null for blank/unknown", () => {
    for (const v of ["", "   ", null, undefined, "X", "<", "unknown", "?", "0", "9"]) {
      expect(normalizeSex(v)).toBeNull();
    }
  });

  it("supports ISO/IEC 5218 numeric (1=male, 2=female)", () => {
    expect(normalizeSex("1")).toBe("M");
    expect(normalizeSex("2")).toBe("F");
  });

  it("isFemaleSex agrees across languages", () => {
    expect(isFemaleSex("Weiblich")).toBe(true);
    expect(isFemaleSex("Femme")).toBe(true);
    expect(isFemaleSex("Female")).toBe(true);
    expect(isFemaleSex("Männlich")).toBe(false);
    expect(isFemaleSex("Homme")).toBe(false);
    expect(isFemaleSex(null)).toBe(false);
  });
});
