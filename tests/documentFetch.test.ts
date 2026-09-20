import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  sniffDocumentBody, verifyDocumentResponse, classifyOpenError,
  docFailureMessage, fetchDocumentBlob, DocumentFetchError,
  DOC_FAILURE_TEXT, SNIFF_BYTES, expectedBodyFor,
  type ResponseFacts,
} from "@/lib/documentFetch";

/**
 * AN ERROR MESSAGE IS NOT A PDF.
 *
 * Every viewer in the portal used to call `r.blob()` with no `r.ok` check, so a
 * 401, a 404, a 500 with an HTML body and a JSON `{"error":…}` all became a
 * blob: URL that was handed to pdf.js, to an <img> or to the iOS native frame
 * as though it were the document. The five shapes below are the ones seen in
 * production; each must be told apart, and each must name the layer that failed
 * rather than blaming the file.
 */

const bytes = (s: string) => new Uint8Array([...s].map(c => c.charCodeAt(0)));
const ok = (contentType: string | null): ResponseFacts => ({ ok: true, status: 200, contentType });
const bad = (status: number, contentType: string | null): ResponseFacts =>
  ({ ok: false, status, contentType });

/** A minimal but genuinely well-formed one-page PDF. */
const REAL_PDF =
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
  + "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
  + "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n"
  + "trailer<</Root 1 0 R>>\n%%EOF\n";

describe("sniffDocumentBody tells a document from a message", () => {
  it("finds %PDF- even when the file has leading junk", () => {
    expect(sniffDocumentBody(bytes(REAL_PDF))).toBe("pdf");
    // Scanners prepend whitespace and the occasional stray byte; Acrobat and
    // pdf.js both scan the first 1024 bytes, so a strict offset-0 test would
    // reject files that open everywhere else.
    expect(sniffDocumentBody(bytes("\n\n   " + REAL_PDF))).toBe("pdf");
  });

  it("a PDF truncated to its first bytes still sniffs as a PDF", () => {
    // This is the whole point of the download/parse split: the bytes ARE a PDF,
    // so the download layer must pass it and let the engine be the one to say
    // it cannot read it.
    expect(sniffDocumentBody(bytes(REAL_PDF.slice(0, 40)))).toBe("pdf");
  });

  it("names the shapes an error actually arrives in", () => {
    expect(sniffDocumentBody(bytes("<!DOCTYPE html><html><body>500</body></html>"))).toBe("markup");
    expect(sniffDocumentBody(bytes("\n  <html>x</html>"))).toBe("markup");
    expect(sniffDocumentBody(bytes('{"error":"Unauthorized"}'))).toBe("json");
    expect(sniffDocumentBody(bytes("\n\n[{\"error\":1}]"))).toBe("json");
    expect(sniffDocumentBody(bytes("Internal Server Error"))).toBe("text");
    expect(sniffDocumentBody(bytes("error code: 1015"))).toBe("text");
    expect(sniffDocumentBody(new Uint8Array(0))).toBe("empty");
    expect(sniffDocumentBody(bytes("   \n\t "))).toBe("empty");
  });

  it("skips a UTF-8 BOM before judging the first character", () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes('{"error":"x"}')]);
    expect(sniffDocumentBody(bom)).toBe("json");
  });

  it("recognises the binary formats the portal actually stores", () => {
    expect(sniffDocumentBody(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]))).toBe("image");
    expect(sniffDocumentBody(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image");
    expect(sniffDocumentBody(bytes("GIF89a"))).toBe("image");
    expect(sniffDocumentBody(bytes("BM\x00\x00"))).toBe("image");
    const webp = new Uint8Array([...bytes("RIFF"), 1, 2, 3, 4, ...bytes("WEBP")]);
    expect(sniffDocumentBody(webp)).toBe("image");
    expect(sniffDocumentBody(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe("zip");
  });

  it("an all-printable image header is not mistaken for a message", () => {
    // "GIF89a" and "RIFF…WEBP" are printable ASCII. Without the explicit magic
    // numbers they would sniff as `text` and a real photo would be refused with
    // "the server sent an error" — the exact inversion of the bug being fixed.
    expect(sniffDocumentBody(bytes("GIF89a"))).not.toBe("text");
    const webp = new Uint8Array([...bytes("RIFF"), 0x20, 0x20, 0x20, 0x20, ...bytes("WEBPVP8 ")]);
    expect(sniffDocumentBody(webp)).not.toBe("text");
  });
});

