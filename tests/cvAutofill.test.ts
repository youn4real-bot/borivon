import { describe, it, expect } from "vitest";
import {
  filledBulletCount,
  clampBullet,
  normalizeBullets,
  isNursingEntry,
  entriesNeedingDuties,
  applyAutofill,
  NURSING_DUTY_DEFAULTS,
  type DraftLike,
} from "@/lib/cvAutofill";

describe("cvAutofill — pure helpers", () => {
  it("counts only non-empty bullets", () => {
    expect(filledBulletCount(undefined)).toBe(0);
    expect(filledBulletCount(["", "  ", "\n"])).toBe(0);
    expect(filledBulletCount(["a", "", "b"])).toBe(2);
  });

  it("clamps a bullet to 8 words and strips a trailing period", () => {
    expect(clampBullet("one two three four five six seven eight nine ten")).toBe(
      "one two three four five six seven eight",
    );
    expect(clampBullet("  Pflegedokumentation.  ")).toBe("Pflegedokumentation");
    expect(clampBullet("a\n\nb   c")).toBe("a b c");
  });

  it("dedupes case-insensitively and caps at 6", () => {
    expect(normalizeBullets(["Grundpflege", "grundpflege", "Behandlungspflege"])).toEqual([
      "Grundpflege",
      "Behandlungspflege",
    ]);
    expect(normalizeBullets(["a", "b", "c", "d", "e", "f", "g", "h"]).length).toBe(6);
    expect(normalizeBullets("not an array")).toEqual([]);
  });

  it("treats position 0 as nursing, and sniffs keywords elsewhere", () => {
    expect(isNursingEntry({}, 0)).toBe(true);
    expect(isNursingEntry({ title: "Krankenpflegerin" }, 1)).toBe(true);
    expect(isNursingEntry({ title: "Verkäuferin" }, 1)).toBe(false);
    expect(isNursingEntry({ title: "Assistentin" }, 2, "Intensivpflege")).toBe(true);
  });
});

describe("cvAutofill — entriesNeedingDuties", () => {
  it("includes nursing internship + titled jobs, skips gaps and already-filled", () => {
    const draft: DraftLike = {
      workEntries: [
        { title: "", taetigkeiten: [] }, // 0 — internship, nursing → needs
        { isGap: true, taetigkeiten: [] }, // gap → skip
        { title: "Krankenschwester", taetigkeiten: ["Grundpflege"] }, // already has a bullet → skip
        { title: "Kellnerin", taetigkeiten: [] }, // titled non-nursing → needs (Flash)
        { title: "", taetigkeiten: [] }, // untitled non-nursing (idx 4) → skip (no context)
      ],
    };
    expect(entriesNeedingDuties(draft)).toEqual([0, 3]);
  });
});

describe("cvAutofill — applyAutofill (empty-only merge)", () => {
  it("fills phone only when empty", () => {
    const withPhone = applyAutofill({ phone: "+212600000000", workEntries: [] }, { phone: "+212611111111" }, {});
    expect(withPhone.draft.phone).toBe("+212600000000"); // not overwritten
    const noPhone = applyAutofill({ phone: "", workEntries: [] }, { phone: "+212611111111" }, {});
    expect(noPhone.draft.phone).toBe("+212611111111");
    expect(noPhone.filled).toBe(1);
  });

  it("fills a nursing entry from the standard catalog when Flash gave nothing", () => {
    const draft: DraftLike = { workEntries: [{ title: "", taetigkeiten: [] }] };
    const { draft: out, filled } = applyAutofill(draft, {}, {});
    const bullets = out.workEntries![0].taetigkeiten!;
    expect(bullets.length).toBeGreaterThanOrEqual(3);
    expect(bullets.every((b) => NURSING_DUTY_DEFAULTS.includes(b))).toBe(true);
    expect(filled).toBe(1);
  });

  it("uses Flash-generated bullets when provided", () => {
    const draft: DraftLike = { workEntries: [{ title: "Kellnerin", taetigkeiten: [] }] };
    const { draft: out } = applyAutofill(draft, {}, { 0: ["Kundenbetreuung", "Kassenführung", "Bestellannahme"] });
    expect(out.workEntries![0].taetigkeiten).toEqual(["Kundenbetreuung", "Kassenführung", "Bestellannahme"]);
  });

  it("never overwrites bullets the admin already wrote", () => {
    const draft: DraftLike = { workEntries: [{ title: "", taetigkeiten: ["Meine eigene Aufgabe"] }] };
    const { draft: out, filled } = applyAutofill(draft, {}, { 0: ["etwas anderes"] });
    expect(out.workEntries![0].taetigkeiten).toEqual(["Meine eigene Aufgabe"]);
    expect(filled).toBe(0);
  });

  it("does NOT fill a non-nursing job when Flash gave nothing (no facts invented)", () => {
    const draft: DraftLike = { workEntries: [{ title: "", taetigkeiten: [] }, { title: "Kellnerin", taetigkeiten: [] }] };
    const { draft: out } = applyAutofill(draft, {}, {});
    expect(out.workEntries![1].taetigkeiten).toEqual([]); // untouched
    expect(out.workEntries![0].taetigkeiten!.length).toBeGreaterThanOrEqual(3); // nursing default still applied
  });

  it("does not mutate the input draft", () => {
    const draft: DraftLike = { workEntries: [{ title: "", taetigkeiten: [] }] };
    applyAutofill(draft, {}, {});
    expect(draft.workEntries![0].taetigkeiten).toEqual([]); // original untouched
  });
});
