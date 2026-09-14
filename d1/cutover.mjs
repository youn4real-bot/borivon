/**
 * SWITCH DAY: the final copy, proven, then the exact flip — printed, never run.
 *
 *   node d1/cutover.mjs <repo-root>                 DRY RUN (default): print every step, run nothing
 *   node d1/cutover.mjs <repo-root> --i-mean-it     run the copy steps (it still never deploys)
 *     --site https://www.borivon.com                the site to probe
 *     --out <dir>                                   export directory (must be OUTSIDE the repo)
 *
 * The copy steps, each a gate — the script REFUSES to go on if one fails:
 *   1. writes are frozen on the live site      a mutating /api request answers the freeze's 503
 *   2. D1 has never been the backend           _write_journal is empty (re-importing a D1 that
 *                                              took writes would erase them)
 *   3. no schema drift                         d1/check-drift.mjs, when that script exists
 *   4. export   d1/export-data.mjs             read-only on Supabase
 *   5. import   d1/import.mjs                  refreshes the D1 copy
 *   6. parity   d1/parity-check.mjs            must report 0 mismatches
 * Then it prints the wrangler var edit + deploy for the FLIP, and for the ROLLBACK.
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

export const SITE_DEFAULT = "https://www.borivon.com";

/**
 * A POST to an /api path that has no route. Frozen: middleware.ts answers 503
 * before routing. Not frozen: Next answers 404 — no route runs, nothing can be
 * written. A real save endpoint would do too, but only this one is harmless
 * whichever way the answer goes.
 */
export const FREEZE_PROBE_PATH = "/api/_cutover/freeze-probe";

const q = (s) => (/[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);

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

export function rollbackInstructions(root, site = SITE_DEFAULT) {
  return [
    "ROLLBACK (loses nothing — in this order):",
    '  R1. wrangler.jsonc "vars":  "DATA_BACKEND": "d1",  "MAINTENANCE_WRITES": "1"   → npm run cf:build && npm run cf:deploy',
    `      curl -s -X POST ${site}${FREEZE_PROBE_PATH}   → 503 (writes stopped; D1 still answers reads)`,
    "  R2. wait 2 minutes — journal inserts finish after their responses",
    `  R3. node d1/replay-journal.mjs ${q(root)}                 (dry run: read the list and every WARN line)`,
    `      node d1/replay-journal.mjs ${q(root)} --i-mean-it     (repeat until "0 still pending")`,
    '  R4. wrangler.jsonc "vars":  "DATA_BACKEND": "supabase",  "MAINTENANCE_WRITES": "0",  "SHADOW_D1_RATE": "0"',
    "      npm run cf:build && npm run cf:deploy",
    `  R5. curl -s "${site}/api/health?deep=1"   → deps.d1Backend false, deps.writesFrozen false`,
    "  EMERGENCY (D1 itself is failing and the site cannot read): npx wrangler rollback <the FREEZE Version ID>",
    "      — Supabase answers reads again with writes still frozen; run R3 once D1 is back, then R4.",
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

/** Writes D1 has taken as the backend. 0 when the journal table does not exist. */
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

/**
 * The run. Everything with a side effect is injected, so the tests can prove
 * the gates hold and that nothing here ever reaches for a deploy:
 *   exec(script, args) → exit code     run one node script from d1/
 *   fetchImpl                          the freeze probe
 *   d1 { run(sql) → { results } }      the journal count
 */
export async function runCutover({
  root, site = SITE_DEFAULT, outDir, dryRun = true, log = console.log,
  exec, fetchImpl = fetch, d1, exists = (rel) => fs.existsSync(path.join(root, rel)),
}) {
  const ownOut = !outDir;
  const out = outDir ?? path.join(os.tmpdir(), `borivon-cutover-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const hasDrift = exists("d1/check-drift.mjs");

  const steps = [
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

  const refuse = (step, why) => {
    log(`REFUSING at "${step.title}": ${why}`);
    log('Nothing was flipped. To reopen the site on Supabase: "MAINTENANCE_WRITES": "0" → npm run cf:build && npm run cf:deploy');
    return { ok: false, dryRun, failedStep: step.id, outDir: out };
  };

  for (const [i, step] of steps.entries()) {
    log(`step ${i + 1}  ${step.title}`);
    if (step.skip) { log(`        ${step.how}`); continue; }
    if (step.id === "freeze") {
      let probe;
      try { probe = await probeFreeze(site, fetchImpl); } catch (err) { return refuse(step, `probe failed: ${err instanceof Error ? err.message : err}`); }
      if (!probe.frozen) return refuse(step, `the probe answered ${probe.status}, not the freeze's 503 — deploy MAINTENANCE_WRITES="1" first (and wait for it to go live)`);
      log("        ok — 503 maintenance");
      continue;
    }
    if (step.id === "journal") {
      let n;
      try { n = await journalRowCount(d1); } catch (err) { return refuse(step, `could not read D1: ${err instanceof Error ? err.message : err}`); }
      if (n > 0) return refuse(step, `_write_journal holds ${n} write(s): D1 has been the live backend, and an import would erase them. Use the ROLLBACK, not a re-copy.`);
      log("        ok — no journaled writes");
      continue;
    }
    const code = exec(step.script, step.args);
    if (code !== 0) return refuse(step, `${step.script} exited ${code}`);
    log("        ok");
  }

  if (ownOut) {
    // The export is a full copy of candidate data; it has done its job once parity passed.
    try { fs.rmSync(out, { recursive: true, force: true }); log(`removed the export directory ${out}`); } catch { log(`DELETE the export directory by hand: ${out}`); }
  } else {
    log(`DELETE the export directory when you are done — it holds candidate personal data: ${out}`);
  }

  log("");
  log("The copy is exact. Writes are still frozen.");
  log("");
  for (const l of flipInstructions(root, site)) log(l);
  log("");
  for (const l of rollbackInstructions(root, site)) log(l);
  return { ok: true, dryRun, outDir: out };
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
    console.error("usage: node d1/cutover.mjs <repo-root> [--i-mean-it] [--site URL] [--out DIR]");
    process.exit(1);
  }
  const dryRun = !args.includes("--i-mean-it");
  let d1;
  if (!dryRun) {
    const { readEnv, httpD1 } = await import("./replay-journal.mjs");
    d1 = httpD1(readEnv(root));
  }
  const result = await runCutover({
    root,
    site: argValue(args, "--site") ?? SITE_DEFAULT,
    outDir: argValue(args, "--out"),
    dryRun,
    d1,
    exec: (script, scriptArgs) => spawnSync(process.execPath, [path.join(root, script), ...scriptArgs], { stdio: "inherit", cwd: root }).status ?? 1,
  });
  process.exitCode = result.ok ? 0 : 1;
}