describe("verifyDocumentResponse — the five shapes seen in production", () => {
  it("401: the status is the diagnosis, and it is the download layer", () => {
    const v = verifyDocumentResponse(bad(401, "application/json"), bytes('{"error":"no"}'), "pdf");
    expect(v).toEqual({ layer: "download", detail: "HTTP 401" });
  });

  it("404: same layer, different fact to photograph", () => {
    expect(verifyDocumentResponse(bad(404, "text/html"), bytes("<html>"), "pdf"))
      .toEqual({ layer: "download", detail: "HTTP 404" });
  });

  it("500 with an HTML body is reported as a download failure, never as a bad PDF", () => {
    const v = verifyDocumentResponse(bad(500, "text/html; charset=utf-8"),
      bytes("<!DOCTYPE html><html><head><title>500</title>"), "pdf");
    expect(v?.layer).toBe("download");
    expect(v?.detail).toBe("HTTP 500");
  });

  it("200 with a JSON error body is the CONTENT layer — the status lied", () => {
    // The shape with no status to give it away: the route caught its own error
    // and answered 200. Only the body shows it, so it gets its own sentence.
    const v = verifyDocumentResponse(ok("application/json"), bytes('{"error":"Drive file missing"}'), "pdf");
    expect(v).toEqual({ layer: "content", detail: "application/json" });
  });

  it("200 with an HTML interstitial is the CONTENT layer", () => {
    const v = verifyDocumentResponse(ok("text/html; charset=utf-8"),
      bytes("<!DOCTYPE html><html>Attention Required! | Cloudflare</html>"), "pdf");
    expect(v).toEqual({ layer: "content", detail: "text/html" });
  });

  it("200 with a bare text body is the CONTENT layer", () => {
    expect(verifyDocumentResponse(ok("text/plain"), bytes("Internal Server Error"), "pdf")?.layer)
      .toBe("content");
  });

  it("a truncated PDF PASSES verification and is left to the engine", () => {
    // The download and content layers did their job; the engine is the only
    // thing that can say whether these bytes can be read. Reporting it here
    // would blame the server for a corrupt scan.
    expect(verifyDocumentResponse(ok("application/pdf"), bytes(REAL_PDF.slice(0, 40)), "pdf")).toBeNull();
  });

  it("a whole, valid PDF passes", () => {
    expect(verifyDocumentResponse(ok("application/pdf"), bytes(REAL_PDF), "pdf")).toBeNull();
  });

  it("a PDF served as octet-stream passes — the header is not the verdict", () => {
    // Drive serves stored files this way. Judging by Content-Type would refuse
    // a perfectly good document.
    expect(verifyDocumentResponse(ok("application/octet-stream"), bytes(REAL_PDF), "pdf")).toBeNull();
  });

  it("a JPEG announced as application/pdf is a PARSE failure, not a server fault", () => {
    const v = verifyDocumentResponse(ok("image/jpeg"), new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), "pdf");
    expect(v?.layer).toBe("parse");
  });

  it("200 with an empty body is a download failure, not an empty document", () => {
    expect(verifyDocumentResponse(ok("application/pdf"), new Uint8Array(0), "pdf"))
      .toEqual({ layer: "download", detail: "empty" });
  });

  it("the image path accepts photos and still refuses error pages", () => {
    expect(verifyDocumentResponse(ok("image/png"),
      new Uint8Array([0x89, 0x50, 0x4e, 0x47]), "binary")).toBeNull();
    expect(verifyDocumentResponse(ok("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
      new Uint8Array([0x50, 0x4b, 0x03, 0x04]), "binary")).toBeNull();
    // An <img> given an HTML error page shows a broken-image glyph and no text.
    expect(verifyDocumentResponse(ok("text/html"), bytes("<html>401</html>"), "binary")?.layer)
      .toBe("content");
  });

  it("expectedBodyFor picks the strict path only for .pdf", () => {
    expect(expectedBodyFor("x_pflegekraft_reisepass.pdf")).toBe("pdf");
    expect(expectedBodyFor("x.PDF")).toBe("pdf");
    expect(expectedBodyFor("x.jpg")).toBe("binary");
    expect(expectedBodyFor(null)).toBe("binary");
  });
});

