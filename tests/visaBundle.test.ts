/** The Visa-Mappe: approved documents only, checklist order, PDFs + photos merged, unreadable files listed. */
import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { canonicalDocLabel } from "../lib/fileKeys";
import { bundleOrder, buildVisaBundle } from "../lib/visaBundle";

async function pdf(pages: number): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  for (let i = 0; i < pages; i++) d.addPage([300, 400]);
  return d.save();
}
// a 1×1 PNG
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

describe("Visa-Mappe", () => {
  const passport = canonicalDocLabel("id", "de");
  const cv = canonicalDocLabel("cv_de", "de");
  const lang = canonicalDocLabel("langcert", "de");
  const docs = [
    { id: "3", file_type: lang, status: "approved" },
    { id: "x", file_type: cv, status: "pending" },     // not approved → not in the folder
    { id: "1", file_type: passport, status: "approved" },
    { id: "9", file_type: "Sonstiges", status: "approved" },
    { id: "2", file_type: cv, status: "approved" },
  ];

  it("takes approved documents only, in checklist order, the rest at the end", () => {
    expect(bundleOrder(docs).map((d) => d.id)).toEqual(["1", "2", "3", "9"]);
  });

  it("merges PDFs and photos behind a contents page and lists what it could not read", async () => {
    const files: Record<string, Uint8Array | null> = { "1": await pdf(2), "2": PNG, "3": await pdf(1), "9": null };
    const { bytes, included, skipped } = await buildVisaBundle(docs, async (id) => files[id] ?? null, { name: "Amina E.", lang: "de" });
    const out = await PDFDocument.load(bytes);
    expect(included).toBe(3);
    expect(skipped).toEqual(["Sonstiges"]);
    expect(out.getPageCount()).toBe(1 + 2 + 1 + 1); // contents + passport (2) + CV photo + certificate
    expect(out.getTitle()).toContain("Amina E.");
  });
});
