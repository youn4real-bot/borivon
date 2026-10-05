import { describe, it, expect } from "vitest";
import { translateDocLabel, LABEL_TO_FILE_KEY, FILE_KEY_ALL_LABELS, resolveFileKey, canonicalDocLabel, docLabelLang, labelForUpload } from "../lib/fileKeys";
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

/**
 * A Qualification has two boxes — Original and Übersetzt — and an upload names
 * its box twice: the fileKey builds the filename, the fileType label lands in
 * documents.file_type and is what every reader resolves back into a key.
 *
 * The admin panel sent the pair's ORIGINAL label with the translation's key.
 * The translation was therefore filed in the Original box, and the retire pass
 * (which matches on the label) archived the real original: 30 live documents,
 * 3 candidates, 29 slots left with no live original at all. These lock the
 * invariant on the server side, where every upload path passes.
 */
const PAIRS: Array<[orig: string, trans: string]> = [
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

describe("canonicalDocLabel / labelForUpload", () => {
  it("gives every catalog key the label its own box displays", () => {
    for (const lang of LANGS) {
      expect(canonicalDocLabel("diploma", lang)).toBe(translations[lang].pTypeDiploma);
      expect(canonicalDocLabel("diploma_de", lang)).toBe(translations[lang].pTypeDiplomaDE);
      // and that label resolves back to the key that displayed it
      expect(resolveFileKey(canonicalDocLabel("diploma_de", lang))).toBe("diploma_de");
    }
    expect(canonicalDocLabel("11111111-2222-3333-4444-555555555555", "de")).toBe("");
    expect(canonicalDocLabel("constructor", "de")).toBe("");
    expect(canonicalDocLabel("", "de")).toBe("");
  });

  it("names the language a label is written in", () => {
    expect(docLabelLang("Diplom (DE)")).toBe("de");
    expect(docLabelLang("Nursing Diploma (German)")).toBe("en");
    expect(docLabelLang("Diplôme Infirmier (Allemand)")).toBe("fr");
    expect(docLabelLang("Arbeitsvertrag UKSH Kiel")).toBe(null);
    expect(docLabelLang(null)).toBe(null);
    expect(docLabelLang("constructor")).toBe(null);
  });

  it("files a translation under the TRANSLATED key even when sent the original's label", () => {
    for (const [orig, trans] of PAIRS) {
      for (const lang of LANGS) {
        const wrong = canonicalDocLabel(orig, lang);        // what the admin panel used to send
        const stored = labelForUpload(trans, wrong);
        expect(resolveFileKey(stored), `${lang} ${trans} sent "${wrong}"`).toBe(trans);
        // corrected in place, not translated into another language
        expect(docLabelLang(stored)).toBe(lang);
      }
    }
  });

  it("shows the translation in the Übersetzt box — the symptom that was reported", () => {
    // What the admin panel and the candidate dashboard actually run to decide
    // which box a row belongs to: FILE_KEY_ALL_LABELS[key].has(file_type).
    // Storing "Diplom" for diploma_de is why the file appeared under Original.
    for (const [orig, trans] of PAIRS) {
      for (const lang of LANGS) {
        const sent = canonicalDocLabel(orig, lang);
        // what the row used to hold: the original's label, which only the
        // Original box matches — this is the reported symptom, asserted
        expect(FILE_KEY_ALL_LABELS[trans].has(sent)).toBe(false);
        expect(FILE_KEY_ALL_LABELS[orig].has(sent)).toBe(true);
        const stored = labelForUpload(trans, sent);
        expect(FILE_KEY_ALL_LABELS[trans].has(stored), `${lang} ${trans} box shows it`).toBe(true);
        expect(FILE_KEY_ALL_LABELS[orig].has(stored), `${lang} ${orig} box must NOT`).toBe(false);
      }
    }
  });

  it("never lets the correction run the other way either", () => {
    for (const [orig, trans] of PAIRS) {
      for (const lang of LANGS) {
        const stored = labelForUpload(orig, canonicalDocLabel(trans, lang));
        expect(resolveFileKey(stored)).toBe(orig);
      }
    }
  });

  it("leaves an upload that already agrees with itself untouched", () => {
    for (const [orig, trans] of PAIRS.flatMap(p => [p, p])) {
      for (const key of [orig, trans]) {
        for (const lang of LANGS) {
          const label = canonicalDocLabel(key, lang);
          expect(labelForUpload(key, label)).toBe(label);
        }
      }
    }
    // legacy aliases still resolve to their key, so they are not "wrong"
    expect(labelForUpload("diploma", "Pflegediplom")).toBe("Pflegediplom");
    expect(labelForUpload("cv_de", "Lebenslauf (DE)")).toBe("Lebenslauf (DE)");
  });

  it("leaves the boxes whose file_type is not a catalog label alone", () => {
    // Bearbeitung / Visum wizard slot: file_type IS the slot UUID.
    const slot = "11111111-2222-3333-4444-555555555555";
    expect(labelForUpload(slot, slot)).toBe(slot);
    expect(labelForUpload("", "Diplom")).toBe("Diplom");
    expect(labelForUpload("constructor", "Diplom")).toBe("Diplom");
    expect(labelForUpload("__proto__", "Diplom")).toBe("Diplom");
  });

  it("pulls a Sonstiges upload onto a counted label, so LAW #9's cap cannot be slipped", () => {
    // The cap is counted with .in("file_type", ["Autre","Other","Sonstiges"])
    // in app/api/portal/upload/route.ts, so a row stored under a custom label
    // would be invisible to it and a candidate could hold more than five.
    // "other" is therefore corrected like any other catalog key — the per-file
    // index that keeps the five apart lives in the FILENAME, not the label.
    for (const lang of LANGS) {
      const own = canonicalDocLabel("other", lang);
      expect(labelForUpload("other", own)).toBe(own);
      expect(resolveFileKey(labelForUpload("other", "Mon document"))).toBe("other");
    }
    // Every label the cap query actually counts survives exactly as sent.
    for (const counted of ["Autre", "Other", "Sonstiges"]) {
      expect(labelForUpload("other", counted)).toBe(counted);
    }
  });

  it("stores a label that resolves to the key, for EVERY catalog key, whatever label was sent", () => {
    const keys = [...new Set(Object.values(LABEL_TO_FILE_KEY))].filter(k => k !== "other");
    for (const key of keys) {
      for (const lang of LANGS) {
        if (!canonicalDocLabel(key, lang)) continue;
        // Send each key EVERY other key's label, in every language: whatever
        // arrives, the row must end up in the box the key names.
        for (const wrongKey of keys) {
          const sent = canonicalDocLabel(wrongKey, lang);
          if (!sent) continue;
          expect(resolveFileKey(labelForUpload(key, sent)), `${key} sent ${wrongKey}'s ${lang} label`).toBe(key);
        }
      }
    }
  });
});
