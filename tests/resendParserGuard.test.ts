import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * next.config.ts aliases "postal-mime" to false in the SERVER compilation. This
 * guard is what makes that safe to leave in place.
 *
 * WHY THE ALIAS EXISTS: postal-mime is an email PARSER — 134,946 bytes,
 * measured with esbuild against this node_modules (the whole `resend` import
 * graph is 170,633 B and postal-mime is 79% of it). Cloudflare ships the Worker
 * as one script and workerd parses all of it on every cold isolate, so those
 * bytes were charged to every nurse on every first tap. This app never parses
 * an email with Resend: it calls resend.emails.send() and nothing else, and the
 * bot's inbox is Gmail.
 *
 * WHAT MAKES IT SAFE, and what this file pins down:
 *   1. In the installed SDK, PostalMime is imported once and used exactly once,
 *      inside Receiving.forwardPassthrough — the inbound-mail feature.
 *   2. Nothing in our own source reaches resend's `receiving` API.
 *
 * If a Resend upgrade starts parsing mail anywhere else, (1) fails here — a
 * loud test rather than a TypeError inside a "your document was approved"
 * e-mail that a candidate then never receives. The fix at that point is to
 * delete the alias line in next.config.ts and take the 135 KB back.
 */

const ROOT = join(__dirname, "..");
const SDK = join(ROOT, "node_modules", "resend", "dist", "index.mjs");

describe("postal-mime is unreachable in the Resend SDK we ship", () => {
  const src = readFileSync(SDK, "utf8");

  it("imports postal-mime exactly once, at module scope", () => {
    const imports = src.match(/^import\s+PostalMime\s+from\s+["']postal-mime["'];?$/gm) ?? [];
    expect(imports, "resend no longer imports PostalMime the way this guard expects").toHaveLength(1);
  });

  it("calls it in exactly one place", () => {
    const calls = src.match(/PostalMime\s*\.\s*\w+\s*\(/g) ?? [];
    expect(calls, `PostalMime call sites: ${calls.join(", ")}`).toHaveLength(1);
  });

  it("that one place is the inbound forwardPassthrough, which we never call", () => {
    const at = src.indexOf("PostalMime.parse");
    expect(at).toBeGreaterThan(0);
    // The nearest method declaration above the call is the method that owns it.
    const before = src.slice(0, at);
    const methods = [...before.matchAll(/async\s+([A-Za-z0-9_$]+)\s*\(/g)];
    expect(methods.length).toBeGreaterThan(0);
    expect(methods[methods.length - 1][1]).toBe("forwardPassthrough");
  });

  it("next.config.ts still carries the alias this guard is protecting", () => {
    const cfg = readFileSync(join(ROOT, "next.config.ts"), "utf8");
    expect(cfg).toContain(`config.resolve.alias["postal-mime"] = false;`);
  });

  it("nothing in our own source touches resend's inbound API", () => {
    // `.receiving` is the only door to forwardPassthrough. Scanned as source
    // text: the alias is a build-time decision, so a reference anywhere in the
    // Worker-reachable tree is enough to make it wrong.
    const roots = ["app", "lib", "components"].map((r) => join(ROOT, r));
    const files: string[] = [];
    const walk = (p: string) => {
      const st = statSync(p);
      if (st.isFile()) { if (/\.(ts|tsx)$/.test(p)) files.push(p); return; }
      for (const e of readdirSync(p)) {
        if (e === "node_modules" || e.startsWith(".")) continue;
        walk(join(p, e));
      }
    };
    for (const r of roots) walk(r);
    expect(files.length).toBeGreaterThan(200); // guards the guard

    const offenders = files.filter((f) => /\.receiving\b/.test(readFileSync(f, "utf8")));
    expect(offenders, `files reaching resend's inbound API: ${offenders.join(", ")}`).toEqual([]);
  });
});
