import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import registryJson from "@/d1/types.json";
import { appendEntry, resetJournalForTests, JOURNAL_DDL } from "@/lib/d1/writeJournal";
import {
  runCutover, probeFreeze, journalRowCount, flipInstructions, rollbackInstructions, findRealtimeSubscriptions,
  rollbackParityArgs, FREEZE_PROBE_PATH,
} from "../d1/cutover.mjs";
import { hasSqlite, openDb, sqliteRunner } from "./helpers/sqliteD1";

/**
 * The switch-day runbook script. Its gates are the point: it must refuse to copy
 * while writes are still flowing or a screen still depends on Realtime, refuse
 * to re-import a D1 that already took writes, refuse to print a flip unless
 * parity is exact, refuse to print the flip BACK unless Supabase provably holds
 * every row D1 has — and never deploy.
 */

const ROOT = path.resolve(".");
const SITE = "https://www.borivon.com";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
const frozenSite = (async () => json(503, { error: "…", code: "maintenance", retryAfter: 600 })) as unknown as typeof fetch;
const openSite = (async () => new Response("<html>404</html>", { status: 404 })) as unknown as typeof fetch;
const emptyD1 = { run: async () => { throw new Error("D1_ERROR: no such table: _write_journal"); } };
const noRealtime = () => [] as string[];

function harness(codes: Record<string, number> = {}, onExec?: (script: string, args: string[]) => void) {
  const ran: string[] = [];
  const calls: { script: string; args: string[] }[] = [];
  const lines: string[] = [];
  return {
    ran, calls, lines,
    log: (l: string) => lines.push(l),
    exec: (script: string, args: string[]) => {
      ran.push(`${script} ${args.length}`);
      calls.push({ script, args });
      onExec?.(script, args);
      return codes[script] ?? 0;
    },
  };
}

/** An export step that really leaves a directory behind, like d1/export-data.mjs. */
const writesExport = (script: string, args: string[]) => {
  if (script !== "d1/export-data.mjs") return;
  fs.mkdirSync(args[1], { recursive: true });
  fs.writeFileSync(path.join(args[1], "candidate_profiles.json"), "[]");
};

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

