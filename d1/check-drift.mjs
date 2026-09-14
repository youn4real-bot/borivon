/**
 * Has live Supabase moved on from the structure snapshot the D1 schema is
 * generated from?
 *
 *   node d1/check-drift.mjs <repo-root>            exit 0 same · 1 drift · 2 could not check
 *   node d1/check-drift.mjs <repo-root> --update   also write the live document over
 *                                                  d1/snapshot/openapi.json
 *
 * The guard against the copy silently falling a migration behind, which it
 * did: supabase/fix_notification_kinds_and_commitments.sql made
 * assistant_commitments.source_message_id NOT NULL DEFAULT '' and nobody
 * re-captured, so D1 kept accepting NULLs Postgres refuses.
 *
 * READ-ONLY on Supabase: a single GET of /rest/v1/ (PostgREST's OpenAPI
 * document — table and column structure, never rows).
 *
 * OpenAPI cannot see CHECKs, indexes, triggers, foreign-key delete rules or
 * jsonb defaults. When this reports drift, re-capture BOTH snapshots
 * (supabase/catalog_capture.sql for the catalog) and re-run d1/gen-schema.mjs.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function fetchLiveOpenApi(env) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/`, { method: "GET", headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`Supabase OpenAPI read failed: HTTP ${res.status}`);
  return res.json();
}

/** Every structural difference, one readable line each. Empty = identical. */
export function diffOpenApi(live, snap) {
  const out = [];
  const j = (v) => JSON.stringify(v);
  const keys = (a, b) => [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].sort();

  for (const k of keys(live, snap)) {
    if (k === "definitions" || k === "paths") continue;
    if (j(live[k]) !== j(snap[k])) out.push(`${k}: changed`);
  }

  const L = live.definitions ?? {}, S = snap.definitions ?? {};
  for (const t of keys(L, S)) {
    if (!S[t]) { out.push(`table added: ${t}`); continue; }
    if (!L[t]) { out.push(`table removed: ${t}`); continue; }
    const lp = L[t].properties ?? {}, sp = S[t].properties ?? {};
    for (const c of Object.keys(lp)) if (!sp[c]) out.push(`column added: ${t}.${c} (${lp[c].format ?? lp[c].type})`);
    for (const c of Object.keys(sp)) if (!lp[c]) out.push(`column removed: ${t}.${c}`);
    for (const c of Object.keys(lp)) {
      if (!sp[c]) continue;
      for (const f of keys(lp[c], sp[c])) {
        if (j(lp[c][f]) !== j(sp[c][f])) out.push(`${t}.${c}: ${f} ${j(sp[c][f]) ?? "(none)"} → ${j(lp[c][f]) ?? "(none)"}`);
      }
    }
    const lr = new Set(L[t].required ?? []), sr = new Set(S[t].required ?? []);
    for (const c of lr) if (!sr.has(c) && sp[c]) out.push(`${t}.${c}: now NOT NULL`);
    for (const c of sr) if (!lr.has(c) && lp[c]) out.push(`${t}.${c}: no longer NOT NULL`);
    const order = (a, b) => Object.keys(a).filter((c) => b[c]);
    if (j(order(lp, sp)) !== j(order(sp, lp))) out.push(`${t}: column order changed`);
    for (const f of keys(L[t], S[t])) {
      if (f !== "properties" && f !== "required" && j(L[t][f]) !== j(S[t][f])) out.push(`${t}: ${f} changed`);
    }
  }

  const LP = live.paths ?? {}, SP = snap.paths ?? {};
  for (const p of keys(LP, SP)) {
    if (!SP[p]) out.push(`path added: ${p}`);
    else if (!LP[p]) out.push(`path removed: ${p}`);
    else if (j(LP[p]) !== j(SP[p])) out.push(`path changed: ${p}`);
  }

  if (!out.length && j(live) !== j(snap)) out.push("documents differ only in key order");
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = process.argv[2];
  if (!root) { console.error("usage: node d1/check-drift.mjs <repo-root> [--update]"); process.exit(2); }
  const env = Object.fromEntries(
    fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)
      .filter((l) => l.includes("=") && !l.startsWith("#"))
      .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }),
  );
  const snapPath = path.join(root, "d1", "snapshot", "openapi.json");
  let live;
  try { live = await fetchLiveOpenApi(env); } catch (e) { console.error(`could not check: ${e.message}`); process.exit(2); }
  const snap = JSON.parse(fs.readFileSync(snapPath, "utf8"));
  const diffs = diffOpenApi(live, snap);
  if (!diffs.length) {
    console.log(`no drift: live PostgREST matches d1/snapshot/openapi.json (${Object.keys(live.definitions ?? {}).length} tables, ${Object.keys(live.paths ?? {}).length} paths)`);
    console.log("(OpenAPI cannot see CHECKs, indexes, FK delete rules or jsonb defaults — re-capture the catalog after every migration)");
    process.exit(0);
  }
  console.log(`DRIFT: ${diffs.length} difference(s) between live Supabase and d1/snapshot/openapi.json`);
  for (const d of diffs) console.log(`  ${d}`);
  if (process.argv.includes("--update")) {
    fs.writeFileSync(snapPath, JSON.stringify(live));
    console.log("\nsnapshot updated. Next: re-capture the catalog (supabase/catalog_capture.sql), then node d1/gen-schema.mjs");
  } else {
    console.log("\nre-capture: node d1/check-drift.mjs <repo-root> --update, supabase/catalog_capture.sql, node d1/gen-schema.mjs");
  }
  process.exit(1);
}
