/**
 * Regression coverage for the Workers PDF path (lib/pdflib/passportData.ts).
 * Pure pdf-lib — no @react-pdf, no JSX — so it runs in the default suite and
 * guards the in-process renderer that serves the passport-data sheet on
 * Cloudflare. Fidelity vs the @react-pdf original is checked separately with the
 * rasterizing visual harness; this just asserts valid, well-formed output.
 */
import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { renderPassportDataPdf } from "@/lib/pdflib/passportData";

describe("renderPassportDataPdf (pdf-lib / Workers path)", () => {
  it("produces a valid single-page PDF, handling empty values", async () => {
    const bytes = await renderPassportDataPdf({
      groups: [
        {
          title: "Identity",
          fields: [
            { label: "Surname", value: "EL AMRANI" },
            { label: "Given names", value: "Fatima Zahra" },
            { label: "Personal number", value: "" }, // → em-dash branch
          ],
        },
      ],
    });
    expect(bytes.length).toBeGreaterThan(1000);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it("paginates defensively when content overflows a page", async () => {
    const groups = Array.from({ length: 12 }, (_, g) => ({
      title: `Group ${g + 1}`,
      fields: Array.from({ length: 8 }, (_, i) => ({ label: `Field ${i + 1}`, value: `Value ${i + 1}` })),
    }));
    const bytes = await renderPassportDataPdf({ groups });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(2);
  });

  it("tolerates empty input without throwing", async () => {
    const bytes = await renderPassportDataPdf({ groups: [] });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });
});
