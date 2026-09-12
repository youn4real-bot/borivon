/**
 * What the shadow reads have found so far.
 *
 * The Worker logs one line per disagreement, plus a few "ok" lines and one
 * line per distinct query SHAPE, and Workers Observability keeps them. This
 * asks for those lines and summarises them, so checking on the migration is
 * one command instead of holding a `wrangler tail` open:
 *
 *   node d1/shadow-report.mjs <repo-root> [hours]
 *
 * Read-only. The lines themselves carry no candidate data by construction
 * (see lib/d1/shadow.ts) — tables, operators, row and column counts only.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.argv[2];
const hours = Number(process.argv[3] ?? 24);
if (!root) { console.error("usage: node d1/shadow-report.mjs <repo-root> [hours]"); process.exit(1); }

const env = Object.fromEntries(
  fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }),
);
const account = env.CLOUDFLARE_ACCOUNT_ID, token = env.CLOUDFLARE_API_TOKEN;
if (!account || !token) { console.error("missing CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN"); process.exit(1); }

const now = Date.now();
const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/observability/telemetry/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    queryId: "shadow-d1-report",
    timeframe: { from: now - hours * 3600_000, to: now },
    limit: 1000,
    parameters: {
      datasets: ["cloudflare-workers"],
      filters: [{ key: "$metadata.message", operation: "includes", type: "string", value: "[shadow-d1]" }],
    },
    view: "events",
  }),
});
const json = await res.json();
if (!json.success) { console.error(JSON.stringify(json.errors)); process.exitCode = 1; }

const events = json.result?.events?.events ?? json.result?.events ?? [];
const messages = events.map((e) => String(e.$metadata?.message ?? "")).filter(Boolean);

const shapes = new Set(), agreed = [], problems = new Map();
for (const m of messages) {
  const body = m.replace("[shadow-d1] ", "");
  if (body.startsWith("shape ")) shapes.add(body.slice(6));
  else if (body.startsWith("ok ")) agreed.push(body.slice(3));
  else problems.set(body, (problems.get(body) ?? 0) + 1);
}

console.log(`last ${hours}h · ${messages.length} shadow line(s)`);
console.log(`  agreements logged: ${agreed.length}`);
console.log(`  distinct query shapes seen: ${shapes.size}`);
for (const s of [...shapes].sort()) console.log(`    · ${s}`);
// process.exitCode, not process.exit(): killing the process while the fetch
// socket is still closing trips a libuv assertion on Windows.
if (!problems.size) {
  console.log("  DIFFERENCES: none — the copy answered every sampled read exactly like Supabase.");
} else {
  console.log(`  DIFFERENCES: ${[...problems.values()].reduce((a, b) => a + b, 0)} line(s), ${problems.size} distinct`);
  for (const [p, n] of [...problems.entries()].sort((a, b) => b[1] - a[1])) console.log(`    × ${n}  ${p}`);
  process.exitCode = 1;
}
