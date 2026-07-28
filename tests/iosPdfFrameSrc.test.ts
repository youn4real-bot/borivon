import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * A BLOB URL MUST NOT BE GIVEN A QUERY STRING.
 *
 * IosPdfFrame appends a per-open cache-bust so a re-opened document re-fetches
 * (a persisted rotation has to show on reopen). That is correct for a server
 * URL and fatal for a blob: one.
 *
 * blob: URLs are opaque paths, looked up by exact string in the browser's blob
 * store. A fragment is stripped before lookup, so "#toolbar=0" is harmless —
 * but "?_v=123" changes the path itself, matches no registered entry, and the
 * iframe silently loads nothing. Nothing throws; the panel is just empty.
 *
 * This matters now because the iOS previews for generated documents (the
 * merged original+translation, the no-logo Visa CV, the Motivationsschreiben)
 * are fed blob URLs — their routes authenticate by header only, so a signed
 * URL an iframe could carry does not exist for them.
 *
 * Asserted against the SOURCE because the component is JSX built for the DOM
 * and the URL assembly is the whole behaviour under test.
 */

const SRC = readFileSync("components/IosPdfFrame.tsx", "utf8");

/** Re-implements the component's URL assembly, so the rule is executable. */
function bustedSrc(src: string, bust = 1234567890): string {
  const isBlob = src.startsWith("blob:");
  return isBlob
    ? src + "#toolbar=0&navpanes=0&scrollbar=0"
    : src + (src.includes("?") ? "&" : "?") + "_v=" + bust +
      "#toolbar=0&navpanes=0&scrollbar=0";
}

describe("IosPdfFrame src assembly", () => {
  it("the component actually branches on blob:", () => {
    expect(SRC, "the blob guard must exist in the component itself")
      .toContain('src.startsWith("blob:")');
  });

  it("leaves a blob URL's path untouched — no query, ever", () => {
    const out = bustedSrc("blob:https://www.borivon.com/9f1c-4a2e");
    expect(out).toBe("blob:https://www.borivon.com/9f1c-4a2e#toolbar=0&navpanes=0&scrollbar=0");
    expect(out, "a query would make the blob lookup fail").not.toContain("?");
    expect(out).not.toContain("_v=");
  });

  it("still cache-busts a real server URL, which is what that exists for", () => {
    const out = bustedSrc("/api/portal/file?docId=abc&dlt=xyz");
    expect(out).toContain("_v=");
    expect(out.indexOf("_v=")).toBeGreaterThan(out.indexOf("dlt=xyz"));
  });

  it("puts the hash last in both shapes — it must be the final URL segment", () => {
    for (const src of ["blob:https://x/y", "/api/portal/file?docId=abc"]) {
      const out = bustedSrc(src);
      expect(out.indexOf("#"), src).toBe(out.length - "#toolbar=0&navpanes=0&scrollbar=0".length);
      expect(out.slice(out.indexOf("#"))).toBe("#toolbar=0&navpanes=0&scrollbar=0");
    }
  });

  it("adds the bust with ? or & depending on what the URL already has", () => {
    expect(bustedSrc("/api/portal/file")).toContain("/api/portal/file?_v=");
    expect(bustedSrc("/api/portal/file?docId=a")).toContain("docId=a&_v=");
  });
});
