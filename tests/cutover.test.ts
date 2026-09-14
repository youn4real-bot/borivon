import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  runCutover, probeFreeze, journalRowCount, flipInstructions, rollbackInstructions, FREEZE_PROBE_PATH,
} from "../d1/cutover.mjs";

/**
 * The switch-day runbook script. Its gates are the point: it must refuse to copy
 * while writes are still flowing, refuse to re-import a D1 that already took
 * writes, refuse to print a flip unless parity is exact — and never deploy.
 */

const ROOT = path.resolve(".");
const SITE = "https://www.borivon.com";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
const frozenSite = (async () => json(503, { error: "…", code: "maintenance", retryAfter: 600 })) as unknown as typeof fetch;
const openSite = (async () => new Response("<html>404</html>", { status: 404 })) as unknown as typeof fetch;
const emptyD1 = { run: async () => { throw new Error("D1_ERROR: no such table: _write_journal"); } };

function harness(codes: Record<string, number> = {}) {
  const ran: string[] = [];
  const lines: string[] = [];
  return {
    ran, lines,
    log: (l: string) => lines.push(l),
    exec: (script: string, args: string[]) => { ran.push(`${script} ${args.length}`); return codes[script] ?? 0; },
  };
}

describe("probeFreeze", () => {
  it("only the freeze's own 503 counts as frozen", async () => {
    expect(await probeFreeze(SITE, frozenSite)).toEqual({ frozen: true, status: 503 });
    expect(await probeFreeze(SITE, openSite)).toEqual({ frozen: false, status: 404 });
    const otherOutage = (async () => json(503, { error: "Cloudflare" })) as unknown as typeof fetch;
    expect((await probeFreeze(SITE, otherOutage)).frozen).toBe(false);
  });

  it("probes a POST to a path no route answers", async () => {
    const seen: string[] = [];
    await probeFreeze(`${SITE}/`, (async (u: string, init: RequestInit) => { seen.push(`${init.method} ${u}`); return new Response("", { status: 404 }); }) as unknown as typeof fetch);
    expect(seen).toEqual([`POST ${SITE}${FREEZE_PROBE_PATH}`]);
    expect(fs.existsSync(path.join("app", ...FREEZE_PROBE_PATH.split("/").filter(Boolean)))).toBe(false);
  });
});

describe("journalRowCount", () => {
  it("reads 0 when the journal table was never created", async () => {
    expect(await journalRowCount(emptyD1)).toBe(0);
    expect(await journalRowCount({ run: async () => ({ results: [{ n: 4 }] }) })).toBe(4);
    await expect(journalRowCount({ run: async () => { throw new Error("auth failed"); } })).rejects.toThrow("auth failed");
  });
});