describe("classifyOpenError names the layer pdf.js failed in", () => {
  it("a missing platform API is the browser, never the file", () => {
    // Promise.withResolvers below iOS 17.4, structuredClone below Safari 15.4.
    expect(classifyOpenError(new TypeError("Promise.withResolvers is not a function"))).toBe("engine");
    expect(classifyOpenError(new ReferenceError("structuredClone is not defined"))).toBe("engine");
    expect(classifyOpenError(new Error('Setting up fake worker failed: "x".'))).toBe("engine");
  });

  it("pdf.js fetching the URL itself and being refused is the download layer", () => {
    const e = new Error("Missing PDF"); e.name = "MissingPDFException";
    expect(classifyOpenError(e)).toBe("download");
    const u = new Error("Unexpected server response (500)"); u.name = "UnexpectedResponseException";
    expect(classifyOpenError(u)).toBe("download");
  });

  it("a locked scan gets its own answer", () => {
    const e = new Error("No password given"); e.name = "PasswordException";
    expect(classifyOpenError(e)).toBe("locked");
  });

  it("anything else is the file", () => {
    const e = new Error("Invalid PDF structure."); e.name = "InvalidPDFException";
    expect(classifyOpenError(e)).toBe("parse");
    expect(classifyOpenError(null)).toBe("parse");
  });
});

describe("the messages exist in all three languages (LAW #19)", () => {
  it("every layer has fr, en and de, and they differ", () => {
    for (const [layer, t] of Object.entries(DOC_FAILURE_TEXT)) {
      for (const l of ["en", "de", "fr"] as const) {
        expect(t[l]?.trim().length, `${layer}.${l} must not be blank`).toBeGreaterThan(0);
      }
      expect(new Set([t.en, t.de, t.fr]).size, `${layer} is not actually translated`).toBe(3);
    }
  });

  it("the sentence names the layer and carries the fact in brackets", () => {
    expect(docFailureMessage("download", "en", "HTTP 404")).toContain("(HTTP 404)");
    expect(docFailureMessage("download", "en", "HTTP 404")).toContain("download");
    expect(docFailureMessage("content", "de", "text/html")).toContain("Server");
    expect(docFailureMessage("parse", "fr", null)).toBe(DOC_FAILURE_TEXT.parse.fr);
    // An unknown language falls back to English rather than rendering nothing.
    expect(docFailureMessage("parse", "ar")).toBe(DOC_FAILURE_TEXT.parse.en);
  });
});

describe("fetchDocumentBlob refuses to hand an error body to a renderer", () => {
  /** A stand-in Response with just the parts the function reads. */
  function response(status: number, contentType: string | null, body: Uint8Array): Response {
    const blob = new Blob([body as unknown as BlobPart], { type: contentType ?? "" });
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? contentType : null) },
      blob: async () => blob,
    } as unknown as Response;
  }

  async function attempt(res: Response, expect_: "pdf" | "binary" = "pdf") {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => res) as typeof fetch;
    try {
      return await fetchDocumentBlob("/api/portal/file?docId=x", {}, expect_);
    } finally {
      globalThis.fetch = original;
    }
  }

  it("401 throws a download failure carrying the status", async () => {
    await expect(attempt(response(401, "application/json", bytes('{"error":"no"}'))))
      .rejects.toMatchObject({ layer: "download", detail: "HTTP 401", name: "HTTP 401" });
  });

  it("404 throws a download failure", async () => {
    await expect(attempt(response(404, "text/html", bytes("<html>"))))
      .rejects.toMatchObject({ layer: "download", detail: "HTTP 404" });
  });

  it("500 with an HTML body throws before the body is ever read", async () => {
    let bodyRead = false;
    const res = response(500, "text/html", bytes("<!DOCTYPE html>"));
    (res as unknown as { blob: () => Promise<Blob> }).blob = async () => {
      bodyRead = true; return new Blob([]);
    };
    await expect(attempt(res)).rejects.toMatchObject({ layer: "download", detail: "HTTP 500" });
    // Reading a 25 MB error page over mobile data helps nobody.
    expect(bodyRead, "an error body must not be downloaded").toBe(false);
  });

  it("200 with a JSON error body throws a content failure", async () => {
    await expect(attempt(response(200, "application/json", bytes('{"error":"gone"}'))))
      .rejects.toMatchObject({ layer: "content", detail: "application/json" });
  });

  it("a truncated PDF is handed over — the engine, not the fetch, judges it", async () => {
    const { blob } = await attempt(response(200, "application/pdf", bytes(REAL_PDF.slice(0, 40))));
    expect(blob.size).toBe(40);
  });

  it("a whole PDF is handed over", async () => {
    const { blob } = await attempt(response(200, "application/pdf", bytes(REAL_PDF)));
    expect(blob.size).toBe(REAL_PDF.length);
  });

  it("a network failure is a download failure, not a raw TypeError", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch;
    try {
      await expect(fetchDocumentBlob("/x", {}, "pdf"))
        .rejects.toMatchObject({ layer: "download", detail: "network" });
    } finally { globalThis.fetch = original; }
  });

  it("an abort is re-thrown untouched so cleanup still recognises it", async () => {
    const original = globalThis.fetch;
    const abort = new Error("aborted"); abort.name = "AbortError";
    globalThis.fetch = (async () => { throw abort; }) as typeof fetch;
    try {
      await expect(fetchDocumentBlob("/x", {}, "pdf")).rejects.toBe(abort);
    } finally { globalThis.fetch = original; }
  });

  it("the thrown error is a DocumentFetchError, so `instanceof` narrowing works", async () => {
    const err = await attempt(response(403, null, bytes("no"))).catch(e => e);
    expect(err).toBeInstanceOf(DocumentFetchError);
  });
});

