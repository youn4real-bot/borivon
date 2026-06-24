/**
 * Regression coverage for the Workers CV renderer (lib/pdflib/cv.ts).
 * Pure pdf-lib — no @react-pdf / JSX — so it runs in the default suite. Fidelity
 * vs the @react-pdf original is checked with the rasterizing visual harness; this
 * asserts valid output across the branches (photo, no branding, multi-page).
 */
import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { renderCvPdf } from "@/lib/pdflib/cv";
import type { CVData } from "@/components/CVDocument";

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function baseCv(overrides: Partial<CVData> = {}): CVData {
  return {
    photo: null,
    firstName: "Fatima", lastName: "El Amrani",
    birthDate: "14.03.1996", birthPlace: "Casablanca", countryOfBirth: "Marokko",
    countryOfResidence: "Marokko", nationality: "marokkanisch", additionalNationalities: [],
    maritalStatus: "ledig", address: "Rue 12", addressNumber: "12",
    postalCode: "20000", city: "Casablanca", phone: "+212600000000", email: "f@example.com",
    workEntries: [
      { id: "w1", isGap: false, title: "Krankenpflegerin", employer: "CHU", location: "Casablanca",
        departments: ["Innere Medizin"], start: { month: "09", year: "2020" }, end: null, gapReason: "",
        taetigkeiten: ["Pflege", "Dokumentation"] },
    ],
    eduEntries: [
      { id: "e1", type: "nursing", institution: "ISPITS", location: "Casablanca",
        start: { month: "09", year: "2017" }, end: { month: "07", year: "2020" },
        degree: "Krankenpflegediplom", nursingStatus: "complete", diplomaIssued: { month: "07", year: "2020" } },
    ],
    langs: [
      { name: "Arabisch", level: "Muttersprache" },
      { name: "Deutsch", level: "B2", b2: { written: "yes", result: "full" } },
    ],
    edvSelected: ["MS Office"], edvCustomInputs: ["SAP"],
    driverLicense: "B", hobbies: "Lesen",
    ...overrides,
  };
}

describe("renderCvPdf (pdf-lib / Workers path)", () => {
  it("renders a valid PDF for a basic CV", async () => {
    const bytes = await renderCvPdf(baseCv());
    expect(bytes.length).toBeGreaterThan(2000);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("embeds a circular photo without throwing", async () => {
    const bytes = await renderCvPdf(baseCv({ photo: TINY_PNG }));
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("honors noBranding (no header/footer chrome)", async () => {
    const bytes = await renderCvPdf(baseCv(), { noBranding: true });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("paginates a dense CV across multiple pages", async () => {
    const work = Array.from({ length: 10 }, (_, i) => ({
      id: `w${i}`, isGap: false, title: `Stelle ${i}`, employer: `Klinik ${i}`, location: "Stadt",
      departments: ["Station"], start: { month: "01", year: String(2024 - i) }, end: { month: "12", year: String(2024 - i) },
      gapReason: "", taetigkeiten: ["Aufgabe A", "Aufgabe B", "Aufgabe C"],
    }));
    const bytes = await renderCvPdf(baseCv({ workEntries: work }));
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(2);
  });
});
