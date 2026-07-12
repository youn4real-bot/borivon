// TEMP config for the pdf-lib visual-fidelity harness (delete with the test).
// Overrides esbuild jsx → "automatic" so the .tsx @react-pdf component can be
// imported (the project tsconfig uses jsx:"preserve" for Next.js).
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url)).replace(/\\/g, "/");

export default defineConfig({
  resolve: { alias: [{ find: /^@\//, replacement: root }] },
  // vitest 4 transforms via oxc (not esbuild). Force automatic JSX so the
  // Next.js .tsx (tsconfig jsx:"preserve") can be imported by the harness.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  oxc: { jsx: { runtime: "automatic" } } as any,
  test: {
    environment: "node",
    include: ["tests/zz_pdflib_psheet_visual.test.ts"],
  },
});
