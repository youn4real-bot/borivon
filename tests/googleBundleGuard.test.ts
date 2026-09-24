import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { tmpdir } from "node:os";

/**
 * A GUARD, not a unit test.
 *
 * Every byte reachable from a route is parsed by workerd on every cold isolate,
 * whether or not the request touches it — that parse is the 1.6 s the nurses feel
 * on the first tap. The Google Node SDKs are the worst offenders the app has ever
 * carried: bundling `googleapis` alone costs 30.6 MB (measured with esbuild), and
 * google-auth-library drags 752 KB of web-streams-polyfill / node-fetch /
 * bignumber.js / gaxios behind it.
 *
 * None of them can even run here. They reach node:http.validateHeaderName, which
 * unenv does not implement on workerd, so the moment one is used it throws. They
 * were pure cold-start tax. Drive, Gmail and Calendar now go through
 * lib/googleDriveShim.ts + lib/googleRestShim.ts (plain fetch) authenticated by
 * lib/googleAuthWebCrypto.ts (crypto.subtle), which run on Node and Workers alike.
 *
 * This has regressed before: commit b97a9b1 cut the bundle 37.1 MB → 25.2 MB, and
 * it had climbed back to 29.7 MB within weeks. One `import { google } from
 * "googleapis"` added to any route is enough to undo the whole thing, and nothing
 * about it looks expensive at the call site. So the import graph is asserted
 * rather than remembered.
 *
 * Deferring an import does NOT satisfy this rule and the guard rejects it too:
 * OpenNext inlines dynamic imports into the single Worker script, so the bytes
 * stay and only the ordering changes (commit 91ddf1c measured exactly that).
 * Only deleting the import removes the weight.
 *
 * `import type` IS allowed — TypeScript erases it, so it costs nothing. That is
 * how lib/googleWorkspace.ts keeps the googleapis client types the shims mimic.
 */

const ROOT = join(__dirname, "..");

// Roots that end up in the Worker script. `scripts/` is deliberately absent:
// scripts/cftest/backfillDriveToR2.mjs is a standalone Node program the founder
// runs on his laptop, never imported by the app, so googleapis there is free.
const SCANNED = ["app", "lib", "components", "middleware.ts", "instrumentation.ts"];

/** Package → why it must not reach the Worker. */
const BANNED: { pkg: string; allowSubpath?: string; why: string }[] = [
  { pkg: "googleapis", why: "30.6 MB bundled; node:http via gaxios — cannot run on workerd. Use lib/googleDriveShim.ts / lib/googleRestShim.ts." },
  { pkg: "google-auth-library", why: "245 KB + 507 KB of polyfills; node:http.validateHeaderName throws on workerd. Use lib/googleAuthWebCrypto.ts." },
  { pkg: "gaxios", why: "google-auth-library's node:http transport — same failure, same cost." },
  { pkg: "gtoken", why: "the jws signing chain google-auth-library uses; lib/googleAuthWebCrypto.ts signs with crypto.subtle instead." },
  { pkg: "@ai-sdk/google-vertex", allowSubpath: "edge", why: "the default build authenticates through google-auth-library (752 KB measured). Import \"@ai-sdk/google-vertex/edge\", which signs with crypto.subtle." },
];

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (p: string) => {
    const st = statSync(p);
    if (st.isFile()) {
      if (/\.(ts|tsx|mjs|cjs|js|jsx)$/.test(p)) out.push(p);
      return;
    }
    for (const e of readdirSync(p)) {
      if (e === "node_modules" || e.startsWith(".")) continue;
      walk(join(p, e));
    }
  };
  for (const s of SCANNED) {
    try { walk(join(ROOT, s)); } catch { /* an optional root that does not exist here */ }
  }
  return out;
}

type Hit = { file: string; line: number; text: string; pkg: string; why: string };

/**
 * Find VALUE imports of a package. Static forms are anchored to the start of the
 * line so the many prose comments naming these packages (there are dozens, and
 * they are the reason the rule is understood) never register as violations;
 * `import type` is skipped for the same reason it is free at runtime.
 */
