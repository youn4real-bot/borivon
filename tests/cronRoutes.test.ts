import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The cron schedule is defined in TWO files that must agree byte-for-byte:
 *
 *   wrangler.jsonc  triggers.crons  — what Cloudflare actually fires
 *   cf-worker.ts    CRON_ROUTES     — which route each fired string dispatches to
 *
 * Cloudflare passes the MATCHED STRING verbatim to scheduled(), so cf-worker.ts does
 * a plain object lookup on it. One character of drift — a double space, a "0 4 * * *"
 * that became "0 4 * * *" with a trailing space, an entry added to one file only —
 * silently maps a live schedule to nothing. Both files carry a comment saying so,
 * which is exactly the kind of instruction that gets missed at 2am.
 *
 * A comment cannot fail a build. This can.
 *
 * Both files are parsed as TEXT rather than imported: cf-worker.ts is @ts-nocheck
 * build-glue that imports ./.open-next/worker.js, which only exists after a build.
 * Textual comparison is also the honest test here — the invariant IS textual.
 */

const ROOT = resolve(__dirname, "..");

/**
 * Strip // and /* *\/ comments from JSONC without mangling comment-like sequences
 * inside strings (e.g. a "https://…" value). Tracks string state and escapes.
 */
function stripJsonComments(src: string): string {
  let out = "";
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const next = src[i + 1];
    if (inLine) {
      if (c === "\n") { inLine = false; out += c; }
      continue;
    }
    if (inBlock) {
      if (c === "*" && next === "/") { inBlock = false; i++; }
      continue;
    }
    if (inString) {
      out += c;
      if (c === "\\") { out += src[++i] ?? ""; continue; }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; out += c; continue; }
    if (c === "/" && next === "/") { inLine = true; i++; continue; }
    if (c === "/" && next === "*") { inBlock = true; i++; continue; }
    out += c;
  }
  return out;
}

function wranglerCrons(): string[] {
  const raw = readFileSync(resolve(ROOT, "wrangler.jsonc"), "utf8");
  const cfg = JSON.parse(stripJsonComments(raw));
  return cfg?.triggers?.crons ?? [];
}

/** Extract the KEYS of the CRON_ROUTES object literal in cf-worker.ts. */
function workerCronKeys(): string[] {
  const raw = readFileSync(resolve(ROOT, "cf-worker.ts"), "utf8");
  const start = raw.indexOf("const CRON_ROUTES");
  expect(start, "CRON_ROUTES not found in cf-worker.ts").toBeGreaterThan(-1);
  const open = raw.indexOf("{", start);
  // Walk to the matching close brace so a nested object could never truncate this.
  let depth = 0;
  let end = -1;
  for (let i = open; i < raw.length; i++) {
    if (raw[i] === "{") depth++;
    else if (raw[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  expect(end, "unbalanced braces in CRON_ROUTES").toBeGreaterThan(-1);
  // Comments inside the block may themselves quote a cron string — strip them first
  // (the same stripper: the block is JSON-shaped enough for its string handling).
  const body = stripJsonComments(raw.slice(open, end + 1));
  return [...body.matchAll(/"([^"]+)"\s*:/g)].map((m) => m[1]);
}

describe("cron schedule wiring", () => {
  it("every wrangler trigger has a route in cf-worker.ts", () => {
    const missing = wranglerCrons().filter((c) => !workerCronKeys().includes(c));
    expect(
      missing,
      `wrangler.jsonc fires ${JSON.stringify(missing)} but cf-worker.ts has no CRON_ROUTES entry — ` +
        `Cloudflare would fire it and scheduled() would do nothing`,
    ).toEqual([]);
  });

  it("every cf-worker route has a wrangler trigger", () => {
    const orphan = workerCronKeys().filter((c) => !wranglerCrons().includes(c));
    expect(
      orphan,
      `cf-worker.ts maps ${JSON.stringify(orphan)} but wrangler.jsonc never fires it — ` +
        `the route is dead code and whatever it does never happens`,
    ).toEqual([]);
  });

  it("cron expressions are well formed (5 fields, single-spaced)", () => {
    for (const c of wranglerCrons()) {
      expect(c, `"${c}" has leading/trailing whitespace`).toBe(c.trim());
      expect(c, `"${c}" has a double space — it would never match cf-worker.ts`).not.toMatch(/ {2}/);
      expect(c.split(" "), `"${c}" is not a 5-field cron expression`).toHaveLength(5);
    }
  });

  it("no duplicate triggers (a repeat silently shadows the first)", () => {
    const crons = wranglerCrons();
    expect(new Set(crons).size, `duplicate cron in wrangler.jsonc: ${JSON.stringify(crons)}`).toBe(crons.length);
  });

  it("the dependency watchdog is actually scheduled", () => {
    // This one matters enough to name: without it, a dead Google/R2/Supabase is
    // invisible until a candidate complains.
    const raw = readFileSync(resolve(ROOT, "cf-worker.ts"), "utf8");
    expect(raw).toContain("/api/cron/health-watch");
  });
});
