import { describe, it, expect } from "vitest";
import { canonicalDocLabel, labelForUpload, resolveFileKey } from "../lib/fileKeys";
import { translations } from "../lib/translations";

/**
 * The bug this file locks out (reported by a sub-admin, 2026-09-18):
 * uploading into the "Übersetzt" box stored the TRANSLATION under the
 * ORIGINAL's label. Every reader resolves a stored label back to a fileKey, so
 * the translation drew in the Original box, and the one-live-document-per-slot
 * pass in app/api/portal/upload/route.ts then archived the real original.
 */

const PAIRS: [string, string][] = [
  ["diploma", "diploma_de"],
  ["studyprog", "studyprog_de"],
  ["transcript", "transcript_de"],
  ["abitur", "abitur_de"],
  ["abitur_transcript", "abitur_transcript_de"],
  ["praktikum", "praktikum_de"],
  ["workcert", "workcert_de"],
  ["work_experience", "work_experience_de"],
  ["impfung", "impfung_de"],
];
const LANGS = ["fr", "en", "de"] as const;

describe("labelForUpload — the key decides the slot, never the label", () => {
  it("every catalog label resolves back to the key that owns it", () => {
    for (const [orig, trans] of PAIRS) {
      for (const lang of LANGS) {
        expect(resolveFileKey(canonicalDocLabel(orig, lang))).toBe(orig);
        expect(resolveFileKey(canonicalDocLabel(trans, lang))).toBe(trans);
      }
    }
  });

  it("a translated upload carrying the ORIGINAL's label is stored as the translation", () => {
    for (const [orig, trans] of PAIRS) {
      for (const lang of LANGS) {
        const wrong = canonicalDocLabel(orig, lang);       // what the admin panel used to send
        const stored = labelForUpload(trans, wrong);
        expect(resolveFileKey(stored)).toBe(trans);        // lands in the Übersetzt box…
        expect(resolveFileKey(stored)).not.toBe(orig);     // …and never retires the original
      }
    }
  });

  it("the mirror case — an original upload carrying the translation's label", () => {
    for (const [orig, trans] of PAIRS) {
      expect(resolveFileKey(labelForUpload(orig, canonicalDocLabel(trans, "de")))).toBe(orig);
    }
  });

  it("a label that already matches its key is left exactly as sent", () => {
    for (const [orig, trans] of PAIRS) {
      for (const lang of LANGS) {
        const sent = canonicalDocLabel(orig, lang);
        expect(labelForUpload(orig, sent)).toBe(sent);
        const sentT = canonicalDocLabel(trans, lang);
        expect(labelForUpload(trans, sentT)).toBe(sentT);
      }
    }
  });

  it("a legacy alias still counts as its own key's label", () => {
    // Rows uploaded before the LAW #35 rename carry these; rewriting them to the
    // canonical label would be harmless, but leaving them alone keeps the stored
    // history readable.
    expect(labelForUpload("transcript", "Pflegenotenblatt")).toBe("Pflegenotenblatt");
    expect(labelForUpload("transcript_de", "Pflegenotenblatt (DE)")).toBe("Pflegenotenblatt (DE)");
  });

  it("keys the catalog does not own keep whatever the page sent", () => {
    const slotId = "3f4a1b2c-1111-4222-8333-444455556666";
    expect(labelForUpload(slotId, slotId)).toBe(slotId);
    expect(labelForUpload(slotId + "_de", "Vollmacht (übersetzt)")).toBe("Vollmacht (übersetzt)");
    expect(labelForUpload("other_trans", "Sonstiges (DE)")).toBe("Sonstiges (DE)");
    expect(canonicalDocLabel("no_such_key", "de")).toBe("");
  });

  it("the passport and the CV are untouched by the rule", () => {
    for (const lang of LANGS) {
      const passport = translations[lang].pTypeID as string;
      expect(labelForUpload("id", passport)).toBe(passport);
      const cv = translations[lang].pTypeCVde as string;
      expect(labelForUpload("cv_de", cv)).toBe(cv);
    }
  });
});