function scan(file: string): Hit[] {
  const rel = relative(ROOT, file).split(sep).join("/");
  const hits: Hit[] = [];
  const lines = readFileSync(file, "utf8").split(/\r?\n/);

  for (const b of BANNED) {
    const p = b.pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // "pkg" exactly, or "pkg/sub" — but never the allowed subpath.
    const spec = `${p}(?:/(?!${b.allowSubpath ?? "(?!)"}(?:["']|/))[^"']*)?`;
    const staticImport = new RegExp(`^\\s*import\\s+(?!type\\s)[^;]*?from\\s*["']${spec}["']`);
    const bareImport = new RegExp(`^\\s*import\\s*["']${spec}["']`);
    const requireCall = new RegExp(`require\\s*\\(\\s*["']${spec}["']\\s*\\)`);
    const dynamicImport = new RegExp(`\\bimport\\s*\\(\\s*["']${spec}["']\\s*\\)`);

    lines.forEach((raw, i) => {
      const line = raw.replace(/\t/g, "  ");
      const codeOnly = line.replace(/^\s*(\/\/|\*|\/\*).*$/, ""); // drop comment lines
      if (!codeOnly.trim()) return;
      const bad =
        staticImport.test(codeOnly) || bareImport.test(codeOnly) ||
        requireCall.test(codeOnly) || dynamicImport.test(codeOnly);
      if (bad) hits.push({ file: rel, line: i + 1, text: line.trim(), pkg: b.pkg, why: b.why });
    });
  }
  return hits;
}

describe("Google SDKs stay out of the Worker's import graph", () => {
  const files = sourceFiles();

  it("scans a real, non-empty set of Worker-reachable files", () => {
    // Guards the guard: a broken walk would make every assertion below vacuous.
    expect(files.length).toBeGreaterThan(200);
    expect(files.some((f) => f.endsWith("lib/googleWorkspace.ts".replace("/", sep)))).toBe(true);
  });

  it("no file under app/, lib/ or components/ value-imports a Google Node SDK", () => {
    const hits = files.flatMap(scan);
    const report = hits.map((h) => `  ${h.file}:${h.line}  ${h.pkg}\n    ${h.text}\n    → ${h.why}`).join("\n");
    expect(hits, hits.length ? `\nGoogle Node SDK back in the Worker bundle:\n${report}\n` : "").toEqual([]);
  });

  it("still catches a violation when one is introduced", () => {
    // The detector itself is exercised, so a regex that silently stopped matching
    // cannot pass as "no violations found".
    // Written outside the repo: other agents share this worktree, and a stray
    // probe file left in lib/ would be scanned as real source on the next run.
    const tmp = join(tmpdir(), "borivon_guard_probe.ts");
    const probes = [
      `import { google } from "googleapis";`,
      `import { GoogleAuth } from "google-auth-library";`,
      `const { google } = require("googleapis");`,
      `const m = await import("@ai-sdk/google-vertex");`,
      `import { createVertex } from "@ai-sdk/google-vertex";`,
    ];
    for (const p of probes) {
      writeFileSync(tmp, `${p}\n`, "utf8");
      try {
        expect(scan(tmp).length, `not detected: ${p}`).toBeGreaterThan(0);
      } finally { unlinkSync(tmp); }
    }
  });

  it("allows the forms that genuinely cost nothing", () => {
    const tmp = join(tmpdir(), "borivon_guard_probe_ok.ts");
    const allowed = [
      `import type { drive_v3, gmail_v1 } from "googleapis";`,              // erased by TypeScript
      `import { createVertex } from "@ai-sdk/google-vertex/edge";`,          // crypto.subtle, no node:http
      `// import { google } from "googleapis";`,                            // a comment explaining the rule
      ` * googleapis reaches node:http through gaxios, which workerd cannot serve.`,
    ];
    writeFileSync(tmp, `${allowed.join("\n")}\n`, "utf8");
    try {
      expect(scan(tmp)).toEqual([]);
    } finally { unlinkSync(tmp); }
  });
});
