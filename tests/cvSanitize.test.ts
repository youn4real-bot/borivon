import { describe, it, expect } from "vitest";
import { sanitizeCvData } from "@/lib/cvSanitize";
import type { CVData } from "@/components/CVDocument";

// Minimal valid 1x1 PNG (magic bytes 89 50 4E 47) — passes validateImageDataUrl.
const PNG_1x1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=";

function base(overrides: Partial<CVData>): CVData {
  return { firstName: "A", lastName: "B", ...overrides } as CVData;
}

describe("sanitizeCvData — SSRF photo guard", () => {
  it("drops a remote http(s) photo URL (SSRF vector)", () => {
    const out = sanitizeCvData(base({ photo: "http://169.254.169.254/latest/meta-data/" }));
    expect(out.photo).toBeNull();
  });

  it("drops an https remote photo URL", () => {
    const out = sanitizeCvData(base({ photo: "https://evil.example.com/x.png" }));
    expect(out.photo).toBeNull();
  });

  it("drops an SVG data URL (script-capable)", () => {
    const out = sanitizeCvData(base({ photo: "data:image/svg+xml;base64,PHN2Zy8+" }));
    expect(out.photo).toBeNull();
  });

  it("drops junk / non-data strings", () => {
    expect(sanitizeCvData(base({ photo: "file:///etc/passwd" })).photo).toBeNull();
    expect(sanitizeCvData(base({ photo: "not-a-url" })).photo).toBeNull();
  });

  it("preserves a valid raster data: image", () => {
    const out = sanitizeCvData(base({ photo: PNG_1x1 }));
    expect(out.photo).toBe(PNG_1x1);
  });

  it("leaves a null photo null", () => {
    expect(sanitizeCvData(base({ photo: null })).photo).toBeNull();
  });
});

describe("sanitizeCvData — DoS array caps", () => {
  it("caps workEntries to 40", () => {
    const work = Array.from({ length: 500 }, (_, i) => ({ id: String(i), title: "t" })) as CVData["workEntries"];
    const out = sanitizeCvData(base({ workEntries: work }));
    expect(out.workEntries.length).toBe(40);
  });

  it("caps eduEntries to 40", () => {
    const edu = Array.from({ length: 500 }, (_, i) => ({ id: String(i) })) as CVData["eduEntries"];
    const out = sanitizeCvData(base({ eduEntries: edu }));
    expect(out.eduEntries.length).toBe(40);
  });

  it("caps nested taetigkeiten / departments to 30 per entry", () => {
    const work = [{
      id: "1", title: "t",
      taetigkeiten: Array.from({ length: 200 }, () => "x"),
      departments: Array.from({ length: 200 }, () => "y"),
    }] as unknown as CVData["workEntries"];
    const out = sanitizeCvData(base({ workEntries: work }));
    expect(out.workEntries[0].taetigkeiten!.length).toBe(30);
    expect(out.workEntries[0].departments.length).toBe(30);
  });

  it("caps langs / edv / nationalities", () => {
    const out = sanitizeCvData(base({
      langs: Array.from({ length: 100 }, () => ({ name: "x", level: "B1" })) as CVData["langs"],
      edvSelected: Array.from({ length: 100 }, () => "x"),
      edvCustomInputs: Array.from({ length: 100 }, () => "y"),
      additionalNationalities: Array.from({ length: 100 }, () => "z"),
    }));
    expect(out.langs.length).toBe(20);
    expect(out.edvSelected.length).toBe(50);
    expect(out.edvCustomInputs.length).toBe(50);
    expect(out.additionalNationalities!.length).toBe(10);
  });

  it("tolerates malformed / missing fields without throwing", () => {
    expect(() => sanitizeCvData({} as CVData)).not.toThrow();
    // arrays that aren't arrays are left untouched (no crash)
    const weird = { workEntries: "nope", eduEntries: 42 } as unknown as CVData;
    expect(() => sanitizeCvData(weird)).not.toThrow();
  });
});
