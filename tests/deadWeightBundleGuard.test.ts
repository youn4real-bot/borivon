import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { tmpdir } from "node:os";

/**
 * A GUARD, not a unit test. Sibling of tests/googleBundleGuard.test.ts, for the
 * heavy packages that are NOT Google SDKs.
 *
 * Cloudflare ships the Worker as ONE script and workerd parses all of it before
 * the first request runs, so a package nothing calls still costs every nurse a
 * slice of the 1.6 s cold start. These two were the clearest case of that: both
 * were reachable from the server graph, and neither could do anything there.
 *
 *   @sentry/nextjs — 2,065,127 bytes of @sentry/node + OpenTelemetry
 *     (.next/server/instrumentation.js 1,177,809 B + chunks/9486.js 887,318 B),
 *     plus 510,337 B in edge-instrumentation.js. No SENTRY_DSN or
 *     NEXT_PUBLIC_SENTRY_DSN exists in wrangler.jsonc, .env.local or
 *     .env.example, so every call site was a no-op — and OpenTelemetry is worse
 *     than dead bytes, because it patches globals and builds an instrumentation
 *     registry at module-EVALUATION time, i.e. on every cold isolate.
 *
 *   next/og — 720,939 bytes of Satori + a resvg WASM module
 *     (next/dist/compiled/@vercel/og/index.edge.js). It 500s on workerd, which
 *     is why app/email-logo already redirected to the pre-rendered PNG there.
 *     It was the only reference to @vercel/og in the whole server build.
 *
 *   @aws-sdk/client-s3 (+ @smithy/*, + the presigner) — 946 KB of SigV4
 *     signing, fast-xml-parser and bowser, kept as a "Vercel" fallback for a
 *     bucket the Worker already reaches through the native env.R2 binding. It
 *     needed R2_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY, none of
 *     which is set anywhere, so it could not run even under `next dev`.
 *
 * Deferring does NOT satisfy this rule and the guard rejects it too: OpenNext
 * inlines dynamic imports into the single Worker script, so the bytes stay and
 * only the ordering changes (commit 91ddf1c measured exactly that). `import
 * type` IS allowed — TypeScript erases it, so it costs nothing.
 *
 * instrumentation-client.ts is deliberately NOT scanned. It dynamic-imports
 * Sentry behind NEXT_PUBLIC_SENTRY_DSN, which Next inlines at build time, so
 * with no DSN set the condition folds to false and the bundler drops the import
 * — and that file only ever reaches the BROWSER bundle, never the Worker.
 */

const ROOT = join(__dirname, "..");

// The roots whose code ends up inside the Worker script.
const SCANNED = ["app", "lib", "components", "middleware.ts", "instrumentation.ts"];

const BANNED: { pkg: string; why: string }[] = [
  {
    pkg: "@sentry/nextjs",
    why: "2,065,127 B of @sentry/node + OpenTelemetry, parsed AND evaluated on every cold isolate, with no SENTRY_DSN configured anywhere. reportError's console / ERROR_WEBHOOK_URL / Telegram sinks cover the same ground for free.",
  },
  {
    pkg: "next/og",
    why: "720,939 B of Satori + resvg WASM that cannot run on workerd (it 500s). Serve a pre-rendered PNG from public/ instead, the way app/email-logo does.",
  },
  {
    pkg: "@aws-sdk/client-s3",
    why: "946 KB of SigV4 chain + fast-xml-parser + bowser, for a bucket the Worker already reaches through the native env.R2 binding. lib/r2.ts is the only door to R2.",
  },
  {
    pkg: "@aws-sdk/s3-request-presigner",
    why: "the presigned-URL half of the same SigV4 chain. It had zero callers repo-wide when it was removed; if presigned URLs are ever wanted back, R2 signs them from the binding without an SDK.",
  },
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
 * Find VALUE imports of a banned package. The static forms are anchored to the
 * start of the line so that the prose comments naming these packages — and there
 * are several, because they are what makes the rule understandable — never
 * register as violations.
 */
function scan(file: string): Hit[] {
  const rel = relative(ROOT, file).split(sep).join("/");
  const hits: Hit[] = [];
  const lines = readFileSync(file, "utf8").split(/\r?\n/);

  for (const b of BANNED) {
    const p = b.pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const spec = `${p}(?:/[^"']*)?`;
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

describe("dead weight stays out of the Worker's import graph", () => {
  const files = sourceFiles();

  it("scans a real, non-empty set of Worker-reachable files", () => {
    // Guards the guard: a broken walk would make every assertion below vacuous.
    expect(files.length).toBeGreaterThan(200);
    expect(files.some((f) => f.endsWith(join("lib", "reportError.ts")))).toBe(true);
  });

  it("no Worker-reachable file value-imports Sentry or next/og", () => {
    const hits = files.flatMap(scan);
    const report = hits.map((h) => `  ${h.file}:${h.line}  ${h.pkg}\n    ${h.text}\n    → ${h.why}`).join("\n");
    expect(hits, hits.length ? `\nDead weight back in the Worker bundle:\n${report}\n` : "").toEqual([]);
  });

  it("still catches a violation when one is introduced", () => {
    // The detector itself is exercised, so a regex that silently stopped
    // matching cannot pass as "no violations found". Written to the OS temp dir,
    // not into the repo: other agents share this worktree, and a stray probe
    // file under lib/ would be scanned as real source on the next run.
    const tmp = join(tmpdir(), "borivon_deadweight_probe.ts");
    const probes = [
      `import * as Sentry from "@sentry/nextjs";`,
      `import { captureException } from "@sentry/nextjs";`,
      `const S = require("@sentry/nextjs");`,
      `void import("@sentry/nextjs").then((S) => S.init({}));`,
      `import { ImageResponse } from "next/og";`,
      `import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";`,
      `import { getSignedUrl } from "@aws-sdk/s3-request-presigner";`,
    ];
    for (const p of probes) {
      writeFileSync(tmp, `${p}\n`, "utf8");
      try {
        expect(scan(tmp).length, `not detected: ${p}`).toBeGreaterThan(0);
      } finally { unlinkSync(tmp); }
    }
  });

  it("allows the forms that genuinely cost nothing", () => {
    const tmp = join(tmpdir(), "borivon_deadweight_probe_ok.ts");
    const allowed = [
      `import type { ImageResponse } from "next/og";`,        // erased by TypeScript
      `// import * as Sentry from "@sentry/nextjs";`,          // a comment explaining the rule
      ` * "@sentry/nextjs" put 2,065,127 bytes into the server build.`,
      `import { after } from "next/server";`,                  // a different next/* entry point
    ];
    writeFileSync(tmp, `${allowed.join("\n")}\n`, "utf8");
    try {
      expect(scan(tmp)).toEqual([]);
    } finally { unlinkSync(tmp); }
  });
});
