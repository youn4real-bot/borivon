import { describe, it, expect } from "vitest";
import { resolveFileKey, canonicalDocLabel, labelForUpload, FILE_KEY_ALL_LABELS } from "@/lib/fileKeys";
import { isB2CertDoc } from "@/lib/b2Journey";
import { computeChecklist } from "@/lib/candidateChecklist";

describe("the Deutsch tile's extra boxes (exam invitation, exam result)", () => {
  it("each has its own key and label in every language", () => {
    expect(canonicalDocLabel("lang_invite", "de")).toBe("Sprachprüfung Einladung");
    expect(canonicalDocLabel("lang_result", "de")).toBe("Sprachprüfung Ergebnis");
    for (const l of ["de", "en", "fr"] as const) {
      expect(resolveFileKey(canonicalDocLabel("lang_invite", l))).toBe("lang_invite");
      expect(resolveFileKey(canonicalDocLabel("lang_result", l))).toBe("lang_result");
    }
    expect(FILE_KEY_ALL_LABELS.lang_result.has("Language exam result")).toBe(true);
  });

  it("an upload under the wrong label is stored under its own key's label", () => {
    expect(labelForUpload("lang_result", "B2 Sprachzertifikat")).toBe("Sprachprüfung Ergebnis");
  });

  it("never counts as the certificate and is never required", () => {
    expect(isB2CertDoc("Sprachprüfung Ergebnis")).toBe(false);
    expect(isB2CertDoc("Sprachprüfung Einladung")).toBe(false);
    const cl = computeChecklist([{ file_type: "Sprachprüfung Ergebnis", status: "approved" }], {});
    expect(cl.items.some((i) => i.key === "lang_result")).toBe(false);
  });
});
