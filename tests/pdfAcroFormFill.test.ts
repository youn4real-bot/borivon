import { describe, it, expect } from "vitest";
import { suggestBinding } from "../lib/pdfAcroFormFill";

// Architectural trap (CLAUDE.md): shared form keywords appear in BOTH the
// candidate (section B) and employer (section C) parts of forms like the BA
// EzB. Auto-mapping them would fill the employer's street with the candidate's
// address. They MUST stay unmapped — admin maps them once per form via the
// modal and template memory recalls the choice.
describe("suggestBinding — ambiguous keyword guard", () => {
  it("never auto-maps bare shared/ambiguous field names", () => {
    for (const name of ["strasse", "straße", "hausnummer", "plz", "ort", "telefon", "email", "e-mail", "adresse"]) {
      expect(suggestBinding(name), `"${name}" must not auto-map`).toBeNull();
    }
  });

  it("does not confuse 'telefon' (ambiguous) with 'telefax' (agency)", () => {
    expect(suggestBinding("Telefon")).toBeNull();
    expect(suggestBinding("Telefax")).toBe("agency_telefax");
  });
});

describe("suggestBinding — unambiguous candidate fields", () => {
  it("maps clear candidate identity fields", () => {
    expect(suggestBinding("Vorname")).toBe("first_name");
    expect(suggestBinding("Nachname")).toBe("last_name");
    expect(suggestBinding("Geburtsdatum")).toBe("dob");
    expect(suggestBinding("Geschlecht")).toBe("sex");
  });

  it("handles umlauts + passport wording", () => {
    expect(suggestBinding("Staatsangehörigkeit")).toBe("nationality");
    expect(suggestBinding("Reisepassnummer")).toBe("passport_no");
    expect(suggestBinding("Geburtsort")).toBe("city_of_birth");
  });

  it("strips leading numbering ('3. Vorname')", () => {
    expect(suggestBinding("3. Vorname")).toBe("first_name");
    expect(suggestBinding("12_Nachname")).toBe("last_name");
  });

  it("maps candidate-qualified compounds (the keyword survives normalization)", () => {
    expect(suggestBinding("wohnsitz_arbeitnehmer")).toBe("city_of_residence");
  });
});

describe("suggestBinding — unambiguous agency fields", () => {
  it("maps employer/company fields", () => {
    expect(suggestBinding("Firmenname")).toBe("agency_firma");
    expect(suggestBinding("Betriebsnummer")).toBe("agency_betriebsnummer");
    expect(suggestBinding("Ansprechpartner")).toBe("agency_kontaktperson");
  });
});
