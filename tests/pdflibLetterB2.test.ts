/**
 * Regression coverage for the Workers letter + B2-report renderers
 * (lib/pdflib/letter.ts, lib/pdflib/b2report.ts). Pure pdf-lib — no @react-pdf /
 * JSX — so they run in the default suite. Fidelity vs the @react-pdf originals is
 * checked with the rasterizing visual harness; these assert valid output.
 */
import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { renderLetterPdf } from "@/lib/pdflib/letter";
import { renderB2ReportPdf } from "@/lib/pdflib/b2report";
import type { LetterData } from "@/components/LetterDocument";
import type { B2ReportRow } from "@/components/B2ReportDocument";

const letter: LetterData = {
  senderName: "Fatima El Amrani",
  senderStreet: "Rue El Hayat, Nr. 22",
  senderPlace: "60000, Oujda, Marokko",
  senderPhone: "+212600000000",
  senderEmail: "f@example.com",
  recipientLines: ["UKSH", "Campus Kiel", "24105 Kiel"],
  dateLine: "Oujda, den 26.03.2026",
  subject: "Betreff: Bewerbung als Pflegekraft",
  salutation: "Sehr geehrte Damen und Herren,",
  bodyParagraphs: ["mit großem Interesse bewerbe ich mich um eine Tätigkeit als Pflegekraft.", "Über ein Gespräch würde ich mich freuen."],
  closingName: "Fatima El Amrani",
};

describe("renderLetterPdf (pdf-lib / Workers path)", () => {
  it("renders a one-page employer letter", async () => {
    const bytes = await renderLetterPdf(letter);
    expect(bytes.length).toBeGreaterThan(1500);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it("renders a visa letter (centered subject + signature gap)", async () => {
    const bytes = await renderLetterPdf({ ...letter, subjectCenter: true, signSpace: true });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });
});

describe("renderB2ReportPdf (pdf-lib / Workers path)", () => {
  const rows: B2ReportRow[] = [
    { name: "A", stage: "passed", failed: false, cert: "approved", examDate: "2026-03-12", german: "Goethe B2", germanLevel: "B2" },
    { name: "B", stage: "studying", failed: false, cert: "none", examDate: null, german: "", germanLevel: null },
  ];
  it("renders a valid report", async () => {
    const bytes = await renderB2ReportPdf(rows, "26.03.2026");
    expect(bytes.length).toBeGreaterThan(1500);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });
  it("tolerates an empty roster", async () => {
    const bytes = await renderB2ReportPdf([], "26.03.2026");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });
});
