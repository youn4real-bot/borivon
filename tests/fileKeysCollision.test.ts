import { describe, it, expect } from "vitest";
import { FILE_KEY_LABELS, LABEL_TO_FILE_KEY, resolveFileKey } from "../lib/fileKeys";
import { translations } from "../lib/translations";

/**
 * NO TWO DOCUMENT KEYS MAY CLAIM THE SAME LABEL.
 *
 * `file_type` is a display label, not an id, and the reverse map turns it back
 * into a key. So the moment two keys list the same label, one of them loses —
 * silently, decided by declaration order.
 *
 * That happened: letter_visa listed the bare "Motivationsschreiben", which is
 * pTypeLetter, the Essentials label in all three languages. Every Essentials
 * motivation letter therefore resolved to the VISA key, which meant
 * driveMirror filed it as post-matching and it went MISSING from the dossier
 * sent to German clinics to get the nurse placed.
 *
 * These lock the whole class rather than that one pair.
 */

const LANGS = ["fr", "en", "de"] as const;

describe("document label catalog", () => {
  it("never lets two keys claim the same label", () => {
    const owners: Record<string, string[]> = {};
    for (const [key, labels] of Object.entries(FILE_KEY_LABELS)) {
      for (const label of labels as string[]) (owners[label] ??= []).push(key);
    }
    const collisions = Object.entries(owners)
      .filter(([, keys]) => keys.length > 1)
      .map(([label, keys]) => `"${label}" claimed by ${keys.join(" and ")}`);

    expect(collisions, `a stored file_type would resolve to the wrong key:\n${collisions.join("\n")}`)
      .toEqual([]);
  });

  it("round-trips every canonical label in every language back to its own key", () => {
    // The label a box DISPLAYS is the label an upload STORES, so each one has
    // to resolve back to the key that displayed it.
    const cases: Array<[string, string, string]> = [];
    for (const lang of LANGS) {
      const t = translations[lang] as unknown as Record<string, string>;
      cases.push(["letter", t.pTypeLetter, lang]);
      cases.push(["letter_visa", t.pTypeLetterVisa, lang]);
      cases.push(["cv_de", t.pTypeCVde, lang]);
      cases.push(["cv_visa", t.pTypeCVvisa, lang]);
      cases.push(["id", t.pTypeID, lang]);
      cases.push(["diploma", t.pTypeDiploma, lang]);
    }
    for (const [key, label, lang] of cases) {
      if (!label) continue;
      expect(resolveFileKey(label), `${lang}: "${label}" must resolve to ${key}`).toBe(key);
    }
  });

  it("keeps the Essentials letter and the Visum letter apart — the actual bug", () => {
    expect(resolveFileKey("Motivationsschreiben")).toBe("letter");
    expect(resolveFileKey("Motivationsschreiben Visum")).toBe("letter_visa");
    expect(resolveFileKey("Anschreiben")).toBe("letter");
    expect(resolveFileKey("Anschreiben Visum")).toBe("letter_visa");
  });

  it("still resolves the legacy aliases old rows were stored under", () => {
    // 16 live rows are "Anschreiben", 1 is "Lettre de motivation", 4 are
    // "Motivationsschreiben Visum" — measured, not assumed.
    for (const legacy of ["Lettre de motivation", "Cover letter"]) {
      expect(resolveFileKey(legacy), legacy).toBe("letter");
    }
    expect(resolveFileKey("Lebenslauf (DE)")).toBe("cv_de");
    expect(resolveFileKey("Visa CV")).toBe("cv_visa");
  });

  it("first declaration wins, so a canonical label cannot be stolen later", () => {
    for (const [label, key] of Object.entries(LABEL_TO_FILE_KEY)) {
      const firstOwner = Object.entries(FILE_KEY_LABELS)
        .find(([, labels]) => (labels as string[]).includes(label))?.[0];
      expect(key, `"${label}" should belong to its first declarer`).toBe(firstOwner);
    }
  });
});