describe("findRealtimeSubscriptions", () => {
  it("finds live postgres_changes subscriptions, not comments that name them", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bv-realtime-"));
    try {
      fs.mkdirSync(path.join(dir, "app", "portal"), { recursive: true });
      fs.mkdirSync(path.join(dir, "components"), { recursive: true });
      fs.mkdirSync(path.join(dir, "lib"), { recursive: true });
      fs.writeFileSync(path.join(dir, "app", "portal", "page.tsx"), 'supabase.channel("x")\n  .on("postgres_changes", { event: "*" }, cb)\n');
      fs.writeFileSync(path.join(dir, "components", "Bell.tsx"), "const c = sb.channel('y').on(\n  'postgres_changes', {}, cb);\n");
      fs.writeFileSync(path.join(dir, "lib", "poller.ts"), "/**\n * Replaces Realtime `postgres_changes` subscriptions.\n * This was a postgres_changes channel.\n */\n");
      expect(findRealtimeSubscriptions(dir)).toEqual(["app/portal/page.tsx:2", "components/Bell.tsx:1"]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("runCutover (switch)", () => {
  it("dry run (the default) executes nothing and prints freeze, steps, flip and rollback", async () => {
    const h = harness();
    const nothing = (async () => { throw new Error("no network in a dry run"); }) as unknown as typeof fetch;
    const out = await runCutover({ root: ROOT, log: h.log, exec: h.exec, fetchImpl: nothing, d1: { run: async () => { throw new Error("no D1 in a dry run"); } }, realtimeScan: () => { throw new Error("no scan in a dry run"); } });
    expect(out.ok).toBe(true);
    expect(h.ran).toEqual([]);
    const text = h.lines.join("\n");
    expect(text).toContain("DRY RUN");
    expect(text).toContain('"MAINTENANCE_WRITES": "1"');
    expect(text).toContain("postgres_changes");
    for (const s of ["d1/export-data.mjs", "d1/import.mjs", "d1/parity-check.mjs"]) expect(text).toContain(s);
    expect(text).toContain('"DATA_BACKEND": "d1",  "SHADOW_D1_RATE": "0",  "MAINTENANCE_WRITES": "0"');
    expect(text).toContain("d1/replay-journal.mjs");
    expect(text).toContain('"DATA_BACKEND": "supabase"');
  });

  it("refuses while any screen still subscribes to Realtime — on D1 it would go silent", async () => {
    const h = harness();
    const out = await runCutover({ root: ROOT, dryRun: false, log: h.log, exec: h.exec, fetchImpl: frozenSite, d1: emptyD1, realtimeScan: () => ["app/portal/admin/page.tsx:1379"] });
    expect(out).toMatchObject({ ok: false, failedStep: "realtime" });
    expect(h.ran).toEqual([]);
    expect(h.lines.join("\n")).toContain("app/portal/admin/page.tsx:1379");
    expect(h.lines.join("\n")).toContain("prep/polling");
  });

  it("refuses to copy while writes are not frozen", async () => {
    const h = harness();
    const out = await runCutover({ root: ROOT, dryRun: false, log: h.log, exec: h.exec, fetchImpl: openSite, d1: emptyD1, realtimeScan: noRealtime });
    expect(out).toMatchObject({ ok: false, failedStep: "freeze" });
    expect(h.ran).toEqual([]);
    expect(h.lines.join("\n")).not.toContain("personal data");   // nothing was exported
  });

  it("refuses to re-import a D1 that has already taken writes, and names the way out", async () => {
    const h = harness();
    const out = await runCutover({ root: ROOT, dryRun: false, log: h.log, exec: h.exec, fetchImpl: frozenSite, d1: { run: async () => ({ results: [{ n: 12 }] }) }, realtimeScan: noRealtime });
    expect(out).toMatchObject({ ok: false, failedStep: "journal" });
    expect(h.ran).toEqual([]);
    expect(h.lines.join("\n")).toContain("ROLLBACK");
    expect(h.lines.join("\n")).toContain("--archive --i-mean-it");
  });

  it("refuses to print a flip unless parity reports 0 mismatches — and removes the export it made", async () => {
    const h = harness({ "d1/parity-check.mjs": 1 }, writesExport);
    const out = await runCutover({ root: ROOT, dryRun: false, log: h.log, exec: h.exec, fetchImpl: frozenSite, d1: emptyD1, exists: () => false, realtimeScan: noRealtime });
    expect(out).toMatchObject({ ok: false, failedStep: "parity" });
    expect(h.ran).toEqual(["d1/export-data.mjs 2", "d1/import.mjs 2", "d1/parity-check.mjs 1"]);
    const text = h.lines.join("\n");
    expect(text).not.toContain("FLIP");
    const exportDir = h.calls[0].args[1];
    expect(path.relative(os.tmpdir(), exportDir).startsWith("..")).toBe(false);
    expect(fs.existsSync(exportDir)).toBe(false);
    expect(text).toContain(`removed the export directory ${exportDir} (it held candidate personal data)`);
    expect(out).not.toHaveProperty("outDir");
  });

  it("with --keep-export, a refusal leaves the export and says what is in it", async () => {
    const h = harness({ "d1/import.mjs": 3 }, writesExport);
    const out = await runCutover({ root: ROOT, dryRun: false, keepExport: true, log: h.log, exec: h.exec, fetchImpl: frozenSite, d1: emptyD1, exists: () => false, realtimeScan: noRealtime });
    const exportDir = h.calls[0].args[1];
    try {
      expect(out).toMatchObject({ ok: false, failedStep: "import", outDir: exportDir });
      expect(fs.existsSync(exportDir)).toBe(true);
      expect(h.lines.join("\n")).toContain(`DELETE the export directory when you are done — it holds candidate personal data: ${exportDir}`);
    } finally { fs.rmSync(exportDir, { recursive: true, force: true }); }
  });

  it("stops at drift when the drift check exists and fails", async () => {
    const h = harness({ "d1/check-drift.mjs": 1 });
    const out = await runCutover({ root: ROOT, dryRun: false, log: h.log, exec: h.exec, fetchImpl: frozenSite, d1: emptyD1, exists: () => true, realtimeScan: noRealtime });
    expect(out).toMatchObject({ ok: false, failedStep: "drift" });
    expect(h.ran).toEqual(["d1/check-drift.mjs 1"]);
  });

  it("with every gate green: runs only the d1 node scripts, in order, removes its export, prints the flip — never a deploy", async () => {
    const h = harness({}, writesExport);
    const out = await runCutover({ root: ROOT, dryRun: false, log: h.log, exec: h.exec, fetchImpl: frozenSite, d1: emptyD1, exists: () => true, realtimeScan: noRealtime });
    expect(out.ok).toBe(true);
    expect(h.ran).toEqual(["d1/check-drift.mjs 1", "d1/export-data.mjs 2", "d1/import.mjs 2", "d1/parity-check.mjs 1"]);
    expect(fs.existsSync(h.calls[1].args[1])).toBe(false);
    const text = h.lines.join("\n");
    expect(text).toContain("FLIP");
    expect(text).toContain("ROLLBACK");
  });

  it("refuses an export directory inside the repo — it would hold candidate data", async () => {
    const h = harness();
    const out = await runCutover({ root: ROOT, outDir: path.join(ROOT, "tmp-export"), dryRun: false, log: h.log, exec: h.exec, fetchImpl: frozenSite, d1: emptyD1, realtimeScan: noRealtime });
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

describe("runCutover (rollback): the flip back is printed only when Supabase provably has everything", () => {
  const replayed = async () => ({ journaled: 5, pending: 0, late: 0, ok: true });

  it("dry run prints the three gates and the rollback, and runs nothing", async () => {
    const h = harness();
    const out = await runCutover({ root: ROOT, mode: "rollback", log: h.log, exec: h.exec, fetchImpl: openSite, replayCheck: async () => { throw new Error("nothing runs in a dry run"); } });
    expect(out).toMatchObject({ ok: true, dryRun: true, steps: ["freeze", "replay", "parity"] });
    expect(h.ran).toEqual([]);
    const text = h.lines.join("\n");
    expect(text).toContain("--ignore=employers.updated_at");
    expect(text).toContain("--rollback --i-mean-it");
  });

  it("refuses while writes are not frozen, before reading the journal", async () => {
    const h = harness();
    let asked = false;
    const out = await runCutover({ root: ROOT, mode: "rollback", dryRun: false, log: h.log, exec: h.exec, fetchImpl: openSite, replayCheck: async () => { asked = true; return replayed(); } });
    expect(out).toMatchObject({ ok: false, failedStep: "freeze" });
    expect(asked).toBe(false);
    expect(h.ran).toEqual([]);
  });

  it("refuses while journaled writes are still pending or late, without running parity", async () => {
    for (const summary of [{ journaled: 5, pending: 2, late: 0, ok: false }, { journaled: 5, pending: 1, late: 1, ok: false }]) {
      const h = harness();
      const out = await runCutover({ root: ROOT, mode: "rollback", dryRun: false, log: h.log, exec: h.exec, fetchImpl: frozenSite, replayCheck: async () => summary });
      expect(out).toMatchObject({ ok: false, failedStep: "replay" });
      expect(h.ran).toEqual([]);
      expect(h.lines.join("\n")).not.toContain('"DATA_BACKEND": "supabase"');
    }
  });

  it("refuses when parity finds a difference, even with the replay reporting 0 pending (a LOST journal write)", async () => {
    const h = harness({ "d1/parity-check.mjs": 1 });
    const out = await runCutover({ root: ROOT, mode: "rollback", dryRun: false, log: h.log, exec: h.exec, fetchImpl: frozenSite, replayCheck: replayed });
    expect(out).toMatchObject({ ok: false, failedStep: "parity" });
    expect(h.ran).toEqual(["d1/parity-check.mjs 2"]);
    const text = h.lines.join("\n");
    expect(text).toContain("[write-journal] LOST");
    expect(text).not.toContain('"DATA_BACKEND": "supabase"');
    expect(text).not.toContain("FLIP BACK");
  });

  it("with every gate green: parity ignores only the named recomputed columns, then prints the flip back and the archive", async () => {
    const h = harness();
    const out = await runCutover({ root: ROOT, mode: "rollback", dryRun: false, log: h.log, exec: h.exec, fetchImpl: frozenSite, replayCheck: replayed });
    expect(out).toMatchObject({ ok: true, mode: "rollback" });
    expect(h.calls).toEqual([{ script: "d1/parity-check.mjs", args: rollbackParityArgs(ROOT) }]);
    expect(rollbackParityArgs(ROOT)).toEqual([ROOT, "--ignore=employers.updated_at"]);
    const text = h.lines.join("\n");
    expect(text).toContain("FLIP BACK");
    expect(text).toContain('"DATA_BACKEND": "supabase"');
    expect(text).toContain("--archive --i-mean-it");
  });

  it.skipIf(!hasSqlite)("by default reads the real journal: an unreplayed write in D1 blocks the flip back", async () => {
    resetJournalForTests();
    const runner = sqliteRunner(openDb());
    for (const ddl of JOURNAL_DDL) await runner.run(ddl);
    await appendEntry(runner, { at: "2026-09-14T10:00:00.000Z", at_ms: 1, seq: 1, method: "POST", path: "/rest/v1/notifications", prefer: null, body: "{}", status: 201, note: null }, null);
    const h = harness();
    const noNetwork = (async () => { throw new Error("the dry-run replay must not call Supabase"); }) as unknown as typeof fetch;
    const out = await runCutover({
      root: ROOT, mode: "rollback", dryRun: false, log: h.log, exec: h.exec, fetchImpl: frozenSite,
      d1: runner, target: { url: "https://p.supabase.co", key: "k", fetch: noNetwork }, registry: registryJson,
    });
    expect(out).toMatchObject({ ok: false, failedStep: "replay" });
    expect(h.lines.join("\n")).toContain("1 journaled write(s) not replayed yet");
    expect(h.ran).toEqual([]);
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

  it("rollback: freeze on D1, replay, prove parity, then flip back, then archive", () => {
    const lines = rollbackInstructions("/r");
    const at = (s: string) => lines.findIndex((l) => l.includes(s));
    expect(at('"MAINTENANCE_WRITES": "1"')).toBeLessThan(at("replay-journal.mjs /r --i-mean-it"));
    expect(at("replay-journal.mjs /r --i-mean-it")).toBeLessThan(at("cutover.mjs /r --rollback --i-mean-it"));
    expect(at("cutover.mjs /r --rollback --i-mean-it")).toBeLessThan(at('"DATA_BACKEND": "supabase"'));
    expect(at('"DATA_BACKEND": "supabase"')).toBeLessThan(at("--archive --i-mean-it"));
  });
});
