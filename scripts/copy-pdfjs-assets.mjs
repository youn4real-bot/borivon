/**
 * Sync pdf.js runtime assets from the installed pdfjs-dist into /public/pdfjs.
 *
 * pdf.js needs three asset folders served at runtime, version-matched to the
 * installed pdfjs-dist:
 *   • wasm/           — CCITTFax / JBIG2 / JPEG2000 image decoders (MANDATORY;
 *                       without these, image-built PDFs render blank — see
 *                       lib/pdfjs.ts). Consumed via getDocument({ wasmUrl }).
 *   • cmaps/          — CID font CMaps.
 *   • standard_fonts/ — fallbacks for non-embedded standard fonts.
 *
 * Runs on `postinstall`, so a future `pdfjs-dist` upgrade automatically re-copies
 * the matching assets — they can never silently drift out of version. It is
 * deliberately NEVER-FAIL (always exits 0): the assets are also committed, so a
 * copy hiccup just keeps the committed copy and never breaks install/build.
 */
import fs from "node:fs";
import path from "node:path";

const SRC = path.join(process.cwd(), "node_modules", "pdfjs-dist");
const DST = path.join(process.cwd(), "public", "pdfjs");
const DIRS = ["wasm", "cmaps", "standard_fonts"];

try {
  if (!fs.existsSync(SRC)) {
    console.warn("[pdfjs-assets] pdfjs-dist not installed; keeping committed assets.");
  } else {
    fs.mkdirSync(DST, { recursive: true });
    for (const d of DIRS) {
      const s = path.join(SRC, d);
      const t = path.join(DST, d);
      if (!fs.existsSync(s)) { console.warn(`[pdfjs-assets] ${d} not in pdfjs-dist; skipped`); continue; }
      fs.rmSync(t, { recursive: true, force: true });
      fs.cpSync(s, t, { recursive: true });
      console.log(`[pdfjs-assets] synced public/pdfjs/${d}`);
    }
  }
} catch (e) {
  console.warn("[pdfjs-assets] copy skipped (committed assets used):", e?.message ?? e);
}
process.exit(0);
