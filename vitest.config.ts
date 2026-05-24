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
  },
});
