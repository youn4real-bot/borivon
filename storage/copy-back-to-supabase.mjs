/**
 * Copy files written to R2 after the storage flip back into Supabase Storage —
 * the storage half of a ROLLBACK.
 *
 * While STORAGE_BACKEND=r2, every successful upload and remove is repeated on
 * Supabase (lib/storage/r2StorageFetch.ts StorageMirror), so Supabase should
 * already hold everything. This repairs what a mirror MISSED (logged as
 * "[r2-storage] MIRROR MISS"): an R2 object Supabase lacks, or holds older
 * bytes of. Run it after setting STORAGE_BACKEND back to "supabase".
 *
 *   node storage/copy-back-to-supabase.mjs <repo-root> --flipped-at <ISO>             (dry run)
 *   node storage/copy-back-to-supabase.mjs <repo-root> --flipped-at <ISO> --i-mean-it
 *
 * --flipped-at (the FLIP deploy time) is required: an R2 object older than the
 * flip that Supabase lacks was deleted through the app after the flip, and must
 * not come back. Supabase objects newer than their R2 copy (written after the
 * rollback) are never overwritten — see storage/sync-plan.mjs.
 *
 * Never deletes on either side. A delete whose mirror missed is REPORTED
 * (present in Supabase, gone from R2, older than the flip) for a person to look
 * at: removing a file is the call site's decision, not a script's (LAW #33).
 * Bytes move in memory; prints counts, not paths, unless --list is given.
 */
import { PREFIX, cfHeaders, encPath, listR2, listSupabaseBucket, listSupabaseBuckets, loadEnv, r2ObjectUrl, sbHeaders, splitKey, withRetry } from "./listing.mjs";
import { parseFlippedAt, planSync } from "./sync-plan.mjs";

const CONCURRENCY = 4;

const args = process.argv.slice(2);
const root = args[0];
const argOf = (name) => { const i = args.indexOf(name); return i > 0 ? args[i + 1] : null; };
if (!root || !argOf("--flipped-at")) {
  console.error("usage: node storage/copy-back-to-supabase.mjs <repo-root> --flipped-at <ISO> [--i-mean-it] [--list]");
  process.exit(1);
}
const flippedAt = parseFlippedAt(argOf("--flipped-at"));
const apply = args.includes("--i-mean-it");
const showList = args.includes("--list");
const cfg = loadEnv(root);

async function copyBack(key, obj) {
  const { bucket, path } = splitKey(key);
  const bytes = await withRetry(`get ${key}`, async () => {
    const r = await fetch(r2ObjectUrl(cfg, `${PREFIX}/${key}`), { headers: cfHeaders(cfg) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  });
  await withRetry(`upload ${key}`, async () => {
    const r = await fetch(`${cfg.sbUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encPath(path)}`, {
      method: "POST",
      headers: { ...sbHeaders(cfg), "Content-Type": obj.contentType || "application/octet-stream", "x-upsert": "true" },
      body: bytes,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);
  });
}

(async () => {
  const buckets = await listSupabaseBuckets(cfg);
  const known = new Set(buckets.map((b) => b.id));
  const supa = new Map();
  for (const b of buckets) await listSupabaseBucket(cfg, b.id, supa);
  const r2All = await listR2(cfg);
  const r2 = new Map([...r2All].filter(([k]) => known.has(splitKey(k).bucket)));

  const plan = planSync(r2, supa, { flippedAt });
  const goneFromR2 = [...supa.keys()].filter((k) => !r2.has(k) && (supa.get(k).updated ?? 0) < flippedAt);

  console.log(`R2 ${r2.size} object(s) under ${PREFIX}/ (${r2All.size - r2.size} in no Supabase bucket, ignored) · Supabase ${supa.size}`);
  console.log(`plan: copy back ${plan.copy.length} · identical ${plan.same.length} · Supabase newer, kept ${plan.targetNewer.length} · older than the flip, not recreated ${plan.notRecreated.length}`);
  console.log(`report: ${goneFromR2.length} object(s) still in Supabase but deleted from R2 after the flip (a remove whose mirror missed) — look at them, nothing is deleted here`);
  if (showList) {
    for (const k of plan.copy) console.log(`  copy  ${k}`);
    for (const k of goneFromR2) console.log(`  gone  ${k}`);
  }
  if (!apply) { console.log("dry run: nothing written. Add --i-mean-it to copy."); process.exit(0); }

  let copied = 0, failed = 0, i = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, plan.copy.length) }, async () => {
    for (;;) {
      const n = i++;
      if (n >= plan.copy.length) return;
      const key = plan.copy[n];
      try { await copyBack(key, r2.get(key)); copied++; } catch (err) { failed++; console.error(`  FAILED ${key}: ${err.message}`); }
    }
  }));
  console.log(`copied back ${copied}, failed ${failed}`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err.message); process.exit(1); });
