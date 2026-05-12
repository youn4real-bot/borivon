"use client";

/**
 * Remove a uniform light background from a high-contrast image (handwritten
 * signature on paper). Uses Otsu's 1979 adaptive thresholding — mathematically
 * optimal for bimodal histograms like ink-on-paper.
 *
 * Shared by PdfSignModal and admin signature upload so the dedupe goal of
 * LAW #28 is satisfied. ML-based background removal (e.g. @imgly) is a poor
 * fit here: trained for portraits/products, slow first-call (model download),
 * and can shave thin strokes. Otsu completes in <100ms with no network.
 *
 * Returns a PNG data URI on success; falls back to the original input on
 * failure so callers never break.
 */
export function removeImageBg(dataUri: string): Promise<string> {
  return new Promise(resolve => {
    // Audit fix: settle-once guard + timeout so a malformed or oversize image
    // can't leave the UI hanging on a never-resolving Promise. Falls back to
    // the original data URI after 8s if neither onload nor onerror fires.
    let settled = false;
    const finish = (v: string) => { if (!settled) { settled = true; resolve(v); } };
    const timer = setTimeout(() => finish(dataUri), 8000);

    const img = new Image();
    img.onload = () => {
      clearTimeout(timer);
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) { finish(dataUri); return; }
        ctx.drawImage(img, 0, 0);
        const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = id.data;
        const n = canvas.width * canvas.height;

        // Histogram of luminance
        const hist = new Array(256).fill(0);
        for (let i = 0; i < d.length; i += 4) {
          hist[Math.round((d[i] + d[i+1] + d[i+2]) / 3)]++;
        }

        // Otsu: between-class variance maximisation
        let sumAll = 0;
        for (let k = 0; k < 256; k++) sumAll += k * hist[k];
        let sumB = 0, cntB = 0, bestT = 128, maxVar = 0;
        for (let T = 0; T < 256; T++) {
          cntB += hist[T];
          if (!cntB || cntB === n) continue;
          sumB += T * hist[T];
          const mB = sumB / cntB, mA = (sumAll - sumB) / (n - cntB);
          const v = cntB * (n - cntB) * (mB - mA) ** 2;
          if (v > maxVar) { maxVar = v; bestT = T; }
        }

        // Soft anti-aliased cutoff: fade between threshold and a slightly
        // brighter "definitely paper" value to avoid jaggy stroke edges.
        const lo = bestT;
        const hi = bestT + 0.15 * (255 - bestT);
        for (let i = 0; i < d.length; i += 4) {
          const b = (d[i] + d[i+1] + d[i+2]) / 3;
          if (b >= hi) d[i+3] = 0;
          else if (b >= lo) d[i+3] = Math.round((hi - b) / (hi - lo) * 255);
        }
        ctx.putImageData(id, 0, 0);
        finish(canvas.toDataURL("image/png"));
      } catch { finish(dataUri); }
    };
    img.onerror = () => { clearTimeout(timer); finish(dataUri); };
    img.src = dataUri;
  });
}
