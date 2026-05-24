import { describe, it, expect } from "vitest";
import { translateDocLabel, LABEL_TO_FILE_KEY } from "../lib/fileKeys";
import { translations } from "../lib/translations";

// Legacy-alias safety: when a document label is renamed, old DB rows still
// carry the OLD label. These aliases keep those uploads findable + correctly
// translated. A regression here = documents that silently "disappear" from a
// candidate's dossier. (CLAUDE.md flags this as a recurring bug class.)
describe("fileKeys label resolution", () => {
  it("passes unknown labels through unchanged (custom org/slot docs never blank)", () => {
    expect(translateDocLabel("Arbeitsvertrag UKSH Kiel", "de")).toBe("Arbeitsvertrag UKSH Kiel");
    expect(translateDocLabel("Some Custom Doc", "en")).toBe("Some Custom Doc");
  });

  it("returns empty for empty / null / undefined / whitespace", () => {
    expect(translateDocLabel(null, "en")).toBe("");
    expect(translateDocLabel(undefined, "en")).toBe("");
    expect(translateDocLabel("", "de")).toBe("");
    expect(translateDocLabel("   ", "fr")).toBe("");
  });

  it("keeps legacy German aliases findable (maps to the right fileKey)", () => {
    expect(LABEL_TO_FILE_KEY["Pflegediplom"]).toBe("diploma");
    expect(LABEL_TO_FILE_KEY["Arbeitszeugnis"]).toBe("workcert");
    expect(LABEL_TO_FILE_KEY["Sprachzertifikat"]).toBe("langcert");
    expect(LABEL_TO_FILE_KEY["Notenblatt"]).toBe("transcript");
    expect(LABEL_TO_FILE_KEY["CV (German)"]).toBe("cv_de");
  });

  it("translates a legacy alias into the viewer's language", () => {
    expect(translateDocLabel("Pflegediplom", "de")).toBe(translations.de.pTypeDiploma);
    expect(translateDocLabel("Pflegediplom", "en")).toBe(translations.en.pTypeDiploma);
    expect(translateDocLabel("Pflegediplom", "fr")).toBe(translations.fr.pTypeDiploma);
  });
});
