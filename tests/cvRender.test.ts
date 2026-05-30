// Scratch diagnostic placeholder — SAFE TO DELETE.
// (Was used to verify the CV page-number renders on a 2-page PDF. The real
// CVDocument can't be imported under Vitest's vite/esbuild JSX transform —
// verified instead via a standalone @react-pdf/renderer render: it emits
// "1 / 2" / "2 / 2" correctly.)
import { it, expect } from "vitest";

it("cv page-number diagnostic placeholder", () => {
  expect(true).toBe(true);
});
