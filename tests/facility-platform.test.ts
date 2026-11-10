/**
 * The facility platform (founder 2026-11-10): the gift page at the end of the Fahrplan, the place
 * finder and the free scope in the terms (the account flow: tests/facility-diy.test.ts).
 */
import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { normalizeForm, toModel, facilityLine } from "../lib/roadmap/form";
import { scoreRoadmap, type Level } from "../lib/roadmap/score";

const today = new Date("2026-11-10T10:00:00Z");

describe("the gift page", () => {
  it("is the last page, with the personal link, in every language", async () => {
    const { renderRoadmapPdf, roadmapPageCount } = await import("../lib/roadmap/pdf");
    const { pdfLinks } = await import("../lib/roadmap/hosted");
    const { PDFDocument } = await import("pdf-lib");
    for (const lang of ["de", "en", "fr"] as const) {
      const form = normalizeForm({ art: "care_home", land: "BY", bedarf: "6-10", leasing: "1-2", start: "asap" });
      const result = scoreRoadmap(toModel(form));
      const url = "https://borivon.com/einrichtung/start?id=abc&t=xyz";
      const bytes = await renderRoadmapPdf({ result, lang, form, name: "Frau Müller", facility: facilityLine(form, lang), date: today, platformUrl: url });
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBe(roadmapPageCount(result.level as Level, true, true));
      const links = await pdfLinks(bytes);
      const gift = links.filter((l) => l.url === url);
      expect(gift).toHaveLength(1);
      expect(gift[0].page).toBe(doc.getPageCount()); // on the very last page
      if (process.env.FX_PDF_OUT && lang === "de") writeFileSync(process.env.FX_PDF_OUT, bytes);
    }
  }, 120_000);

  it("is absent without a lead (the sample PDF)", async () => {
    const { renderRoadmapPdf, roadmapPageCount } = await import("../lib/roadmap/pdf");
    const form = normalizeForm({ art: "care_home", land: "BY", bedarf: "6-10", leasing: "1-2", start: "asap" });
    const result = scoreRoadmap(toModel(form));
    const { PDFDocument } = await import("pdf-lib");
    const bytes = await renderRoadmapPdf({ result, lang: "de", form, name: "", facility: "", date: today });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(roadmapPageCount(result.level as Level, true, false));
  }, 60_000);
});

describe("the place finder", () => {
  it("classifies OSM objects and skips an MP's 'Bürgerbüro'", async () => {
    const { classify } = await import("../scripts/fx-places-pack.mjs");
    expect(classify({ name: "Finanzamt Rosenheim", office: "government" })!.kind).toBe("finanzamt");
    expect(classify({ name: "Landratsamt Rosenheim", office: "government" })!.kind).toBe("auslaender");
    expect(classify({ name: "Ausländerbehörde", office: "government" })!.w).toBeLessThan(1);
    expect(classify({ name: "Bürgerbüro Lausch, Josef, MdL", office: "government" })).toBeNull();
    expect(classify({ name: "Bürgerbüro", office: "government" })!.kind).toBe("anmeldung");
    expect(classify({ name: "Rathaus", amenity: "townhall" })!.kind).toBe("anmeldung");
    expect(classify({ name: "Sparkasse Rosenheim-Bad Aibling", amenity: "bank" })!.w).toBeLessThan(1);
    expect(classify({ name: "AOK Bayern", office: "insurance" })!.kind).toBe("kasse");
    expect(classify({ name: "Dr. med. Huber", amenity: "doctors" })!.kind).toBe("arzt");
    expect(classify({ name: "Bäckerei", shop: "bakery" })).toBeNull();
    expect(classify({ name: "Landratsamt Rosenheim - Staatliches Veterinäramt", office: "government" })).toBeNull();
  });

  it("prefers the Landratsamt of her own Landkreis over a nearer one", async () => {
    const { nearest } = await import("../lib/facility/places");
    const geo = { lat: 47.85, lon: 12.12, label: "83022 Rosenheim", county: "Landkreis Rosenheim", town: "Kolbermoor" };
    const rows = [
      { kind: "auslaender", name: "Landratsamt Traunstein", lat: 47.87, lon: 12.2, w: 1, address: "" },
      { kind: "auslaender", name: "Landratsamt Rosenheim", lat: 47.86, lon: 12.25, w: 1, address: "" },
    ];
    expect(nearest(rows, geo)?.name).toBe("Landratsamt Rosenheim");
  });

  it("in a kreisfreie Stadt prefers the city's Ausländerbehörde over the Landratsamt of the same name", async () => {
    const { nearest } = await import("../lib/facility/places");
    const geo = { lat: 47.856, lon: 12.127, label: "83022 Rosenheim", county: "", town: "Rosenheim" };
    const rows = [
      { kind: "auslaender", name: "Landratsamt Rosenheim", lat: 47.851, lon: 12.121, w: 1 },
      { kind: "auslaender", name: "Stadt Rosenheim, Ausländerbehörde", lat: 47.85, lon: 12.14, w: 0.5 },
    ];
    expect(nearest(rows, geo)?.name).toBe("Stadt Rosenheim, Ausländerbehörde");
  });

  it("picks the nearest when nothing else differs", async () => {
    const { nearest } = await import("../lib/facility/places");
    const geo = { lat: 48.1, lon: 11.5, label: "", county: "", town: "" };
    const rows = [
      { kind: "bank", name: "Far", lat: 48.2, lon: 11.5, w: 1 },
      { kind: "bank", name: "Near", lat: 48.101, lon: 11.5, w: 1 },
    ];
    const p = nearest(rows, geo)!;
    expect(p.name).toBe("Near");
    expect(p.dist).toBeGreaterThan(80);
    expect(p.dist).toBeLessThan(130);
  });
});

describe("the terms", () => {
  it("state the free scope with its numbers; the marketing words never do", async () => {
    const { TERMS } = await import("../lib/facility/legal");
    const s3 = TERMS.sections.find((s) => s.h.startsWith("§ 3"))!;
    expect(s3.p[0]).toContain("bis zu 5 (fünf)");
    expect(s3.p[0]).toContain("bis zu 2 (zwei) Nutzer");
    expect(s3.p[0]).toContain("unbefristet");
    const { V } = await import("../lib/roadmap/visual");
    const { FX_T } = await import("../components/fx/i18n");
    for (const lang of ["de", "en", "fr"] as const) {
      const words = JSON.stringify([V[lang].giftH, V[lang].giftP, V[lang].giftItems, FX_T[lang].startH, FX_T[lang].startP, FX_T[lang].f1, FX_T[lang].f2, FX_T[lang].f3]);
      expect(words).not.toMatch(/\b5\b|\b2\b|fünf|zwei|unbegrenzt|unlimited|illimité/i);
    }
  });
});

