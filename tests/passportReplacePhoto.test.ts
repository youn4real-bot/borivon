import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { mimeForKind, detectDocKind } from "../lib/docBytes";
import {
  PASSPORT_REPLACE_MAX_BYTES,
  PASSPORT_REPLACE_KINDS,
  PASSPORT_REPLACE_REFUSAL_TEXT,
  isPassportReplaceKind,
  passportReplaceFileName,
  passportReplaceRefusalText,
} from "../lib/passportReplace";

/**
 * AN ADMIN MUST BE ABLE TO REPLACE A PHOTOGRAPHED PASSPORT.
 *
 * The candidate boxes learned to take a photograph — she has a phone, not a
 * scanner. The admin's replace path did not: its own ceiling was 10 MB and it
 * refused anything that was not a PDF, in German only ("Nur PDF."). So the day
 * a nurse photographed her passport, the one role that exists to fix a bad
 * document could not swap it: not for a clearer picture, not for the right
 * person's passport, not for anything. The picker would not even open the
 * camera.
 *
 * Widening it is only safe if four things hold, and each has a test here:
 *   • LAW #39 — the bytes are stored verbatim. No pdf-lib, no decode, no
 *     re-save, whatever format arrives.
 *   • The row is RENAMED to match the bytes. The preview picks its renderer
 *     from the extension and expectedBodyFor() refuses a body that disagrees
 *     with it, so a JPEG left on a ".pdf" name is a passport that will not
 *     open, after a replace the panel called a success.
 *   • Every byte-consumer downstream is told the real content type — Drive, R2
 *     and the doc-cache recovery copy all used to be handed "application/pdf"
 *     unconditionally, and lib/driveMirror passes R2's straight to the agency.
 *   • LAW #19 — every refusal in French, English and German.
 */

/** Read a file with comments blanked, preserving offsets, so an assertion
 *  matches CODE and not the paragraph explaining it. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\r\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\r\n]*/g, (m, lead: string) => lead + " ".repeat(m.length - lead.length));
}

const ROUTE = code("app/api/portal/admin/replace-passport-pdf/route.ts");
const UPLOAD_ROUTE = code("app/api/portal/upload/route.ts");
const ADMIN = code("app/portal/admin/page.tsx");

describe("the replace path takes exactly what the upload path takes", () => {
  it("the same four formats, PDF and the three pictures", () => {
    expect([...PASSPORT_REPLACE_KINDS].sort()).toEqual(["jpeg", "pdf", "png", "webp"]);
    // Pinned against the upload route's own passport allow-list, so the two
    // cannot drift apart again without this failing.
    const allowedId = UPLOAD_ROUTE.slice(
      UPLOAD_ROUTE.indexOf("const ALLOWED_ID = ["),
      UPLOAD_ROUTE.indexOf("]", UPLOAD_ROUTE.indexOf("const ALLOWED_ID = [")),
    );
    for (const kind of PASSPORT_REPLACE_KINDS) {
      expect(allowedId, `the upload box accepts ${kind}, so the replace must too`)
        .toContain(`"${mimeForKind(kind)}"`);
    }
  });

  it("and the same 25 MB ceiling, not a third number", () => {
    // It was 10 MB. A full-resolution photograph of a passport page clears that
    // without trying, so the picker would have offered the camera and the
    // server would have refused an ordinary picture — the widening would have
    // been half a fix, which reads as "it is broken again".
    expect(PASSPORT_REPLACE_MAX_BYTES).toBe(25 * 1024 * 1024);
    expect(UPLOAD_ROUTE, "the upload route is where this number comes from")
      .toContain("const MAX_SIZE_BYTES = 25 * 1024 * 1024");
    expect(ROUTE, "the old 10 MB ceiling must be gone, not merely unused")
      .not.toContain("10 * 1024 * 1024");
    expect(ROUTE).toContain("PASSPORT_REPLACE_MAX_BYTES");
  });

  it("judged by the bytes, never by the declared type", () => {
    // `file.type` is browser-supplied and routinely absent when the pick came
    // out of the Files app; the old check trusted it plus the extension.
    expect(ROUTE).toContain("const kind = detectDocKind(buffer)");
    expect(ROUTE).toContain("isPassportReplaceKind(kind)");
    expect(ROUTE, "the name-and-type guess must be gone")
      .not.toMatch(/fname\.endsWith\("\.pdf"\)/);
    expect(isPassportReplaceKind("pdf")).toBe(true);
    expect(isPassportReplaceKind("jpeg")).toBe(true);
    expect(isPassportReplaceKind("other"), "a DOCX or anything unrecognised is refused").toBe(false);
  });

  it("a real JPEG and a real PNG are recognised as replaceable", () => {
    // Real files, not hand-built headers: the sniff has to work on what a
    // phone and a design tool actually produce.
    expect(isPassportReplaceKind(detectDocKind(new Uint8Array(readFileSync("public/demande-example.jpg"))))).toBe(true);
    expect(isPassportReplaceKind(detectDocKind(new Uint8Array(readFileSync("public/email-logo.png"))))).toBe(true);
  });

  it("HEIC keeps its own answer instead of 'not a PDF or a photo'", () => {
    // An iPhone picked through Files hands over raw HEIC. Telling her the
    // format is wrong without naming a right one is the sentence lib/heic.ts
    // exists to delete.
    expect(ROUTE).toContain("isHeicUpload(file.type, file.name)");
    expect(ROUTE, "and again on the bytes, for a pick with neither type nor name")
      .toContain("isHeicUpload(null, null, buffer.subarray(0, 64))");
    expect(ROUTE).toContain("HEIC_CODE");
  });
});