describe("runCutover", () => {
  it("dry run (the default) executes nothing and prints freeze, steps, flip and rollback", async () => {
    const h = harness();
    const nothing = (async () => { throw new Error("no network in a dry run"); }) as unknown as typeof fetch;
    const out = await runCutover({ root: ROOT, log: h.log, exec: h.exec, fetchImpl: nothing, d1: { run: async () => { throw new Error("no D1 in a dry run"); } } });
    expect(out.ok).toBe(true);
    expect(h.ran).toEqual([]);
    const text = h.lines.join("\n");
    expect(text).toContain("DRY RUN");
    expect(text).toContain('"MAINTENANCE_WRITES": "1"');
    for (const s of ["d1/export-data.mjs", "d1/import.mjs", "d1/parity-check.mjs"]) expect(text).toContain(s);
    expect(text).toContain('"DATA_BACKEND": "d1",  "SHADOW_D1_RATE": "0",  "MAINTENANCE_WRITES": "0"');
    expect(text).toContain("d1/replay-journal.mjs");
    expect(text).toContain('"DATA_BACKEND": "supabase"');
  });

  it("refuses to copy while writes are not frozen", async () => {
    const h = harness();
    const out = await runCutover({ root: ROOT, dryRun: false, log: h.log, exec: h.exec, fetchImpl: openSite, d1: emptyD1 });
    expect(out).toMatchObject({ ok: false, failedStep: "freeze" });
    expect(h.ran).toEqual([]);
  });

  it("refuses to re-import a D1 that has already taken writes", async () => {
    const h = harness();
    const out = await runCutover({ root: ROOT, dryRun: false, log: h.log, exec: h.exec, fetchImpl: frozenSite, d1: { run: async () => ({ results: [{ n: 12 }] }) } });
    expect(out).toMatchObject({ ok: false, failedStep: "journal" });
    expect(h.ran).toEqual([]);
    expect(h.lines.join("\n")).toContain("ROLLBACK");
  });

  it("refuses to print a flip unless parity reports 0 mismatches", async () => {
    const h = harness({ "d1/parity-check.mjs": 1 });
    const out = await runCutover({ root: ROOT, dryRun: false, log: h.log, exec: h.exec, fetchImpl: frozenSite, d1: emptyD1, exists: () => false });
    expect(out).toMatchObject({ ok: false, failedStep: "parity" });
    expect(h.ran).toEqual(["d1/export-data.mjs 2", "d1/import.mjs 2", "d1/parity-check.mjs 1"]);
    expect(h.lines.join("\n")).not.toContain("FLIP");
  });

  it("stops at drift when the drift check exists and fails", async () => {
    const h = harness({ "d1/check-drift.mjs": 1 });
    const out = await runCutover({ root: ROOT, dryRun: false, log: h.log, exec: h.exec, fetchImpl: frozenSite, d1: emptyD1, exists: () => true });
    expect(out).toMatchObject({ ok: false, failedStep: "drift" });
    expect(h.ran).toEqual(["d1/check-drift.mjs 1"]);
  });

  it("with every gate green: runs only the d1 node scripts, in order, removes its export, prints the flip — never a deploy", async () => {
    const h = harness();
    const out = await runCutover({ root: ROOT, dryRun: false, log: h.log, exec: h.exec, fetchImpl: frozenSite, d1: emptyD1, exists: () => true });
    expect(out.ok).toBe(true);
    expect(h.ran).toEqual(["d1/check-drift.mjs 1", "d1/export-data.mjs 2", "d1/import.mjs 2", "d1/parity-check.mjs 1"]);
    const dir = String(out.outDir);
    expect(path.relative(os.tmpdir(), dir).startsWith("..")).toBe(false);
    expect(fs.existsSync(dir)).toBe(false);
    const text = h.lines.join("\n");
    expect(text).toContain("FLIP");
    expect(text).toContain("ROLLBACK");
  });

  it("refuses an export directory inside the repo — it would hold candidate data", async () => {
    const h = harness();
    const out = await runCutover({ root: ROOT, outDir: path.join(ROOT, "tmp-export"), dryRun: false, log: h.log, exec: h.exec, fetchImpl: frozenSite, d1: emptyD1 });
    expect(out).toMatchObject({ ok: false, failedStep: "out" });
    expect(h.ran).toEqual([]);
  });

  it("the script itself contains no way to deploy", () => {
    const src = fs.readFileSync("d1/cutover.mjs", "utf8");
    const code = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l) && !/"\s*\s*\d?\.?\s*npm run cf:build/.test(l)).join("\n");
    // Deploy commands appear only inside printed instruction strings, never passed to spawnSync.
    expect(src).toMatch(/spawnSync\(process\.execPath, \[path\.join\(root, script\)/);
    expect(code).not.toMatch(/spawnSync\([^)]*(wrangler|npm)/);
  });
});

describe("the printed commands", () => {
  it("flip: the three vars, a build AND a deploy, and an API probe", () => {
    const flip = flipInstructions("/r").join("\n");
    expect(flip).toContain('"DATA_BACKEND": "d1"');
    expect(flip).toContain('"SHADOW_D1_RATE": "0"');
    expect(flip).toContain('"MAINTENANCE_WRITES": "0"');
    expect(flip).toContain("npm run cf:build && npm run cf:deploy");
    expect(flip).toContain("/api/health?deep=1");
  });

  it("rollback: freeze on D1, replay, then flip back", () => {
    const lines = rollbackInstructions("/r");
    const at = (s: string) => lines.findIndex((l) => l.includes(s));
    expect(at('"MAINTENANCE_WRITES": "1"')).toBeLessThan(at("replay-journal.mjs /r --i-mean-it"));
    expect(at("replay-journal.mjs /r --i-mean-it")).toBeLessThan(at('"DATA_BACKEND": "supabase"'));
  });
});
