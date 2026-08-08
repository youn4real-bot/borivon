import { describe, it, expect } from "vitest";
import { isB2CertificateDoc } from "@/lib/b2Journey";

/**
 * b2_stage was never written by anything. Live: all 78 candidates read
 * "not_started" while 15 had an APPROVED B2 certificate on file — so the batch
 * board and analytics (which key on b2_stage) said nobody was ready while the
 * B2 page (which counts certificates) said otherwise.
 *
 * Approving the certificate now marks B2 passed, which makes this predicate the
 * thing standing between "she passed" and "she did not".
 */
describe("isB2CertificateDoc", () => {
  it("matches the certificate in all three languages", () => {
    // All three spellings are live in the documents table simultaneously,
    // because file_type stores the label in the candidate's portal language.
    for (const label of ["B2 Sprachzertifikat", "Certificat de langue B2", "B2 Language Certificate"]) {
      expect(isB2CertificateDoc(label)).toBe(true);
    }
  });

  it("is case- and whitespace-insensitive", () => {
    expect(isB2CertificateDoc("  b2 sprachzertifikat  ")).toBe(true);
    expect(isB2CertificateDoc("B2 SPRACHZERTIFIKAT")).toBe(true);
  });

  it("does NOT match the exam registration", () => {
    // Approving an Anmeldung must never mark someone as having passed.
    expect(isB2CertificateDoc("B2 Anmeldung")).toBe(false);
    expect(isB2CertificateDoc("Inscription B2")).toBe(false);
  });

  it("does NOT match a loosely-named Sonstiges file", () => {
    expect(isB2CertificateDoc("b2 stuff")).toBe(false);
    expect(isB2CertificateDoc("photo b2 exam room")).toBe(false);
  });

  it("does NOT match another certificate that is not B2", () => {
    for (const label of ["Certificat de vaccination", "B1 Zertifikat", "Diplom", "Certificat d'exercice"]) {
      expect(isB2CertificateDoc(label)).toBe(false);
    }
  });

  it("treats a missing file type as not-a-certificate", () => {
    for (const v of [null, undefined, "", "   "]) expect(isB2CertificateDoc(v)).toBe(false);
  });

  it("requires B2 as a WORD, not a substring", () => {
    // "AB2C Zertifikat" is not a B2 certificate.
    expect(isB2CertificateDoc("AB2C Zertifikat")).toBe(false);
  });
});
