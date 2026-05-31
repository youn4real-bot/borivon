/**
 * lib/pdfjs.ts — SINGLE source of truth for loading PDFs with pdf.js.
 *
 * EVERY pdf.js consumer in the app MUST load documents through
 * `pdfLoadOptions(src)` so the critical render options can never be forgotten.
 * There is currently exactly one renderer (`components/PdfViewer.tsx`); if you
 * ever add another pdf.js viewer, do:
 *
 *     const task = pdfjsLib.getDocument(pdfLoadOptions(src));
 *
 * Why each option matters (all are FALLBACK/decoder config — they never change
 * a PDF that already renders, they only rescue ones that otherwise break):
 *
 *  • wasmUrl  — MANDATORY on pdf.js v5+. CCITTFax / JBIG2 / JPEG2000 images are
 *    decoded by a WebAssembly module; without `wasmUrl` pdf.js silently DROPS
 *    those images. Some official forms (the German "EzB" / Zusatzblatt agency
 *    forms) are built ENTIRELY from CCITTFax 1-bit image masks, so with no
 *    wasmUrl the whole page renders blank/faint. This was a real production bug.
 *  • cMapUrl + standardFontDataUrl — render NON-EMBEDDED standard/CID fonts
 *    (otherwise glyphs vanish on some scanned forms).
 *  • useSystemFonts:false — use the bundled standard fonts for consistency
 *    across machines instead of guessing a local system font.
 *  • isOffscreenCanvasSupported:false — render on the main-thread canvas; the
 *    worker OffscreenCanvas path drops glyphs/images on some browsers.
 *
 * The referenced asset folders are committed under /public/pdfjs/{wasm,cmaps,
 * standard_fonts} and copied from node_modules/pdfjs-dist on each version bump
 * (see scripts/copy-pdfjs-assets if present, otherwise copy by hand and keep
 * them in lockstep with the installed pdfjs-dist version).
 */

/** REQUIRED pdf.js `getDocument` options for this app. Pass straight in. */
export function pdfLoadOptions(src: string) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return {
    url: src,
    cMapUrl: `${origin}/pdfjs/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${origin}/pdfjs/standard_fonts/`,
    wasmUrl: `${origin}/pdfjs/wasm/`,
    useSystemFonts: false,
    isOffscreenCanvasSupported: false,
  };
}
