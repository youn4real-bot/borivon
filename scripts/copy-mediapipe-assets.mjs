/**
 * Sync the MediaPipe tasks-vision WASM runtime into /public/mediapipe/wasm.
 *
 * The live-classroom virtual-background feature (components/ClassroomRoom.tsx →
 * BackgroundControl) runs @livekit/track-processors, which segments the camera
 * frame with MediaPipe's selfie-segmenter model. MediaPipe needs two assets at
 * runtime:
 *   • wasm/                    — the tasks-vision WASM decoder (this script).
 *   • selfie_segmenter.tflite  — the segmentation model (committed under
 *                                /public/mediapipe, NOT in any npm package).
 *
 * Both are pointed at via `assetPaths` so they load same-origin and our tight
 * CSP needs no external connect-src hole (the package otherwise fetches them
 * from cdn.jsdelivr.net + storage.googleapis.com, which the CSP blocks).
 *
 * Runs on `postinstall`, mirroring scripts/copy-pdfjs-assets.mjs, so a future
 * @mediapipe/tasks-vision bump re-copies the matching WASM. The wasm is ~19MB,
 * so unlike pdfjs it is gitignored and regenerated here rather than committed.
 * DELIBERATELY NEVER-FAIL (always exits 0): a copy hiccup must never break
 * install/build — at worst the background blur is unavailable until next install.
 */
import fs from "node:fs";
import path from "node:path";

const SRC = path.join(process.cwd(), "node_modules", "@mediapipe", "tasks-vision", "wasm");
const DST = path.join(process.cwd(), "public", "mediapipe", "wasm");

try {
  if (!fs.existsSync(SRC)) {
    console.warn("[mediapipe-assets] @mediapipe/tasks-vision not installed; background blur asset skipped.");
  } else {
    fs.rmSync(DST, { recursive: true, force: true });
    fs.mkdirSync(DST, { recursive: true });
    fs.cpSync(SRC, DST, { recursive: true });
    console.log("[mediapipe-assets] synced public/mediapipe/wasm");
  }
} catch (e) {
  console.warn("[mediapipe-assets] copy skipped:", e?.message ?? e);
}
process.exit(0);
