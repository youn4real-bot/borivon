/**
 * SWITCH DAY: the final copy, proven, then the exact flip — printed, never run.
 * ROLLBACK: proof that Supabase holds everything D1 took, then the flip back — printed, never run.
 *
 *   node d1/cutover.mjs <repo-root>                           DRY RUN (default): print every step, run nothing
 *   node d1/cutover.mjs <repo-root> --i-mean-it               run the copy gates (it still never deploys)
 *   node d1/cutover.mjs <repo-root> --rollback                DRY RUN of the rollback gates
 *   node d1/cutover.mjs <repo-root> --rollback --i-mean-it    run the rollback gates; prints the flip back only if all pass
 *     --site https://www.borivon.com                           the site to probe
 *     --out <dir>                                              export directory (must be OUTSIDE the repo)
 *     --keep-export                                            keep the export (it holds candidate personal data)
 *
 * The copy gates — the script REFUSES to go on if one fails:
 *   1. no screen waits on Realtime             no `.on("postgres_changes"` left in the app (see below)
 *   2. writes are frozen on the live site      a mutating /api request answers the freeze's 503
 *   3. D1 has never been the backend           _write_journal is empty (re-importing a D1 that
 *                                              took writes would erase them)
 *   4. no schema drift                         d1/check-drift.mjs, when that script exists
 *   5. export   d1/export-data.mjs             read-only on Supabase
 *   6. import   d1/import.mjs                  refreshes the D1 copy
 *   7. parity   d1/parity-check.mjs            must report 0 mismatches
 * Then it prints the wrangler var edit + deploy for the FLIP, and for the ROLLBACK.
 *
 * The rollback gates, run after `replay-journal.mjs --i-mean-it` says "0 still pending":
 *   1. writes are frozen                       nothing is still adding to the journal
 *   2. the journal is fully replayed           replay-journal's own dry run: 0 pending, 0 late
 *   3. parity   d1/parity-check.mjs            every row of D1 is in Supabase
 * Gate 3 is the one that makes "loses nothing" true. The journal only proves the
 * writes it RECORDED reached Supabase; a write whose journal insert failed is in
 * D1 alone, and the replay would still report success. Only the columns
 * Supabase recomputes on replay by design (REPLAY_RECOMPUTED) are left out of
 * the comparison, named on the command line and in its output.
 *
 * Why it never deploys: `cf:deploy` ships whatever sits in .open-next/, and a
 * flip must be a human watching the probes answer, not a script racing ahead of
 * a half-finished build. docs/cutover-runbook.md is the minute-by-minute version.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { replayJournal, readEnv, httpD1, REPLAY_RECOMPUTED } from "./replay-journal.mjs";

export const SITE_DEFAULT = "https://www.borivon.com";

/**
 * A POST to an /api path that has no route. Frozen: middleware.ts answers 503
 * before routing. Not frozen: Next answers 404 — no route runs, nothing can be
 * written. A real save endpoint would do too, but only this one is harmless
 * whichever way the answer goes.
 */
export const FREEZE_PROBE_PATH = "/api/_cutover/freeze-probe";

/**
 * A live Supabase Realtime row subscription. Realtime streams SUPABASE's
 * write-ahead log; once D1 takes the writes, every such channel goes silent for
 * good — the bell, the chat, and the admin's live view of a candidate's passport
 * OCR draft (LAW #38) all stop updating, with no error anywhere. prep/polling
 * replaces them with polling. Matched as code (`.on("postgres_changes"`), not
 * as a word: the polling code's comments still name what it replaced.
 */
export const REALTIME_SUBSCRIPTION = /\.on\(\s*["'`]postgres_changes["'`]/g;
const REALTIME_DIRS = ["app", "components", "lib", "hooks"];

/** Every `.on("postgres_changes"` under the app's source dirs, as `file:line`. */
export function findRealtimeSubscriptions(root, dirs = REALTIME_DIRS) {
  const hits = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.(tsx?|jsx?|mjs)$/.test(e.name)) continue;
      const text = fs.readFileSync(p, "utf8");
      for (const m of text.matchAll(REALTIME_SUBSCRIPTION)) {
        const line = text.slice(0, m.index).split("\n").length;
        hits.push(`${path.relative(root, p).split(path.sep).join("/")}:${line}`);
      }
    }
  };
  for (const d of dirs) walk(path.join(root, d));
  return hits;
}

