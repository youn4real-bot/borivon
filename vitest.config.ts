import { defineConfig } from "vitest/config";

// Unit tests run in a plain Node environment — they cover server-side pure
// helpers (auth tokens, passport-file gating, path sanitisation). No jsdom.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
