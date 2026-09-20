import { describe, it, expect } from "vitest";
import { isHeicUpload, sniffHeic, HEIC_CODE, HEIC_MESSAGE } from "../lib/heic";

/**
 * An iPhone photo picked out of the Files app arrives as image/heic and both
 * allow-lists refused it as "Type non autorise" / "Only PDF or photo ... are
 * allowed" — a sentence that is false for the commonest phone on earth and
 * gives her nothing to do next.
 *
 * The decision (lib/heic.ts): refuse, but with its own code and its own
 * instruction — re-pick from Photos and iOS transcodes to JPEG by itself. These
 * pin the detection, because a HEIC that slips through the detector gets the
 * old wrong message again.
 */

/** Build the first bytes of an ISO-BMFF file: [len]["ftyp"][major][minor][compatible...] */
function ftyp(major: string, compatible: string[] = []): Uint8Array {
  const boxLen = 16 + compatible.length * 4;
  const out = new Uint8Array(Math.max(boxLen, 12) + 8);
  out[0] = (boxLen >> 24) & 0xff; out[1] = (boxLen >> 16) & 0xff;
  out[2] = (boxLen >> 8) & 0xff;  out[3] = boxLen & 0xff;
  const put = (s: string, at: number) => { for (let i = 0; i < 4; i++) out[at + i] = s.charCodeAt(i); };
  put("ftyp", 4);
  put(major, 8);
  // bytes 12-15 are the minor version; the array is already zero-filled.
  compatible.forEach((b, i) => put(b, 16 + i * 4));
  return out;
}

describe("sniffHeic — the bytes are the only signal always present", () => {
  it("recognises the brands an iPhone writes", () => {
    for (const b of ["heic", "heix", "heim", "heis", "hevc", "mif1", "msf1"]) {
      expect(sniffHeic(ftyp(b)), b).toBe(true);
    }
  });

  it("recognises HEIF hiding in the compatible-brands list", () => {
    // Samsung and some share-sheet exports put a generic major brand up front
    // and only declare heic further down the ftyp box.
    expect(sniffHeic(ftyp("mp42", ["isom", "heic"]))).toBe(true);
  });

  it("leaves the formats we actually accept alone", () => {
    expect(sniffHeic(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(false); // JPEG
    expect(sniffHeic(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]))).toBe(false); // PNG
    expect(sniffHeic(new Uint8Array(Buffer.from("%PDF-1.7 aaaa")))).toBe(false);
    expect(sniffHeic(new Uint8Array(Buffer.from("RIFF0000WEBPVP8 ")))).toBe(false);
  });

  it("does not claim an ordinary MP4 is a photo", () => {
    expect(sniffHeic(ftyp("isom", ["iso2", "avc1", "mp41"]))).toBe(false);
  });

  it("is safe on short, empty and absent input", () => {
    expect(sniffHeic(null)).toBe(false);
    expect(sniffHeic(undefined)).toBe(false);
    expect(sniffHeic(new Uint8Array(0))).toBe(false);
    expect(sniffHeic(new Uint8Array([0, 0, 0, 24, 0x66, 0x74]))).toBe(false);
  });

  it("cannot be walked off the end by a lying box length", () => {
    const b = ftyp("mp42", ["isom"]);
    b[0] = 0xff; b[1] = 0xff; b[2] = 0xff; b[3] = 0xff; // absurd length
    expect(() => sniffHeic(b)).not.toThrow();
    expect(sniffHeic(b)).toBe(false);
  });
});

