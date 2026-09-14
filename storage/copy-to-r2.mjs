/**
 * Copy Supabase Storage into R2 — the storage half of "copy, don't switch".
 *
 * Every object in every Supabase bucket is written to the existing R2 bucket
 * under `supabase/<bucket>/<original path>`, which cannot collide with the
 * candidate files already there (`candidates/<userId>/…`). Supabase keeps its
 * copy; nothing here deletes anything on either side.
 *
 *   node storage/copy-to-r2.mjs <repo-root> [--dry-run] [--flipped-at <ISO>] [--manifest <out-dir>]
 *
 * WHEN: during the write freeze, right before the flip — Supabase cannot
 * change under it then, and the app has never written R2. After the flip the
 * app writes R2 first, so the plan (storage/sync-plan.mjs) never overwrites an
 * R2 object that is as new as or newer than its Supabase copy, and with
 * --flipped-at it never recreates an object the app deleted since. The old
 * "skip when the size matches, otherwise overwrite" rule would have reverted
 * every contract signed after the flip to its unsigned bytes.
 *
 * Bytes stream Supabase → R2 in memory: no candidate file is ever written to
 * this machine's disk. The optional manifest (object paths, sizes, sha256)
 * DOES name real files, so it is refused inside the repo — same rule as
 * d1/export-data.mjs.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { PREFIX, cfHeaders, encPath, listR2, listSupabaseBucket, listSupabaseBuckets, loadEnv, r2ObjectUrl, sbHeaders, splitKey, withRetry } from "./listing.mjs";
import { parseFlippedAt, planSync } from "./sync-plan.mjs";

const CONCURRENCY = 6;

const args = process.argv.slice(2);
const root = args[0];
if (!root) { console.error("usage: node storage/copy-to-r2.mjs <repo-root> [--dry-run] [--flipped-at <ISO>] [--manifest <out-dir>]"); process.exit(1); }
const argOf = (name) => { const i = args.indexOf(name); return i > 0 ? args[i + 1] : null; };
const dryRun = args.includes("--dry-run");
const manifestDir = argOf("--manifest");
if (manifestDir && path.resolve(manifestDir).startsWith(path.resolve(root))) {
  console.error("REFUSING: the manifest names real candidate files — keep it out of the repo.");
  process.exit(1);
}
const flippedAt = parseFlippedAt(argOf("--flipped-at"));

const cfg = loadEnv(root);

async function copyOne(key, obj, manifest) {
  const { bucket, path: objPath } = splitKey(key);
  const bytes = await withRetry(`get ${key}`, async () => {
    const r = await fetch(`${cfg.sbUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encPath(objPath)}`, { headers: sbHeaders(cfg) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  });
  await withRetry(`put ${key}`, async () => {
    const r = await fetch(r2ObjectUrl(cfg, `${PREFIX}/${key}`), {
      method: "PUT",
      headers: { ...cfHeaders(cfg), "Content-Type": obj.contentType || "application/octet-stream" },
      body: bytes,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);
  });
  manifest?.push({ key: `${PREFIX}/${key}`, size: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") });
  return bytes.length;
}

async function pool(items, worker) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    for (;;) { const n = i++; if (n >= items.length) return; await worker(items[n]); }
  }));
}

(async () => {
  const buckets = await listSupabaseBuckets(cfg);
  const source = new Map();
  for (const b of buckets) await listSupabaseBucket(cfg, b.id, source);
  const target = await listR2(cfg);
  const plan = planSync(source, target, { flippedAt });

  console.log(`Supabase ${source.size} object(s) · R2 ${target.size} under ${PREFIX}/`);
  console.log(`plan: copy ${plan.copy.length} · identical ${plan.same.length} (${plan.sizeOnly} by size only, no etag) · R2 newer, kept ${plan.targetNewer.length} · not recreated (deleted after the flip) ${plan.notRecreated.length}`);
  if (flippedAt === null) console.log("no --flipped-at: assumes the app has never written R2 (the copy during the freeze). After the flip, always pass it.");
  if (dryRun) { console.log("dry run: nothing copied."); process.exit(0); }

  const manifest = manifestDir ? [] : null;
  let copied = 0, failed = 0, bytes = 0;
  await pool(plan.copy, async (key) => {
    try { bytes += await copyOne(key, source.get(key), manifest); copied++; } catch (err) {
      failed++;
      console.error(`  FAILED ${key}: ${err.message}`);
    }
  });

  if (manifest) {
    fs.mkdirSync(manifestDir, { recursive: true });
    const file = path.join(manifestDir, "storage-manifest.json");
    fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
    console.log(`manifest → ${file} (delete it when the copy is verified — it names real files)`);
  }
  console.log(`copied ${copied}, failed ${failed}, ${(bytes / 1e6).toFixed(1)} MB moved`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err.message); process.exit(1); });