const q = (s) => (/[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);

/** parity-check's arguments for the rollback gate. */
export function rollbackParityArgs(root) {
  return [root, `--ignore=${Object.keys(REPLAY_RECOMPUTED).join(",")}`];
}

export function freezeInstructions(root) {
  return [
    "FREEZE (before running this script with --i-mean-it):",
    '  1. wrangler.jsonc "vars":  "MAINTENANCE_WRITES": "1"   (DATA_BACKEND stays "supabase")',
    "  2. npm run cf:build && npm run cf:deploy        — WRITE DOWN this Version ID: it is the emergency rollback target",
    `  3. node d1/cutover.mjs ${q(root)} --i-mean-it`,
  ];
}

export function flipInstructions(root, site = SITE_DEFAULT) {
  return [
    "FLIP (you run these — this script never deploys):",
    '  1. wrangler.jsonc "vars":  "DATA_BACKEND": "d1",  "SHADOW_D1_RATE": "0",  "MAINTENANCE_WRITES": "0"',
    '     (CF_CRONS_ENABLED stays "true")',
    "  2. npm run cf:build && npm run cf:deploy",
    "  3. prove it is live (a 200 on a page proves nothing):",
    `       curl -s "${site}/api/health?deep=1"                       → deps.d1Backend true, deps.writesFrozen false`,
    `       curl -s -X POST ${site}${FREEZE_PROBE_PATH}   → 404, NOT 503`,
    `  4. after the first save on the portal:  node d1/replay-journal.mjs ${q(root)}   → "1 pending" or more (the journal is recording)`,
  ];
}

/** The flip back — printed on its own only once the rollback gates pass. */
export function flipBackInstructions(root, site = SITE_DEFAULT) {
  return [
    '  R4. wrangler.jsonc "vars":  "DATA_BACKEND": "supabase",  "MAINTENANCE_WRITES": "0",  "SHADOW_D1_RATE": "0"',
    "      npm run cf:build && npm run cf:deploy",
    `  R5. curl -s "${site}/api/health?deep=1"   → deps.d1Backend false, deps.writesFrozen false`,
    `  R6. node d1/replay-journal.mjs ${q(root)} --archive --i-mean-it   (moves the replayed journal aside, so a later switch can run)`,
  ];
}

export function rollbackInstructions(root, site = SITE_DEFAULT) {
  return [
    "ROLLBACK (loses nothing — in this order):",
    '  R1. wrangler.jsonc "vars":  "DATA_BACKEND": "d1",  "MAINTENANCE_WRITES": "1"   → npm run cf:build && npm run cf:deploy',
    `      curl -s -X POST ${site}${FREEZE_PROBE_PATH}   → 503 (writes stopped; D1 still answers reads)`,
    "  R2. wait 2 minutes — journal inserts finish after their responses",
    `  R3. node d1/replay-journal.mjs ${q(root)}                 (dry run: read the list and every WARN line)`,
    `      node d1/replay-journal.mjs ${q(root)} --i-mean-it     (repeat until "0 still pending")`,
    `  R3b. node d1/cutover.mjs ${q(root)} --rollback --i-mean-it   (freeze + 0 pending + parity; it REFUSES if Supabase is missing anything)`,
    ...flipBackInstructions(root, site),
    "  EMERGENCY (D1 itself is failing and the site cannot read): npx wrangler rollback <the FREEZE Version ID>",
    "      — Supabase answers reads again with writes still frozen; run R3 and R3b once D1 is back, then R4.",
  ];
}

/** Is the freeze live on the site? */
export async function probeFreeze(site, fetchImpl = fetch) {
  const res = await fetchImpl(`${site.replace(/\/+$/, "")}${FREEZE_PROBE_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", "accept-language": "en" },
    body: "{}",
    redirect: "manual",
  });
  let body = null;
  try { body = await res.json(); } catch { /* a 404 page is HTML */ }
  return { frozen: res.status === 503 && body?.code === "maintenance", status: res.status };
}

/** Writes D1 has taken as the backend. 0 when the journal table does not exist (or was archived). */
export async function journalRowCount(d1) {
  try {
    const { results } = await d1.run(`SELECT count(*) AS n FROM "_write_journal"`);
    return Number(results[0]?.n ?? 0);
  } catch (err) {
    if (/no such table/i.test(String(err?.message ?? err))) return 0;
    throw err;
  }
}

function insideRepo(root, dir) {
  const rel = path.relative(path.resolve(root), path.resolve(dir));
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

const errText = (err) => (err instanceof Error ? err.message : String(err));

/**
 * @typedef {{ run(sql: string, params?: unknown[]): Promise<{ results: Record<string, unknown>[] }> }} D1Like
 * @typedef {{ journaled: number, pending: number, late: number, ok: boolean }} ReplaySummary
 */

/**
 * The run. Everything with a side effect is injected, so the tests can prove
 * the gates hold and that nothing here ever reaches for a deploy:
 *   exec(script, args) → exit code     run one node script from d1/
 *   fetchImpl                          the freeze probe
 *   d1 { run(sql) → { results } }      the journal
 *   realtimeScan() → file:line[]       the Realtime gate
 *   replayCheck() → summary            the rollback's "0 pending" gate (default: replay-journal's dry run)
 *
 * @param {{
 *   root: string, mode?: "switch" | "rollback", site?: string, outDir?: string, keepExport?: boolean, dryRun?: boolean,
 *   log?: (line: string) => void,
 *   exec?: (script: string, args: string[]) => number,
 *   fetchImpl?: typeof fetch,
 *   d1?: D1Like,
 *   target?: { url: string, key?: string, fetch?: typeof fetch },
 *   registry?: unknown,
 *   exists?: (rel: string) => boolean,
 *   realtimeScan?: () => string[],
 *   replayCheck?: () => Promise<ReplaySummary>,
 * }} opts
 */
export async function runCutover(opts) {
  return (opts.mode ?? "switch") === "rollback" ? runRollback(opts) : runSwitch(opts);
}

/** @param {Parameters<typeof runCutover>[0]} opts */
async function runSwitch({
  root, site = SITE_DEFAULT, outDir, keepExport = false, dryRun = true, log = console.log,
  exec, fetchImpl = fetch, d1, exists = (rel) => fs.existsSync(path.join(root, rel)),
  realtimeScan = () => findRealtimeSubscriptions(root),
}) {
  const ownOut = !outDir;
  const out = outDir ?? path.join(os.tmpdir(), `borivon-cutover-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const hasDrift = exists("d1/check-drift.mjs");

  const steps = [
    { id: "realtime", title: "no screen still waits on Supabase Realtime", how: 'no `.on("postgres_changes"` in app/, components/, lib/ (prep/polling merged)' },
    { id: "freeze", title: `writes are frozen on ${site}`, how: `POST ${site}${FREEZE_PROBE_PATH} must answer 503 {code:"maintenance"}` },
    { id: "journal", title: "D1 has never been the backend", how: 'SELECT count(*) FROM "_write_journal" must be 0 (or the table absent)' },
    hasDrift
      ? { id: "drift", title: "no schema drift since the snapshot", how: `node d1/check-drift.mjs ${q(root)}`, script: "d1/check-drift.mjs", args: [root] }
      : { id: "drift", title: "schema drift check", how: "d1/check-drift.mjs not present on this branch — skipped", skip: true },
    { id: "export", title: "export Supabase (read-only)", how: `node d1/export-data.mjs ${q(root)} ${q(out)}`, script: "d1/export-data.mjs", args: [root, out] },
    { id: "import", title: "import into the D1 copy", how: `node d1/import.mjs ${q(root)} ${q(out)}`, script: "d1/import.mjs", args: [root, out] },
    { id: "parity", title: "parity: every row, every table, 0 mismatches", how: `node d1/parity-check.mjs ${q(root)}`, script: "d1/parity-check.mjs", args: [root] },
  ];

  log(`${dryRun ? "DRY RUN — nothing below is executed." : "CUTOVER — running the copy steps."}  site=${site}`);
  log("");

  if (insideRepo(root, out)) {
    log(`REFUSING: the export directory ${out} is inside the repo — it holds candidate personal data.`);
    return { ok: false, dryRun, failedStep: "out" };
  }

  if (dryRun) {
    for (const l of freezeInstructions(root)) log(l);
    log("");
    steps.forEach((s, i) => log(`  step ${i + 1}  ${s.title}\n          ${s.how}`));
    log("");
    for (const l of flipInstructions(root, site)) log(l);
    log("");
    for (const l of rollbackInstructions(root, site)) log(l);
    return { ok: true, dryRun, steps: steps.map((s) => s.id) };
  }

  // Set once the export has started: from then on the directory may hold a full
  // copy of candidate data, and every way out of this run must deal with it.
  let exported = false;
  const disposeExport = () => {
    if (!exported) return false;
    if (ownOut && !keepExport) {
      try {
        fs.rmSync(out, { recursive: true, force: true });
        log(`removed the export directory ${out} (it held candidate personal data)`);
        return false;
      } catch { /* fall through to the warning */ }
    }
    log(`DELETE the export directory when you are done — it holds candidate personal data: ${out}`);
    return true;
  };

  const refuse = (step, why) => {
    log(`REFUSING at "${step.title}": ${why}`);
    const kept = disposeExport();
    log('Nothing was flipped. To reopen the site on Supabase: "MAINTENANCE_WRITES": "0" → npm run cf:build && npm run cf:deploy');
    return { ok: false, dryRun, failedStep: step.id, ...(kept ? { outDir: out } : {}) };
  };

  for (const [i, step] of steps.entries()) {
    log(`step ${i + 1}  ${step.title}`);
    if (step.skip) { log(`        ${step.how}`); continue; }
    if (step.id === "realtime") {
      let hits;
      try { hits = realtimeScan(); } catch (err) { return refuse(step, `could not scan the source: ${errText(err)}`); }
      if (hits.length) {
        for (const h of hits.slice(0, 20)) log(`        ${h}`);
        return refuse(step, `${hits.length} Realtime postgres_changes subscription(s) remain. On D1 they never fire again (bell, chat, LAW #38 live passport draft). Merge prep/polling first.`);
      }
      log("        ok — none");
      continue;
    }
    if (step.id === "freeze") {
      let probe;
      try { probe = await probeFreeze(site, fetchImpl); } catch (err) { return refuse(step, `probe failed: ${errText(err)}`); }
      if (!probe.frozen) return refuse(step, `the probe answered ${probe.status}, not the freeze's 503 — deploy MAINTENANCE_WRITES="1" first (and wait for it to go live)`);
      log("        ok — 503 maintenance");
      continue;
    }
    if (step.id === "journal") {
      let n;
      try { n = await journalRowCount(d1); } catch (err) { return refuse(step, `could not read D1: ${errText(err)}`); }
      if (n > 0) {
        return refuse(step, `_write_journal holds ${n} write(s): D1 has been the live backend, and an import would erase them. Use the ROLLBACK, not a re-copy. After a COMPLETED rollback: node d1/replay-journal.mjs ${q(root)} --archive --i-mean-it`);
      }
      log("        ok — no journaled writes");
      continue;
    }
    if (step.id === "export") exported = true;
    const code = exec(step.script, step.args);
    if (code !== 0) return refuse(step, `${step.script} exited ${code}`);
    log("        ok");
  }

  // The export has done its job once parity passed.
  const kept = disposeExport();

  log("");
  log("The copy is exact. Writes are still frozen.");
  log("");
  for (const l of flipInstructions(root, site)) log(l);
  log("");
  for (const l of rollbackInstructions(root, site)) log(l);
  return { ok: true, dryRun, ...(kept ? { outDir: out } : {}) };
}

/** @param {Parameters<typeof runCutover>[0]} opts */
async function runRollback({
  root, site = SITE_DEFAULT, dryRun = true, log = console.log,
  exec, fetchImpl = fetch, d1, target, registry, replayCheck,
}) {
  const parityArgs = rollbackParityArgs(root);
  const steps = [
    { id: "freeze", title: `writes are frozen on ${site}`, how: `POST ${site}${FREEZE_PROBE_PATH} must answer 503 {code:"maintenance"}` },
    { id: "replay", title: "every journaled write is replayed into Supabase", how: `node d1/replay-journal.mjs ${q(root)}   (dry run) must report 0 pending and 0 late` },
    { id: "parity", title: "parity: Supabase holds every row D1 has", how: `node d1/parity-check.mjs ${parityArgs.map(q).join(" ")}`, script: "d1/parity-check.mjs", args: parityArgs },
  ];

  log(`${dryRun ? "ROLLBACK DRY RUN — nothing below is executed." : "ROLLBACK — the gates before the flip back."}  site=${site}`);
  log("");

  if (dryRun) {
    steps.forEach((s, i) => log(`  gate ${i + 1}  ${s.title}\n          ${s.how}`));
    for (const [col, why] of Object.entries(REPLAY_RECOMPUTED)) log(`          (${col} is not compared: ${why})`);
    log("");
    for (const l of rollbackInstructions(root, site)) log(l);
    return { ok: true, dryRun, mode: "rollback", steps: steps.map((s) => s.id) };
  }

  const refuse = (step, why) => {
    log(`REFUSING at "${step.title}": ${why}`);
    log("Do NOT flip DATA_BACKEND back to supabase yet: Supabase would be missing writes only D1 holds. Keep writes frozen, fix the cause, re-run.");
    return { ok: false, dryRun, mode: "rollback", failedStep: step.id };
  };

  for (const [i, step] of steps.entries()) {
    log(`gate ${i + 1}  ${step.title}`);
    if (step.id === "freeze") {
      let probe;
      try { probe = await probeFreeze(site, fetchImpl); } catch (err) { return refuse(step, `probe failed: ${errText(err)}`); }
      if (!probe.frozen) return refuse(step, `the probe answered ${probe.status}, not the freeze's 503 — a portal still writing to D1 keeps adding writes behind the replay (R1)`);
      log("        ok — 503 maintenance");
      continue;
    }
    if (step.id === "replay") {
      let s;
      try {
        s = await (replayCheck ?? (() => replayJournal({ d1, target, registry, dryRun: true, log: (l) => log(`        ${l}`) })))();
      } catch (err) { return refuse(step, `could not read the journal: ${errText(err)}`); }
      if (s.late > 0) return refuse(step, `${s.late} LATE entr(ies) — run node d1/replay-journal.mjs ${q(root)} --i-mean-it (with --allow-late once nothing is writing)`);
      if (s.pending > 0) return refuse(step, `${s.pending} journaled write(s) not replayed yet — run node d1/replay-journal.mjs ${q(root)} --i-mean-it until "0 still pending"`);
      log(`        ok — ${s.journaled} journaled, every one replayed`);
      continue;
    }
    const code = exec(step.script, step.args);
    if (code !== 0) {
      return refuse(step, `${step.script} exited ${code}: a row differs between D1 and Supabase. Either a write the journal never recorded (search the Worker logs for "[write-journal] LOST") or a replay that landed differently. Its output names the table, key and columns.`);
    }
    log("        ok");
  }

  log("");
  log("Supabase holds every row D1 has. Writes are still frozen.");
  for (const [col, why] of Object.entries(REPLAY_RECOMPUTED)) log(`(not compared: ${col} — ${why})`);
  log("");
  log("FLIP BACK (you run these — this script never deploys):");
  for (const l of flipBackInstructions(root, site)) log(l);
  return { ok: true, dryRun, mode: "rollback" };
}

/* ─────────────────────────────── CLI ─────────────────────────────── */

function argValue(args, name) {
  const i = args.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (i < 0) return undefined;
  return args[i].includes("=") ? args[i].slice(name.length + 1) : args[i + 1];
}

const invokedDirectly = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const root = args[0] && !args[0].startsWith("--") ? path.resolve(args[0]) : null;
  if (!root) {
    console.error("usage: node d1/cutover.mjs <repo-root> [--rollback] [--i-mean-it] [--site URL] [--out DIR] [--keep-export]");
    process.exit(1);
  }
  const dryRun = !args.includes("--i-mean-it");
  let d1, target, registry;
  if (!dryRun) {
    const env = readEnv(root);
    d1 = httpD1(env);
    target = { url: env.NEXT_PUBLIC_SUPABASE_URL, key: env.SUPABASE_SERVICE_ROLE_KEY, fetch };
    registry = JSON.parse(fs.readFileSync(path.join(root, "d1", "types.json"), "utf8"));
  }
  const result = await runCutover({
    root,
    mode: args.includes("--rollback") ? "rollback" : "switch",
    site: argValue(args, "--site") ?? SITE_DEFAULT,
    outDir: argValue(args, "--out"),
    keepExport: args.includes("--keep-export"),
    dryRun,
    d1,
    target,
    registry,
    exec: (script, scriptArgs) => spawnSync(process.execPath, [path.join(root, script), ...scriptArgs], { stdio: "inherit", cwd: root }).status ?? 1,
  });
  process.exitCode = result.ok ? 0 : 1;
}