describe("no viewer reads a body without checking what arrived", () => {
  /**
   * Asserted against the SOURCE: the failure paths are React state writes deep
   * inside client components, and this suite has no jsdom to mount them in. The
   * shape of the code IS the behaviour under test — the same approach
   * tests/silentFailures.test.ts and tests/iosPdfFrameSrc.test.ts take.
   *
   * Comments are blanked first (offsets preserved) because every fix here is
   * commented with the broken line it replaces, which would otherwise match.
   */
  function code(path: string): string {
    return readFileSync(path, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\r\n]/g, " "))
      .replace(/(^|[^:"'`\\])\/\/[^\r\n]*/g, (m, lead: string) => lead + " ".repeat(m.length - lead.length));
  }

  const VIEWERS = [
    "components/AdminDocPreviewModal.tsx",
    "components/PdfPageOrganizer.tsx",
    "components/PdfViewer.tsx",
  ] as const;

  it("no `.blob()` / `.arrayBuffer()` is reached without an ok check", () => {
    for (const path of VIEWERS) {
      const src = code(path);
      // The only sanctioned way to turn a response into bytes in these files is
      // fetchDocumentBlob, which checks the status AND the body.
      const raw = [...src.matchAll(/\br\s*\.\s*(blob|arrayBuffer)\s*\(|\bres\s*\.\s*(blob|arrayBuffer)\s*\(/g)]
        .map(m => m[0]);
      expect(raw, `${path} must read bytes through fetchDocumentBlob, not raw`).toEqual([]);
    }
  });

  it("every viewer that opens a document imports the guard", () => {
    for (const path of VIEWERS) {
      expect(code(path), `${path} must go through lib/documentFetch`)
        .toMatch(/from "@\/lib\/documentFetch"/);
    }
  });

  it("no viewer prints a hard-coded English-only failure line", () => {
    // "Preview not available" was the single English sentence PdfViewer showed
    // for an expired session, a 404, an old iPhone and a corrupt scan alike.
    for (const path of VIEWERS) {
      expect(code(path), `${path} must name the layer in FR/EN/DE`)
        .not.toMatch(/"Preview not available"/);
    }
  });

  it("the <img> preview reports a body it cannot decode", () => {
    // An <img> handed an HTML error page renders a broken-image glyph and says
    // nothing at all. onError is the only signal it gives, so it must reach the
    // same failure panel as every other layer.
    const src = code("components/AdminDocPreviewModal.tsx");
    expect(src).toMatch(/<img\b/);
    expect(src, "the image preview must report a decode failure")
      .toMatch(/onError=\{[^}]*setPreviewFail/);
  });

  it("SNIFF_BYTES stays big enough for a scanner's leading junk", () => {
    expect(SNIFF_BYTES).toBeGreaterThanOrEqual(1024);
  });
});
