import { describe, it, expect } from "vitest";
import { stripFileDeliveryNoise } from "@/lib/emailFormat";

describe("stripFileDeliveryNoise — files-only on delivery", () => {
  it("strips the exact noise from the founder's complaint", () => {
    const model = [
      "Here's the attachment Abdelhak sent in his email:",
      "- Oumha, M._2024_06_03_Defizitbescheid.pdf",
      "The link expires in 3 minutes.",
    ].join("\n");
    expect(stripFileDeliveryNoise(model)).toBe(""); // → no text bubble, just the file
  });

  it("strips 'links expire in 3 minutes' and 'Here are the attachments:' lead-ins", () => {
    expect(stripFileDeliveryNoise("Here are all the attachments I found:\nThe links expire in 3 minutes.")).toBe("");
    expect(stripFileDeliveryNoise("Here are the 3 files you asked for:")).toBe("");
  });

  it("strips redundant filename bullets (the delivered docs already show names)", () => {
    expect(stripFileDeliveryNoise("- 96744.jpg\n- 96747.jpg\n* report.pdf")).toBe("");
  });

  it("KEEPS substantive text the founder actually asked for", () => {
    const out = stripFileDeliveryNoise("Their B2 status: Hajar passed, Ismail exam on 12 July.");
    expect(out).toContain("Hajar passed");
    expect(out).toContain("Ismail exam on 12 July");
  });

  it("KEEPS a per-file SUMMARY bullet (filename followed by analysis the founder asked for)", () => {
    const out = stripFileDeliveryNoise([
      "- Hajar_CV.pdf: 5 yrs ICU, B2 passed",
      "- Omar_CV.pdf: surgical nurse, B1 in progress",
    ].join("\n"));
    expect(out).toContain("Hajar_CV.pdf: 5 yrs ICU, B2 passed");
    expect(out).toContain("Omar_CV.pdf: surgical nurse, B1 in progress");
  });

  it("still strips a bare filename bullet with a trailing size", () => {
    expect(stripFileDeliveryNoise("- hajar_lebenslauf.pdf (2.1 MB)\n- passport.jpg")).toBe("");
  });
});
