import { describe, it, expect, vi, afterEach } from "vitest";
import { PDFDocument } from "pdf-lib";
import { embedDataUriImage } from "../lib/pdflib/render";

/**
 * CV PHOTOS — the regression that shipped silently.
 *
 * Every candidate photo is stored as a Supabase Storage URL (measured against
 * the live database: 56 of 56 profiles). The pdf-lib port only accepted base64
 * data URIs, so the embedder returned null for every one of them and each
 * generated CV came out with no photo. Nothing threw; the CVs just lost their
 * faces, which is exactly the kind of failure nobody notices until a client
 * asks why the candidate has no picture.
 *
 * These lock BOTH shapes: the URL that real data uses, and the data URI that
 * org logos still use.
 */

// A real 1x1 JPEG (the smallest thing pdf-lib will actually decode).
const JPEG_1PX_B64 =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
  "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA" +
  "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

const jpegBytes = () => {
  const bin = atob(JPEG_1PX_B64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
};

afterEach(() => { vi.unstubAllGlobals(); });

describe("embedDataUriImage", () => {
  it("EMBEDS AN http(s) URL — the shape every real candidate photo uses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(jpegBytes(), {
      status: 200, headers: { "content-type": "image/jpeg" },
    })));
    const doc = await PDFDocument.create();
    const out = await embedDataUriImage(doc, "https://storage.example/photos/abc.jpg");
    expect(out, "a stored photo URL must embed").not.toBeNull();
    expect(out!.width).toBeGreaterThan(0);
  });

  it("still embeds a base64 data URI (org logos)", async () => {
    const doc = await PDFDocument.create();
    const out = await embedDataUriImage(doc, `data:image/jpeg;base64,${JPEG_1PX_B64}`);
    expect(out).not.toBeNull();
  });

  it("returns null — never throws — when the photo can't be had", async () => {
    const doc = await PDFDocument.create();
    for (const bad of [null, undefined, "", "not a url", "ftp://x/y.jpg", "data:image/png;base64,%%%"]) {
      expect(await embedDataUriImage(doc, bad as string | null), String(bad)).toBeNull();
    }
  });

  it("a 404 or a network failure loses the PHOTO, never the CV", async () => {
    const doc = await PDFDocument.create();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
    expect(await embedDataUriImage(doc, "https://storage.example/gone.jpg")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    expect(await embedDataUriImage(doc, "https://storage.example/down.jpg")).toBeNull();
  });

  it("refuses a response that is plainly not an image", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>login</html>", {
      status: 200, headers: { "content-type": "text/html" },
    })));
    const doc = await PDFDocument.create();
    expect(await embedDataUriImage(doc, "https://storage.example/redirected.jpg")).toBeNull();
  });

  it("accepts octet-stream, because storage often mislabels — bytes decide", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(jpegBytes(), {
      status: 200, headers: { "content-type": "application/octet-stream" },
    })));
    const doc = await PDFDocument.create();
    expect(await embedDataUriImage(doc, "https://storage.example/photo")).not.toBeNull();
  });

  it("drops anything over the size cap rather than holding it in memory", async () => {
    const huge = new Uint8Array(9 * 1024 * 1024);
    huge[0] = 0xff; huge[1] = 0xd8;                       // looks like a JPEG
    vi.stubGlobal("fetch", vi.fn(async () => new Response(huge, {
      status: 200, headers: { "content-type": "image/jpeg", "content-length": String(huge.length) },
    })));
    const doc = await PDFDocument.create();
    expect(await embedDataUriImage(doc, "https://storage.example/huge.jpg")).toBeNull();
  });
});