describe("LAW #39: the passport bytes are stored, never parsed", () => {
  it("pdf-lib is nowhere in this route, whatever format arrives", () => {
    for (const token of ["pdf-lib", "PDFDocument", "safeRotatePdf", ".save("]) {
      expect(ROUTE, `${token} on a passport is the erasure LAW #39 exists to prevent`)
        .not.toContain(token);
    }
  });

  it("the old scan is archived, never deleted (LAW #33)", () => {
    expect(ROUTE, "Drive keeps the previous file, it does not lose it")
      .not.toContain("files.delete");
    expect(ROUTE).toContain("archivedCopyOf(d)");
    // The clone happens BEFORE the pointer is overwritten, and a failed clone
    // aborts rather than proceeding without the old scan.
    expect(ROUTE.indexOf("archivedCopyOf(d)")).toBeLessThan(ROUTE.indexOf("const baseUpd"));
  });

  it("LAW #37: the override persists — status, feedback and passport data are untouched", () => {
    const at = ROUTE.indexOf("const baseUpd");
    expect(at, "the update payload was not found").toBeGreaterThan(-1);
    const upd = ROUTE.slice(at, ROUTE.indexOf("\n", ROUTE.indexOf("}", at)));
    for (const column of ["status", "feedback", "passport_status"]) {
      expect(upd, `${column} in the swap would revert an approved passport`).not.toContain(column);
    }
    // The profile row holds the OCR-derived passport data. This route may read
    // it (for the Drive folder name) and must never write it — that is the
    // whole point of a scan swap as opposed to a re-upload.
    const profileUses = [...ROUTE.matchAll(/from\("candidate_profiles"\)([\s\S]{0,40})/g)];
    expect(profileUses.length, "exactly one profile lookup, for the folder name").toBe(1);
    expect(profileUses[0][1], "and it must be a read").toMatch(/^\s*\.select\(/);
    // `documents` is written twice: the archived clone, and the in-place swap
    // (which retries once without file_sha256 on an un-migrated deployment).
    const docWrites = (ROUTE.match(/from\("documents"\)\.(update|insert)\(/g) ?? []).length;
    expect(docWrites, "the archive insert plus the swap and its schema-tolerant retry").toBe(3);
  });
});

describe("the row is renamed to match the bytes", () => {
  it("a photograph swapped onto a PDF row takes the picture's extension", () => {
    // Without this the preview asks for a PDF body, gets a JPEG and reports a
    // broken document — on a replace the admin was told had succeeded.
    expect(passportReplaceFileName("hajar_pflegekraft_reisepass.pdf", "jpeg"))
      .toBe("hajar_pflegekraft_reisepass.jpg");
    expect(passportReplaceFileName("hajar_pflegekraft_reisepass.pdf", "png"))
      .toBe("hajar_pflegekraft_reisepass.png");
    expect(passportReplaceFileName("hajar_pflegekraft_reisepass.pdf", "webp"))
      .toBe("hajar_pflegekraft_reisepass.webp");
  });

  it("and a scan swapped back onto a photo row goes the other way", () => {
    expect(passportReplaceFileName("hajar_pflegekraft_reisepass.jpg", "pdf"))
      .toBe("hajar_pflegekraft_reisepass.pdf");
    expect(passportReplaceFileName("hajar_pflegekraft_reisepass.jpeg", "pdf"))
      .toBe("hajar_pflegekraft_reisepass.pdf");
    expect(passportReplaceFileName("hajar_pflegekraft_reisepass.HEIC", "pdf"))
      .toBe("hajar_pflegekraft_reisepass.pdf");
  });

  it("LAW #35: the structured stem survives, only the suffix moves", () => {
    expect(passportReplaceFileName("fatima_zahra_el_amrani_pflegekraft_reisepass.pdf", "jpeg"))
      .toBe("fatima_zahra_el_amrani_pflegekraft_reisepass.jpg");
  });

  it("a name with no recognised extension keeps every character it had", () => {
    // A legacy row may carry anything at all. Chopping at the last dot would
    // have eaten part of the name.
    expect(passportReplaceFileName("reisepass", "jpeg")).toBe("reisepass.jpg");
    expect(passportReplaceFileName("el.amrani_reisepass", "pdf")).toBe("el.amrani_reisepass.pdf");
  });

  it("and an empty name still produces something openable", () => {
    expect(passportReplaceFileName(null, "jpeg")).toBe("reisepass.jpg");
    expect(passportReplaceFileName("", "pdf")).toBe("reisepass.pdf");
    expect(passportReplaceFileName("   ", "png")).toBe("reisepass.png");
  });

  it("the route actually writes that name to the row", () => {
    expect(ROUTE).toContain("passportReplaceFileName(d.file_name, kind)");
    expect(ROUTE, "the swap must persist the new name, or the preview still asks for a PDF")
      .toMatch(/const baseUpd = \{[^}]*file_name: newName/);
  });
});

describe("every byte-consumer downstream is told what it is really getting", () => {
  it("Drive, R2 and the recovery copy all carry the real content type", () => {
    // lib/driveMirror hands R2's stored content type straight to the agency's
    // copy (`obj.contentType || "application/pdf"`), so a photo written as a
    // PDF arrives there as a file they cannot open.
    expect(ROUTE, "no write path may hardcode the type again")
      .not.toContain('"application/pdf"');
    expect((ROUTE.match(/newMime/g) ?? []).length,
      "Drive media, the R2 put and the doc-cache upload").toBeGreaterThanOrEqual(4);
    expect(ROUTE).toContain("const newMime = mimeForKind(kind)");
  });

  it("and the R2 key is built from the new name", () => {
    expect(ROUTE).toContain("candidateKey(userId, `${Date.now()}_${newName}`)");
  });
});

describe("LAW #19: every refusal in French, English and German", () => {
  it("no refusal ships in one language", () => {
    for (const [code_, t] of Object.entries(PASSPORT_REPLACE_REFUSAL_TEXT)) {
      for (const lang of ["en", "de", "fr"] as const) {
        expect(t[lang].length, `${code_}.${lang} is missing`).toBeGreaterThan(10);
      }
      expect(new Set([t.en, t.de, t.fr]).size, `${code_} repeats one language as another`).toBe(3);
    }
  });

  it("the route answers with a code, and never with the old German-only line", () => {
    for (const gone of ["Nur PDF.", "Max. 10 MB.", "Keine gültige PDF-Datei.", "Datei erforderlich."]) {
      expect(ROUTE, `"${gone}" was German-only on a panel a French sub-admin reads`)
        .not.toContain(gone);
    }
    expect(ROUTE, "and the French-only save failure went the same way")
      .not.toContain("Erreur d'enregistrement.");
    for (const kind of ["file_missing", "format", "too_large", "archive_failed", "save_failed"]) {
      expect(ROUTE, `the ${kind} refusal must carry its code`).toContain(`refuse("${kind}"`);
    }
  });

  it("and the panel shows the reader's language, not the fallback", () => {
    expect(ADMIN).toContain("passportReplaceRefusalText(j?.code, lang)");
    expect(ADMIN, "the wrapper sentence was German-only too")
      .not.toContain("PDF ersetzen fehlgeschlagen");
    expect(passportReplaceRefusalText("format", "fr")).toBe(PASSPORT_REPLACE_REFUSAL_TEXT.format.fr);
    expect(passportReplaceRefusalText("format", "de")).toBe(PASSPORT_REPLACE_REFUSAL_TEXT.format.de);
    expect(passportReplaceRefusalText("format", "en")).toBe(PASSPORT_REPLACE_REFUSAL_TEXT.format.en);
    expect(passportReplaceRefusalText("format", "ar"), "an unknown language falls back to English")
      .toBe(PASSPORT_REPLACE_REFUSAL_TEXT.format.en);
    expect(passportReplaceRefusalText("something_else", "fr"),
      "an unknown code must yield null so the caller shows the server's own sentence").toBeNull();
  });

  it("the menu no longer promises a PDF it does not require", () => {
    expect(ADMIN).toContain('"Remplacer le scan"');
    expect(ADMIN).toContain('"Scan ersetzen"');
    expect(ADMIN).toContain('"Replace scan"');
  });
});
