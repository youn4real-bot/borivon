/**
 * Regression coverage for the Workers passport-data-sheet renderer
 * (lib/pdflib/passportSheet.ts, used by generatePassportPdf on Workers). Pure
 * pdf-lib / standard Helvetica. Critically locks the WinAnsi sanitizer so an
 * unencodable glyph in candidate data can never crash passport-sheet generation.
 */
import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { renderPassportSheetPdf, type PassportSheetGroup } from "@/lib/pdflib/passportSheet";

const groups: PassportSheetGroup[] = [
  { title: "Persönliche Daten", rows: [
    { label: "Nachname", value: "EL AMRANI", warn: false },
    { label: "Geschlecht", value: "WEIBLICH", warn: false },
  ]},
  { title: "Reisepassdaten", rows: [
    { label: "Ablaufdatum", value: "01.01.2020  ⚠ ABGELAUFEN", warn: true }, // ⚠ not WinAnsi
  ]},
];

describe("renderPassportSheetPdf (pdf-lib / Workers path)", () => {
  it("renders a valid single-page sheet", async () => {
    const bytes = await renderPassportSheetPdf({
      title: "Reisepassdaten", subtitle: "Kandidat: X · Erstellt: 24.06.2026",
      footer: "Borivon — Automatisch generiert", groups,
    });
    expect(bytes.length).toBeGreaterThan(1000);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it("never throws on non-WinAnsi characters (⚠, Arabic, CJK, emoji)", async () => {
    const bytes = await renderPassportSheetPdf({
      title: "Reisepassdaten ⚠",
      subtitle: "محمد · 日本語 · 🛂 · Erstellt: 24.06.2026",
      footer: "Borivon ⚠ — 😀",
      groups: [{ title: "X ⚠", rows: [{ label: "Name 日本", value: "محمد الأمين 🛂", warn: false }] }],
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });
});