describe("isHeicUpload — any one signal is enough", () => {
  it("catches the declared mime types browsers send", () => {
    for (const m of ["image/heic", "image/heif", "image/HEIC", " image/heic-sequence ", "image/x-heif"]) {
      expect(isHeicUpload(m, "photo"), m).toBe(true);
    }
  });

  it("catches the filename when the mime is missing", () => {
    // The exact shape of a Files-app pick: no usable type, just a name.
    expect(isHeicUpload("application/octet-stream", "IMG_4821.HEIC")).toBe(true);
    expect(isHeicUpload("", "passeport.heif")).toBe(true);
  });

  it("catches the bytes when neither the mime nor the name says so", () => {
    expect(isHeicUpload("application/octet-stream", "image", ftyp("heic"))).toBe(true);
    // And a HEIC mislabelled as a JPEG, which is what defeats a mime-only gate.
    expect(isHeicUpload("image/jpeg", "passport.jpg", ftyp("heic"))).toBe(true);
  });

  it("passes a genuine JPEG through untouched", () => {
    expect(isHeicUpload("image/jpeg", "passport.jpg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(false);
  });

  it("does not fire on a name that merely contains the letters", () => {
    expect(isHeicUpload("application/pdf", "heic-scan-notes.pdf")).toBe(false);
  });
});

describe("the message she is shown", () => {
  it("never says PDF only — it names HEIC and tells her what to do", () => {
    expect(HEIC_MESSAGE).toMatch(/HEIC/i);
    expect(HEIC_MESSAGE).toMatch(/camera roll|Photos/i);
    expect(HEIC_MESSAGE).not.toMatch(/PDF only|not allowed|unsupported file type/i);
  });

  it("carries a stable code for the client to translate on (LAW #19)", () => {
    expect(HEIC_CODE).toBe("HEIC_UNSUPPORTED");
  });
});

/**
 * AND THE SENTENCE HAS TO REACH HER, IN HER OWN LANGUAGE, WHEREVER THE FILE
 * CAME IN.
 *
 * The detector and HEIC_MESSAGE were only half the fix: the three SERVER
 * routes answered with their own code, and then every CLIENT surface threw
 * that answer away and showed its own generic line — "PDF or a photo (JPG,
 * PNG)", "Only a PDF or a photo (JPG, PNG, WebP) can go here", "Upload failed.
 * Please try again with a PDF or photo". Each is true and each tells someone
 * holding a perfectly good photo nothing she can act on, because the phone,
 * not she, chose the format.
 */
import { heicRefusalMessage } from "../lib/heic";
import { slotDropVerdict, slotDropRefusalMessage } from "../lib/adminPanelRules";
import { readFileSync } from "node:fs";

describe("the HEIC sentence itself (LAW #19)", () => {
  const langs = ["fr", "en", "de"] as const;

  it("exists, differs, and is not a translation stub in any of the three", () => {
    const said = langs.map(l => heicRefusalMessage(l));
    expect(new Set(said).size, "one of the three is not actually translated").toBe(3);
    for (const m of said) expect(m.trim().length).toBeGreaterThan(40);
  });

  it("names the format and gives her the way out, in every language", () => {
    for (const l of langs) {
      const m = heicRefusalMessage(l);
      expect(m, `${l} must name the format`).toMatch(/HEIC/i);
      expect(m, `${l} must point at the photo library`).toMatch(/Photos|Fotos/);
      expect(m, `${l} must name the format that works`).toMatch(/JPEG/i);
    }
  });

  it("never falls back to the sentence this replaces", () => {
    for (const l of [...langs, "xx"]) {
      expect(heicRefusalMessage(l)).not.toMatch(/PDF only|Nur PDF|uniquement/i);
    }
  });

  it("an unknown language still gets a real sentence, not an empty one", () => {
    expect(heicRefusalMessage("xx")).toBe(heicRefusalMessage("en"));
  });
});

describe("every arrival point we can reach says it", () => {
  it("the admin's drop target: its own reason, its own sentence", () => {
    const heic = { type: "image/heic", name: "IMG_0421.HEIC" };
    const v = slotDropVerdict(heic, "pdf-or-photo");
    expect(v).toEqual({ ok: false, reason: "heic" });
    for (const l of ["fr", "en", "de"] as const) {
      expect(slotDropRefusalMessage("heic", l)).toBe(heicRefusalMessage(l));
    }
  });

  it("the login-less upload link answers before Uppy can refuse it generically", () => {
    // Uppy's own allowedFileTypes rejection is a bare restriction-failure with
    // nothing to say, so the check has to come FIRST.
    const UPLOADER = readFileSync("components/DocUploader.tsx", "utf8");
    const check = UPLOADER.indexOf("isHeicUpload(file.type, file.name)");
    const addFile = UPLOADER.indexOf("uppy.addFile(");
    expect(check, "the uploader must recognise a HEIC at all").toBeGreaterThan(-1);
    expect(check, "and before handing it to Uppy").toBeLessThan(addFile);
    expect(UPLOADER).toContain("heicRefusalMessage(lang)");
  });

  it("and it reads the SERVER's answer, for a HEIC renamed .jpg", () => {
    // No name or MIME check on this side can catch that one; the server
    // sniffs the bytes and already answers with HEIC_CODE. That answer used
    // to be discarded by an error handler that ignored the response body.
    const UPLOADER = readFileSync("components/DocUploader.tsx", "utf8");
    expect(UPLOADER).toMatch(/response\?\.body[\s\S]{0,120}HEIC_CODE/);
  });

  it("the server routes still answer with the shared code, not a local string", () => {
    for (const route of [
      "app/api/portal/upload/route.ts",
      "app/api/portal/u/[token]/route.ts",
      "app/api/portal/admin/replace-passport-pdf/route.ts",
    ]) {
      const src = readFileSync(route, "utf8");
      expect(src, `${route} must use the shared code`).toContain("HEIC_CODE");
      expect(src, `${route} must use the shared message`).toContain("HEIC_MESSAGE");
    }
  });
});
