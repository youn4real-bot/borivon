import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Resolve the "@/..." path alias (mirrors tsconfig paths) so tests can import
// modules that use it — e.g. lib/admin-auth imports "@/lib/supabase".
const root = fileURLToPath(new URL("./", import.meta.url)).replace(/\\/g, "/");

// Unit tests run in a plain Node environment — server-side pure helpers plus
// auth logic with the Supabase client mocked. No jsdom.
export default defineConfig({
  resolve: {
    alias: [{ find: /^@\//, replacement: root }],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // The pdf-lib render tests (CV / passport sheet / letters) embed fonts and lay
    // out real multi-page PDFs — 5-25s each. Vitest's 5s default made them FLAKE
    // under parallel load (a different subset failed every run, all passing in
    // isolation), which made a green suite meaningless. Give the whole suite room;
    // the fast pure-logic tests are unaffected since this is only a ceiling.
    testTimeout: 45_000,
    hookTimeout: 45_000,
  },
});
